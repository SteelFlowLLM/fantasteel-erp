import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSteelGradeDto } from './dto/create-steel-grade.dto';
import { ListMasterDto } from './dto/list-master.dto';
import { PatchCompositionSpecsDto, ReplaceCompositionSpecsDto } from './dto/replace-composition-specs.dto';
import { UpdateSteelGradeDto } from './dto/update-steel-grade.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive, referenced } from './master-data.util';
import { SteelGradeRepository, type SteelGradeRow } from './steel-grade.repository';
import { validateCompositionInputs } from './steel-grade.rules';

export const toSteelGradeView = (g: SteelGradeRow) => ({
  id: g.id,
  steelGradeCode: g.steelGradeCode,
  steelGradeName: g.steelGradeName,
  standardNo: g.standardNo,
  isActive: g.isActive,
  compositionSpecs: g.compositionSpecs.map((c) => ({ id: c.id, elementCode: c.elementCode, minValue: c.minValue, maxValue: c.maxValue, sortOrder: c.sortOrder })),
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

@Injectable()
export class SteelGradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SteelGradeRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListMasterDto) {
    const active = parseActive(q.active);
    const where: Prisma.SteelGradeWhereInput = {
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q.q ? { OR: [{ steelGradeCode: { contains: q.q, mode: 'insensitive' } }, { steelGradeName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    return (await this.repo.findMany(this.prisma, where)).map(toSteelGradeView);
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('강종');
    return toSteelGradeView(row);
  }

  async create(dto: CreateSteelGradeDto, user: AuthUser) {
    const specs = dto.compositionSpecs ?? [];
    validateCompositionInputs(specs);
    return this.prisma.tx(async (tx) => {
      if (await this.repo.findByCode(tx, dto.steelGradeCode)) throw duplicate(`이미 등록된 강종입니다 (${dto.steelGradeCode})`);
      const row = await this.repo.create(tx, {
        steelGradeCode: dto.steelGradeCode,
        steelGradeName: dto.steelGradeName,
        standardNo: dto.standardNo ?? null,
        compositionSpecs: { create: specs.map((c, i) => ({ elementCode: c.elementCode, minValue: c.minValue ?? null, maxValue: c.maxValue ?? null, sortOrder: c.sortOrder ?? i })) },
      });
      await this.changes.record(tx, user, { targetNo: row.steelGradeCode, targetId: row.id, summary: `강종 ${row.steelGradeCode} 등록 (성분 규격 ${row.compositionSpecs.length}개)`, after: row });
      return toSteelGradeView(row);
    });
  }

  async update(id: number, dto: UpdateSteelGradeDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('강종');
      const row = await this.repo.update(tx, id, {
        ...(dto.steelGradeName !== undefined ? { steelGradeName: dto.steelGradeName } : {}),
        ...(dto.standardNo !== undefined ? { standardNo: dto.standardNo } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      await this.changes.record(tx, user, { targetNo: row.steelGradeCode, targetId: row.id, summary: `강종 ${row.steelGradeCode} 수정`, before, after: row });
      return toSteelGradeView(row);
    });
  }

  /** 다른 데이터가 쓰고 있지 않은 강종만 지운다. 쓰고 있으면 사용 중지(isActive=false)로 안내한다. */
  async remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('강종');
      const c = await this.repo.referenceCounts(tx, id);
      if (Object.values(c).some((n) => n > 0)) {
        throw referenced(`다른 데이터에서 사용 중인 강종은 삭제할 수 없습니다 (규격 ${c.productSpecs}, LOT ${c.lots}, 생산계획 ${c.productionPlans}, 검사 항목 ${c.inspectionItems}, 배합 원단위 ${c.specificConsumptions}). 사용 중지로 바꿔 주세요`);
      }
      await this.repo.deleteCompositionSpecs(tx, id);
      await this.repo.delete(tx, id);
      await this.changes.record(tx, user, { targetNo: before.steelGradeCode, targetId: id, summary: `강종 ${before.steelGradeCode} 삭제`, before });
      return { id, deleted: true };
    });
  }

  /** 성분 규격을 보낸 목록 전체로 교체한다 (목록에 없는 성분은 삭제). */
  async replaceCompositionSpecs(id: number, dto: ReplaceCompositionSpecsDto, user: AuthUser) {
    validateCompositionInputs(dto.compositionSpecs);
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('강종');
      const keep = dto.compositionSpecs.map((c) => c.elementCode);
      await this.repo.deleteCompositionSpecs(tx, id, before.compositionSpecs.filter((c) => !keep.includes(c.elementCode)).map((c) => c.elementCode));
      for (const [i, c] of dto.compositionSpecs.entries()) {
        await this.repo.upsertCompositionSpec(tx, id, { elementCode: c.elementCode, minValue: c.minValue ?? null, maxValue: c.maxValue ?? null, sortOrder: c.sortOrder ?? i });
      }
      return this.finishCompositionChange(tx, user, before, `강종 ${before.steelGradeCode} 성분 규격 교체`);
    });
  }

  /** 보낸 성분만 추가·수정하고 removeElementCodes의 성분은 삭제한다. */
  async patchCompositionSpecs(id: number, dto: PatchCompositionSpecsDto, user: AuthUser) {
    const specs = dto.compositionSpecs ?? [];
    validateCompositionInputs(specs);
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('강종');
      const remove = dto.removeElementCodes ?? [];
      const unknown = remove.filter((code) => !before.compositionSpecs.some((c) => c.elementCode === code));
      if (unknown.length) throw notFound(`성분 ${unknown.join(', ')}`);
      if (specs.some((s) => remove.includes(s.elementCode))) throw duplicate('같은 성분을 수정하면서 삭제할 수 없습니다');
      if (remove.length) await this.repo.deleteCompositionSpecs(tx, id, remove);
      let nextOrder = Math.max(-1, ...before.compositionSpecs.map((c) => c.sortOrder)) + 1;
      for (const c of specs) {
        const existing = before.compositionSpecs.find((e) => e.elementCode === c.elementCode);
        await this.repo.upsertCompositionSpec(tx, id, {
          elementCode: c.elementCode,
          minValue: c.minValue ?? null,
          maxValue: c.maxValue ?? null,
          sortOrder: c.sortOrder ?? existing?.sortOrder ?? nextOrder++,
        });
      }
      return this.finishCompositionChange(tx, user, before, `강종 ${before.steelGradeCode} 성분 규격 수정`);
    });
  }

  private async finishCompositionChange(tx: Parameters<SteelGradeRepository['findById']>[0], user: AuthUser, before: SteelGradeRow, summary: string) {
    const after = (await this.repo.findById(tx, before.id))!;
    await this.changes.record(tx, user, { targetNo: after.steelGradeCode, targetId: after.id, summary, before: before.compositionSpecs, after: after.compositionSpecs });
    return toSteelGradeView(after);
  }
}
