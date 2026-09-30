import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, ITEM_TYPE_LABEL, UNIT_TYPE, type AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { badInput, notFound } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { ListItemsDto } from './dto/list-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemRepository, type ItemRow } from './item.repository';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive } from './master-data.util';

export const toItemView = (i: ItemRow) => ({
  id: i.id,
  itemCode: i.itemCode,
  itemName: i.itemName,
  itemType: i.itemType,
  itemTypeName: ITEM_TYPE_LABEL[i.itemType as keyof typeof ITEM_TYPE_LABEL] ?? i.itemType,
  unitType: i.unitType,
  defaultSupplierId: i.defaultSupplierId,
  defaultSupplierName: i.defaultSupplier?.supplierName ?? null,
  rawMaterialId: i.rawMaterial?.id ?? null,
  isActive: i.isActive,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

/** 품목 유형에서 정해지는 단위 (제품 = 매수 QTY, 원료 = 톤 TON). REQ-MST-001 */
export const unitTypeOf = (itemType: string): string => (itemType === ITEM_TYPE.RAW_MATERIAL ? UNIT_TYPE.TON : UNIT_TYPE.QTY);

/** 기본 공급업체가 있고 사용 중인지 확인한다. */
export async function assertSupplier(tx: Tx, supplierId: number | null | undefined): Promise<void> {
  if (supplierId === null || supplierId === undefined) return;
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound('공급업체');
  if (!s.isActive) throw badInput(`사용 중지된 공급업체입니다 (${s.supplierCode})`);
}

@Injectable()
export class ItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ItemRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListItemsDto) {
    const where: Prisma.ItemWhereInput = {
      ...(q.itemType ? { itemType: q.itemType } : {}),
      ...(parseActive(q.active) !== undefined ? { isActive: parseActive(q.active) } : {}),
      ...(q.q ? { OR: [{ itemCode: { contains: q.q, mode: 'insensitive' } }, { itemName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    return (await this.repo.findMany(this.prisma, where)).map(toItemView);
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('품목');
    return toItemView(row);
  }

  /** 슬래브·코일 품목 등록. 원료 품목은 원료 상세·재고 행이 함께 필요해 /raw-materials 에서만 만든다. */
  async create(dto: CreateItemDto, user: AuthUser) {
    if (dto.itemType === ITEM_TYPE.RAW_MATERIAL) throw badInput('원료 품목은 원료 등록(/raw-materials)에서 만들어 주세요');
    if (dto.unitType && dto.unitType !== unitTypeOf(dto.itemType)) throw badInput('제품(슬래브·코일)의 단위 유형은 QTY(매수)입니다');
    return this.prisma.tx(async (tx) => {
      if (await this.repo.findByCode(tx, dto.itemCode)) throw duplicate(`이미 등록된 품목 코드입니다 (${dto.itemCode})`);
      await assertSupplier(tx, dto.defaultSupplierId);
      const row = await this.repo.create(tx, {
        itemCode: dto.itemCode,
        itemName: dto.itemName,
        itemType: dto.itemType,
        unitType: unitTypeOf(dto.itemType),
        defaultSupplierId: dto.defaultSupplierId ?? null,
      });
      await this.changes.record(tx, user, { targetNo: row.itemCode, targetId: row.id, summary: `품목 ${row.itemCode} 등록`, after: toItemView(row) });
      return toItemView(row);
    });
  }

  async update(id: number, dto: UpdateItemDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('품목');
      if (dto.defaultSupplierId !== undefined) await assertSupplier(tx, dto.defaultSupplierId);
      const row = await this.repo.update(tx, id, {
        ...(dto.itemName !== undefined ? { itemName: dto.itemName } : {}),
        ...(dto.defaultSupplierId !== undefined ? { defaultSupplierId: dto.defaultSupplierId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
      await this.changes.record(tx, user, { targetNo: row.itemCode, targetId: row.id, summary: `품목 ${row.itemCode} 수정`, before: toItemView(before), after: toItemView(row) });
      return toItemView(row);
    });
  }
}
