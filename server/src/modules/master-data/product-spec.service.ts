import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, ITEM_TYPE_LABEL, YARD_TYPE, type AuthUser, type ItemType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { badInput, notFound } from '../../common/errors/app.exception';
import { lockProductInventory } from '../../common/concurrency/locks';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { CreateProductSpecDto } from './dto/create-product-spec.dto';
import { ListProductSpecsDto } from './dto/list-product-specs.dto';
import { UpdateProductSpecDto } from './dto/update-product-spec.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { D, duplicate, parseActive, yieldText } from './master-data.util';
import { assertMappable, buildSpecCode, computeSpecWeight, usedSpecError } from './product-spec.rules';
import { ProductSpecRepository, type ProductSpecRow } from './product-spec.repository';

type MappedSpec = { id: number; specCode: string; thicknessMm: Prisma.Decimal; widthMm: Prisma.Decimal; lengthMm: Prisma.Decimal; theoreticalWeightTon: Prisma.Decimal; isActive: boolean; item: { itemType: string } };

const mappedView = (s: MappedSpec) => ({
  id: s.id,
  specCode: s.specCode,
  itemType: s.item.itemType,
  thicknessMm: s.thicknessMm,
  widthMm: s.widthMm,
  lengthMm: s.lengthMm,
  theoreticalWeightTon: s.theoreticalWeightTon,
  isActive: s.isActive,
});

/** 작업 로그에 남기는 규격 값 (관계 객체 없이 규격 자체의 값만) */
const specSnapshot = (s: ProductSpecRow) => ({
  id: s.id, specCode: s.specCode, itemType: s.item.itemType, steelGradeId: s.steelGradeId, steelGradeCode: s.steelGrade.steelGradeCode,
  thicknessMm: s.thicknessMm, widthMm: s.widthMm, lengthMm: s.lengthMm, theoreticalWeightTon: s.theoreticalWeightTon, yardId: s.yardId, isActive: s.isActive,
});

/** 슬래브 규격이면 매핑된 코일 규격, 코일 규격이면 매핑된 슬래브 규격과 열연 계획 수율(계산값)을 붙인다. */
export function toProductSpecView(s: ProductSpecRow, isUsed: boolean) {
  const itemType = s.item.itemType;
  const mapped = itemType === ITEM_TYPE.SLAB ? s.slabMapping?.coilSpec : s.coilMapping?.slabSpec;
  const slabWeight = itemType === ITEM_TYPE.SLAB ? s.theoreticalWeightTon : s.coilMapping?.slabSpec.theoreticalWeightTon;
  const coilWeight = itemType === ITEM_TYPE.SLAB ? s.slabMapping?.coilSpec.theoreticalWeightTon : s.theoreticalWeightTon;
  return {
    id: s.id,
    specCode: s.specCode,
    itemId: s.itemId,
    itemType,
    itemTypeName: ITEM_TYPE_LABEL[itemType as ItemType] ?? itemType,
    itemName: s.item.itemName,
    steelGradeId: s.steelGradeId,
    steelGradeCode: s.steelGrade.steelGradeCode,
    thicknessMm: s.thicknessMm,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    theoreticalWeightTon: s.theoreticalWeightTon,
    yardId: s.yardId,
    yardName: s.yard?.yardName ?? null,
    isActive: s.isActive,
    isUsed,
    mappingId: (itemType === ITEM_TYPE.SLAB ? s.slabMapping?.id : s.coilMapping?.id) ?? null,
    mappedSpec: mapped ? mappedView(mapped) : null,
    hotRollingPlannedYieldRate: slabWeight && coilWeight ? yieldText(coilWeight, slabWeight) : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

@Injectable()
export class ProductSpecService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductSpecRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListProductSpecsDto) {
    const active = parseActive(q.active);
    const where: Prisma.ProductSpecWhereInput = {
      ...(q.itemType ? { item: { itemType: q.itemType } } : {}),
      ...(q.steelGradeId ? { steelGradeId: q.steelGradeId } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q.q ? { specCode: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.repo.findMany(this.prisma, where);
    const used = await this.repo.usedSpecIds(this.prisma, rows.map((r) => r.id));
    return rows.map((r) => toProductSpecView(r, used.has(r.id)));
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('제품 규격');
    return toProductSpecView(row, (await this.repo.usedSpecIds(this.prisma, [id])).has(id));
  }

  async create(dto: CreateProductSpecDto, user: AuthUser) {
    // 이론중량은 서버가 계산한다. 조합 중복 검사보다 먼저 치수를 검증한다.
    const weight = computeSpecWeight(dto.thicknessMm, dto.widthMm, dto.lengthMm);
    return this.prisma.tx(async (tx) => {
      const item = await this.resolveItem(tx, dto);
      const grade = await tx.steelGrade.findUnique({ where: { id: dto.steelGradeId } });
      if (!grade) throw notFound('강종');
      if (!grade.isActive) throw badInput(`사용 중지된 강종입니다 (${grade.steelGradeCode})`);
      await this.assertYard(tx, dto.yardId, item.itemType);

      const [t, w, l] = [D(dto.thicknessMm), D(dto.widthMm), D(dto.lengthMm)];
      const specCode = buildSpecCode(item.itemType, grade.steelGradeCode, t, w, l);
      const dup = await this.repo.findByCombination(tx, grade.id, t, w, l);
      if (dup) throw duplicate(`이미 등록된 강종·두께·폭·길이 조합입니다 (${dup.specCode})`);
      if (await this.repo.findBySpecCode(tx, specCode)) throw duplicate(`이미 등록된 규격 코드입니다 (${specCode})`);

      const row = await this.repo.create(tx, {
        specCode, itemId: item.id, steelGradeId: grade.id, thicknessMm: t, widthMm: w, lengthMm: l,
        theoreticalWeightTon: weight, yardId: dto.yardId ?? null,
      });
      await this.changes.record(tx, user, { targetNo: row.specCode, targetId: row.id, summary: `제품 규격 ${row.specCode} 등록 (이론중량 ${weight.toFixed(3)}t)`, after: specSnapshot(row) });
      return toProductSpecView(row, false);
    });
  }

  async update(id: number, dto: UpdateProductSpecDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('제품 규격');
      const next = {
        steelGradeId: dto.steelGradeId ?? before.steelGradeId,
        thicknessMm: dto.thicknessMm !== undefined ? D(dto.thicknessMm) : before.thicknessMm,
        widthMm: dto.widthMm !== undefined ? D(dto.widthMm) : before.widthMm,
        lengthMm: dto.lengthMm !== undefined ? D(dto.lengthMm) : before.lengthMm,
      };
      const identityChanged =
        next.steelGradeId !== before.steelGradeId || !next.thicknessMm.eq(before.thicknessMm) || !next.widthMm.eq(before.widthMm) || !next.lengthMm.eq(before.lengthMm);

      const data: Prisma.ProductSpecUncheckedUpdateInput = {};
      if (identityChanged) {
        // 예약·재고와 같은 잠금을 잡아 사용 여부 확인 중에 예약이 끼어드는 것을 줄인다.
        await lockProductInventory(tx, id);
        if ((await this.repo.usedSpecIds(tx, [id])).has(id)) throw usedSpecError();

        const grade = await tx.steelGrade.findUnique({ where: { id: next.steelGradeId } });
        if (!grade) throw notFound('강종');
        if (next.steelGradeId !== before.steelGradeId && !grade.isActive) throw badInput(`사용 중지된 강종입니다 (${grade.steelGradeCode})`);
        const weight = computeSpecWeight(next.thicknessMm, next.widthMm, next.lengthMm);
        const dup = await this.repo.findByCombination(tx, next.steelGradeId, next.thicknessMm, next.widthMm, next.lengthMm);
        if (dup && dup.id !== id) throw duplicate(`이미 등록된 강종·두께·폭·길이 조합입니다 (${dup.specCode})`);
        const specCode = buildSpecCode(before.item.itemType, grade.steelGradeCode, next.thicknessMm, next.widthMm, next.lengthMm);
        const codeOwner = await this.repo.findBySpecCode(tx, specCode);
        if (codeOwner && codeOwner.id !== id) throw duplicate(`이미 등록된 규격 코드입니다 (${specCode})`);

        // 매핑된 규격이면 바뀐 중량·강종으로도 매핑 규칙을 지켜야 한다 (REQ-MST-004)
        const after = { id, specCode, itemType: before.item.itemType, steelGradeId: next.steelGradeId, theoreticalWeightTon: weight };
        if (before.slabMapping) {
          assertMappable(after, { ...before.slabMapping.coilSpec, itemType: before.slabMapping.coilSpec.item.itemType }, {});
        }
        if (before.coilMapping) {
          assertMappable({ ...before.coilMapping.slabSpec, itemType: before.coilMapping.slabSpec.item.itemType }, after, {});
        }
        Object.assign(data, { specCode, steelGradeId: next.steelGradeId, thicknessMm: next.thicknessMm, widthMm: next.widthMm, lengthMm: next.lengthMm, theoreticalWeightTon: weight });
      }
      if (dto.yardId !== undefined && dto.yardId !== before.yardId) {
        await this.assertYard(tx, dto.yardId, before.item.itemType);
        data.yardId = dto.yardId;
      }
      if (!Object.keys(data).length) return toProductSpecView(before, (await this.repo.usedSpecIds(tx, [id])).has(id));

      const row = await this.repo.update(tx, id, data);
      await this.changes.record(tx, user, {
        targetNo: row.specCode, targetId: row.id,
        summary: identityChanged ? `제품 규격 ${row.specCode} 수정 (이론중량 ${row.theoreticalWeightTon.toFixed(3)}t)` : `제품 규격 ${row.specCode} 수정`,
        before: specSnapshot(before), after: specSnapshot(row),
      });
      return toProductSpecView(row, (await this.repo.usedSpecIds(tx, [id])).has(id));
    });
  }

  activate(id: number, user: AuthUser) {
    return this.setActive(id, true, user);
  }
  deactivate(id: number, user: AuthUser) {
    return this.setActive(id, false, user);
  }

  private async setActive(id: number, isActive: boolean, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('제품 규격');
      if (before.isActive === isActive) return toProductSpecView(before, (await this.repo.usedSpecIds(tx, [id])).has(id));
      const row = await this.repo.update(tx, id, { isActive });
      await this.changes.record(tx, user, { targetNo: row.specCode, targetId: row.id, summary: `제품 규격 ${row.specCode} ${isActive ? '사용' : '사용 중지'}`, before: specSnapshot(before), after: specSnapshot(row) });
      return toProductSpecView(row, (await this.repo.usedSpecIds(tx, [id])).has(id));
    });
  }

  /** itemId 또는 itemType으로 슬래브·코일 품목을 정한다. */
  private async resolveItem(tx: Tx, dto: CreateProductSpecDto) {
    if (dto.itemId === undefined && !dto.itemType) throw badInput('품목(itemId) 또는 품목 유형(itemType)을 입력해 주세요');
    const item = dto.itemId !== undefined
      ? await tx.item.findUnique({ where: { id: dto.itemId } })
      : await tx.item.findFirst({ where: { itemType: dto.itemType, isActive: true }, orderBy: { id: 'asc' } });
    if (!item) throw notFound('품목');
    if (item.itemType !== ITEM_TYPE.SLAB && item.itemType !== ITEM_TYPE.COIL) throw badInput('제품 규격은 슬래브·코일 품목에만 등록할 수 있습니다');
    if (dto.itemType && dto.itemId !== undefined && item.itemType !== dto.itemType) throw badInput('품목과 품목 유형이 맞지 않습니다');
    if (!item.isActive) throw badInput(`사용 중지된 품목입니다 (${item.itemCode})`);
    return item;
  }

  private async assertYard(tx: Tx, yardId: number | null | undefined, itemType: string) {
    if (yardId === null || yardId === undefined) return;
    const y = await tx.yard.findUnique({ where: { id: yardId } });
    if (!y) throw notFound('야드');
    if (!y.isActive) throw badInput(`사용 중지된 야드입니다 (${y.yardCode})`);
    const expected = itemType === ITEM_TYPE.COIL ? YARD_TYPE.COIL : YARD_TYPE.SLAB;
    if (y.yardType !== expected) throw badInput(`${ITEM_TYPE_LABEL[itemType as ItemType]} 규격은 ${expected === YARD_TYPE.COIL ? '코일' : '슬래브'} 야드에 지정해 주세요`);
  }
}
