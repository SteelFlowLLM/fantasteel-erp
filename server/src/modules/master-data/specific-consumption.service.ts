import { Injectable } from '@nestjs/common';
import { CONSUMPTION_UNIT_LABEL, RAW_MATERIAL_TYPE_LABEL, type AuthUser, type ConsumptionUnit, type RawMaterialType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { lockRawMaterialInventory } from '../../common/concurrency/locks';
import { badInput, notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { ListSpecificConsumptionsDto } from './dto/list-specific-consumptions.dto';
import { UpsertSpecificConsumptionDto } from './dto/upsert-specific-consumption.dto';
import { MasterChangeRecorder } from './master-change.recorder';
import { consumptionRuleFor } from './specific-consumption.rules';
import { SpecificConsumptionRepository, type SpecificConsumptionRow } from './specific-consumption.repository';

export const toSpecificConsumptionView = (c: SpecificConsumptionRow) => ({
  id: c.id,
  rawMaterialId: c.rawMaterialId,
  materialCode: c.rawMaterial.materialCode,
  rawMaterialName: c.rawMaterial.item.itemName,
  rawMaterialType: c.rawMaterial.rawMaterialType,
  rawMaterialTypeName: RAW_MATERIAL_TYPE_LABEL[c.rawMaterial.rawMaterialType as RawMaterialType] ?? c.rawMaterial.rawMaterialType,
  steelGradeId: c.steelGradeId,
  steelGradeCode: c.steelGrade?.steelGradeCode ?? null,
  consumptionRate: c.consumptionRate,
  consumptionUnit: c.consumptionUnit,
  consumptionUnitName: CONSUMPTION_UNIT_LABEL[c.consumptionUnit as ConsumptionUnit] ?? c.consumptionUnit,
  updatedAt: c.updatedAt,
});

@Injectable()
export class SpecificConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SpecificConsumptionRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListSpecificConsumptionsDto) {
    const where: Prisma.SpecificConsumptionWhereInput = {
      ...(q.rawMaterialId ? { rawMaterialId: q.rawMaterialId } : {}),
      ...(q.steelGradeId ? { steelGradeId: q.steelGradeId } : {}),
    };
    return (await this.repo.findMany(this.prisma, where)).map(toSpecificConsumptionView);
  }

  /** (원료, 강종)에 값이 있으면 고치고 없으면 등록한다. */
  async upsert(dto: UpsertSpecificConsumptionDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const raw = await tx.rawMaterial.findUnique({ where: { id: dto.rawMaterialId }, include: { item: true } });
      if (!raw) throw notFound('원료');
      const rule = consumptionRuleFor(raw.rawMaterialType, dto.steelGradeId);
      // 공통값(강종 null)은 DB unique가 막지 못하므로 원료 행을 잠가 같은 키의 동시 등록을 순서대로 처리한다.
      await lockRawMaterialInventory(tx, raw.id);
      if (rule.steelGradeId !== null) {
        const grade = await tx.steelGrade.findUnique({ where: { id: rule.steelGradeId } });
        if (!grade) throw notFound('강종');
        if (!grade.isActive) throw badInput(`사용 중지된 강종입니다 (${grade.steelGradeCode})`);
      }
      const before = await this.repo.findByKey(tx, raw.id, rule.steelGradeId);
      const row = before
        ? await this.repo.update(tx, before.id, dto.consumptionRate, rule.unit)
        : await this.repo.create(tx, { rawMaterialId: raw.id, steelGradeId: rule.steelGradeId, consumptionRate: dto.consumptionRate, consumptionUnit: rule.unit });
      const view = toSpecificConsumptionView(row);
      const label = `${view.rawMaterialName}${view.steelGradeCode ? ` / ${view.steelGradeCode}` : ' (공통)'}`;
      await this.changes.record(tx, user, {
        targetNo: `${raw.materialCode}${view.steelGradeCode ? `-${view.steelGradeCode}` : ''}`, targetId: row.id,
        summary: `배합 원단위 ${label} ${before ? '수정' : '등록'}: ${view.consumptionRate.toString()} ${view.consumptionUnit === 'KG_PER_TON' ? 'kg/t' : 't/t'}`,
        before: before ? toSpecificConsumptionView(before) : undefined, after: view,
      });
      return view;
    });
  }

  async remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('배합 원단위');
      await this.repo.delete(tx, id);
      const view = toSpecificConsumptionView(before);
      await this.changes.record(tx, user, {
        targetNo: `${before.rawMaterial.materialCode}${before.steelGrade ? `-${before.steelGrade.steelGradeCode}` : ''}`, targetId: id,
        summary: `배합 원단위 ${view.rawMaterialName}${view.steelGradeCode ? ` / ${view.steelGradeCode}` : ' (공통)'} 삭제`, before: view,
      });
      return { id, deleted: true };
    });
  }
}
