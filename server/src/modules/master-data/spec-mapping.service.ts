import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { CreateSpecMappingDto } from './dto/create-spec-mapping.dto';
import { ListSpecMappingsDto } from './dto/list-spec-mappings.dto';
import { UpdateSpecMappingDto } from './dto/update-spec-mapping.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { referenced, yieldText } from './master-data.util';
import { assertMappable, type MappableSpec } from './product-spec.rules';
import { ProductSpecRepository } from './product-spec.repository';
import { SpecMappingRepository, type SpecMappingRow } from './spec-mapping.repository';

type SpecRow = SpecMappingRow['slabSpec'];
const specView = (s: SpecRow) => ({
  id: s.id,
  specCode: s.specCode,
  steelGradeId: s.steelGradeId,
  steelGradeCode: s.steelGrade.steelGradeCode,
  thicknessMm: s.thicknessMm,
  widthMm: s.widthMm,
  lengthMm: s.lengthMm,
  theoreticalWeightTon: s.theoreticalWeightTon,
  isActive: s.isActive,
});

/** 열연 계획 수율은 저장하지 않고 두 규격의 이론중량으로 계산해 준다 (REQ-MST-004). */
export const toSpecMappingView = (m: SpecMappingRow, isUsed: boolean) => ({
  id: m.id,
  steelGradeId: m.slabSpec.steelGradeId,
  steelGradeCode: m.slabSpec.steelGrade.steelGradeCode,
  slabSpec: specView(m.slabSpec),
  coilSpec: specView(m.coilSpec),
  hotRollingPlannedYieldRate: yieldText(m.coilSpec.theoreticalWeightTon, m.slabSpec.theoreticalWeightTon),
  isUsed,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

const asMappable = (s: SpecRow | (Awaited<ReturnType<SpecMappingRepository['findSpec']>> & object)): MappableSpec => ({
  id: s.id, specCode: s.specCode, itemType: s.item.itemType, steelGradeId: s.steelGradeId, theoreticalWeightTon: s.theoreticalWeightTon,
});

@Injectable()
export class SpecMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SpecMappingRepository,
    private readonly specs: ProductSpecRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListSpecMappingsDto) {
    const rows = await this.repo.findMany(this.prisma, q.steelGradeId ? { slabSpec: { steelGradeId: q.steelGradeId } } : {});
    const used = await this.specs.usedSpecIds(this.prisma);
    return rows.map((m) => toSpecMappingView(m, used.has(m.slabSpecId) || used.has(m.coilSpecId)));
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('규격 매핑');
    return toSpecMappingView(row, await this.isUsed(this.prisma, row));
  }

  /** 슬래브 규격 1개에 코일 규격 1개를 연결한다. 코일 중량 ≤ 슬래브 중량, 같은 강종, 양쪽 모두 미매핑이어야 한다. */
  async create(dto: CreateSpecMappingDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const slab = await this.repo.findSpec(tx, dto.slabSpecId);
      if (!slab) throw notFound('슬래브 규격');
      const coil = await this.repo.findSpec(tx, dto.coilSpecId);
      if (!coil) throw notFound('코일 규격');
      assertMappable(asMappable(slab), asMappable(coil), {
        slabMappedCoilCode: (await this.repo.findBySlab(tx, slab.id))?.coilSpec.specCode,
        coilMappedSlabCode: (await this.repo.findByCoil(tx, coil.id))?.slabSpec.specCode,
      });
      const row = await this.repo.create(tx, slab.id, coil.id);
      const view = toSpecMappingView(row, false);
      await this.changes.record(tx, user, {
        targetNo: `${slab.specCode}→${coil.specCode}`, targetId: row.id,
        summary: `규격 매핑 ${slab.specCode} → ${coil.specCode} 등록 (열연 계획 수율 ${view.hotRollingPlannedYieldRate})`, after: view,
      });
      return { ...view, isUsed: await this.isUsed(tx, row) };
    });
  }

  /** 대응 코일 규격을 바꾼다. 이미 쓰인 규격의 매핑은 바꾸지 않는다. */
  async update(id: number, dto: UpdateSpecMappingDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('규격 매핑');
      await this.assertNotUsed(tx, before);
      const coil = await this.repo.findSpec(tx, dto.coilSpecId);
      if (!coil) throw notFound('코일 규격');
      const otherMapping = await this.repo.findByCoil(tx, coil.id);
      assertMappable(asMappable(before.slabSpec), asMappable(coil), {
        coilMappedSlabCode: otherMapping && otherMapping.id !== id ? otherMapping.slabSpec.specCode : null,
      });
      const row = await this.repo.update(tx, id, coil.id);
      await this.changes.record(tx, user, {
        targetNo: `${row.slabSpec.specCode}→${row.coilSpec.specCode}`, targetId: row.id,
        summary: `규격 매핑 ${row.slabSpec.specCode}의 코일 규격을 ${before.coilSpec.specCode}에서 ${row.coilSpec.specCode}로 변경`,
        before: toSpecMappingView(before, false), after: toSpecMappingView(row, false),
      });
      return toSpecMappingView(row, false);
    });
  }

  async remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('규격 매핑');
      await this.assertNotUsed(tx, before);
      await this.repo.delete(tx, id);
      await this.changes.record(tx, user, {
        targetNo: `${before.slabSpec.specCode}→${before.coilSpec.specCode}`, targetId: id,
        summary: `규격 매핑 ${before.slabSpec.specCode} → ${before.coilSpec.specCode} 삭제`, before: toSpecMappingView(before, false),
      });
      return { id, deleted: true };
    });
  }

  private async isUsed(tx: Tx, m: SpecMappingRow): Promise<boolean> {
    const used = await this.specs.usedSpecIds(tx, [m.slabSpecId, m.coilSpecId]);
    return used.size > 0;
  }

  private async assertNotUsed(tx: Tx, m: SpecMappingRow): Promise<void> {
    if (await this.isUsed(tx, m)) throw referenced('수주·재고·LOT에 사용된 규격의 매핑은 바꾸거나 삭제할 수 없습니다. 새 규격을 추가해 매핑해 주세요');
  }
}
