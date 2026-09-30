import { Injectable } from '@nestjs/common';
import { RAW_MATERIAL_TYPE_LABEL, YARD_TYPE, type AuthUser, type RawMaterialType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { badInput, notFound } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ListRawMaterialsDto } from './dto/list-raw-materials.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { assertSupplier } from './item.service';
import { MasterChangeRecorder } from './master-change.recorder';
import { duplicate, parseActive } from './master-data.util';
import { RawMaterialRepository, type RawMaterialRow } from './raw-material.repository';

export const toRawMaterialView = (r: RawMaterialRow) => ({
  id: r.id,
  itemId: r.itemId,
  itemCode: r.item.itemCode,
  itemName: r.item.itemName,
  materialCode: r.materialCode,
  rawMaterialType: r.rawMaterialType,
  rawMaterialTypeName: RAW_MATERIAL_TYPE_LABEL[r.rawMaterialType as RawMaterialType] ?? r.rawMaterialType,
  unitType: r.item.unitType,
  yardId: r.yardId,
  yardName: r.yard?.yardName ?? null,
  defaultSupplierId: r.item.defaultSupplierId,
  defaultSupplierName: r.item.defaultSupplier?.supplierName ?? null,
  onHandTon: r.inventories[0]?.onHandTon ?? new Prisma.Decimal(0),
  isActive: r.item.isActive,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function assertRawYard(tx: Tx, yardId: number | null | undefined): Promise<void> {
  if (yardId === null || yardId === undefined) return;
  const y = await tx.yard.findUnique({ where: { id: yardId } });
  if (!y) throw notFound('야드');
  if (!y.isActive) throw badInput(`사용 중지된 야드입니다 (${y.yardCode})`);
  if (y.yardType !== YARD_TYPE.RAW_MATERIAL) throw badInput('원료는 원료 야드에만 지정할 수 있습니다');
}

@Injectable()
export class RawMaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RawMaterialRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListRawMaterialsDto) {
    const active = parseActive(q.active);
    const where: Prisma.RawMaterialWhereInput = {
      ...(q.rawMaterialType ? { rawMaterialType: q.rawMaterialType } : {}),
      ...(active !== undefined ? { item: { isActive: active } } : {}),
      ...(q.q ? { OR: [{ materialCode: { contains: q.q, mode: 'insensitive' } }, { item: { itemName: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    return (await this.repo.findMany(this.prisma, where)).map(toRawMaterialView);
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('원료');
    return toRawMaterialView(row);
  }

  /** 원료 등록: 품목 + 원료 상세 + 재고 행을 한 트랜잭션에서 만든다 (REQ-MST-001). */
  async create(dto: CreateRawMaterialDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const itemCode = `RM-${dto.materialCode}`;
      if (await this.repo.findByMaterialCode(tx, dto.materialCode)) throw duplicate(`이미 등록된 원료 코드입니다 (${dto.materialCode})`);
      if (await tx.item.findUnique({ where: { itemCode } })) throw duplicate(`이미 등록된 품목 코드입니다 (${itemCode})`);
      await assertRawYard(tx, dto.yardId);
      await assertSupplier(tx, dto.defaultSupplierId);
      const row = await this.repo.createWithInventory(tx, {
        itemCode,
        itemName: dto.itemName,
        materialCode: dto.materialCode,
        rawMaterialType: dto.rawMaterialType,
        yardId: dto.yardId ?? null,
        defaultSupplierId: dto.defaultSupplierId ?? null,
      });
      await this.changes.record(tx, user, { targetNo: row.materialCode, targetId: row.id, summary: `원료 ${row.materialCode}(${row.item.itemName}) 등록`, after: toRawMaterialView(row) });
      return toRawMaterialView(row);
    });
  }

  async update(id: number, dto: UpdateRawMaterialDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('원료');
      if (dto.yardId !== undefined) await assertRawYard(tx, dto.yardId);
      if (dto.defaultSupplierId !== undefined) await assertSupplier(tx, dto.defaultSupplierId);
      const itemData: Prisma.ItemUncheckedUpdateInput = {
        ...(dto.itemName !== undefined ? { itemName: dto.itemName } : {}),
        ...(dto.defaultSupplierId !== undefined ? { defaultSupplierId: dto.defaultSupplierId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      };
      if (Object.keys(itemData).length) await this.repo.updateItem(tx, before.itemId, itemData);
      if (dto.yardId !== undefined) await this.repo.updateDetail(tx, id, { yardId: dto.yardId });
      const row = (await this.repo.findById(tx, id))!;
      await this.changes.record(tx, user, {
        targetNo: row.materialCode, targetId: row.id, summary: `원료 ${row.materialCode}(${row.item.itemName}) 수정`,
        before: toRawMaterialView(before), after: toRawMaterialView(row),
      });
      return toRawMaterialView(row);
    });
  }
}
