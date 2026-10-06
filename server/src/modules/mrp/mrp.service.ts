import { Injectable } from '@nestjs/common';
import { RAW_MATERIAL_TYPE, type MrpRequirementsView, type ProductionPlanStatus, type RawMaterialType } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { materialTotals, netRequirements, planRequirements, tonText, type MrpDemand, type MrpSupply } from './mrp.calculator';
import type { MrpRequirementsQuery } from './dto/mrp.dto';
import { MrpRepository } from './mrp.repository';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isValidDate = (s: string) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) && dateOnly(new Date(`${s}T00:00:00.000Z`)) === s;

/**
 * MRP 소요량 계산 조회 (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4, docs/backend/mrp.md). 저장하지 않는다.
 * 구현 기준(mrp.md 8장 확인 필요 항목을 이렇게 정했다):
 * - 대상: 계획·진행 중 생산계획의 남은 히트(저장된 히트 수 − 만든 히트 LOT 수)
 * - 필요일: 연결 수주 품목 납기, 수주 연결이 없으면(재생산·수주 해제) 계획 등록일
 * - 차감: 기간과 관계없이 열린 계획 전부를 필요일 순으로 차감하고, 필요일 ≤ to인 계획만 보인다
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MrpRepository,
  ) {}

  async requirements(query: MrpRequirementsQuery): Promise<MrpRequirementsView> {
    if (!isValidDate(query.from) || !isValidDate(query.to)) throw new AppException('COM-004', '기간에 없는 날짜가 있어요');
    if (query.from > query.to) throw new AppException('COM-004', '종료일은 시작일과 같거나 뒤여야 해요');

    const db = this.prisma;
    const [setting, plans, materials, consumptions, routings, remainings, openItems] = await Promise.all([
      this.repository.findSetting(db),
      this.repository.findOpenPlans(db),
      this.repository.findRawMaterials(db),
      this.repository.findSpecificConsumptions(db),
      this.repository.findSteelmakingRoutings(db),
      this.repository.sumRemainingByItem(db),
      this.repository.findOpenPurchaseOrderItems(db),
    ]);
    if (!setting) throw new AppException('MST-001', '히트 용량 설정이 없어요');
    const planIds = plans.map((p) => p.id);
    const [heatLots, requisitions] = await Promise.all([this.repository.countHeatLots(db, planIds), this.repository.findRequisitionsForPlans(db, planIds)]);
    const madeHeats = new Map(heatLots.map((h) => [h.production_plan_id, h.heat_lot_count ?? 0]));
    const isFerroalloy = (m: { rawMaterialType: string | null }) => m.rawMaterialType === RAW_MATERIAL_TYPE.FERROALLOY;

    const openPlans = plans.flatMap((plan) => {
      const remainingHeatCount = plan.heatCount - (madeHeats.get(plan.id) ?? 0);
      if (remainingHeatCount <= 0) return [];
      const yieldRate = routings.find((r) => r.itemType === plan.item.itemType)?.plannedYieldRate;
      if (!yieldRate) throw new AppException('MST-001', `${plan.item.itemType} 제강 계획 수율이 없어요`);
      const rates = materials.flatMap((m) => {
        const found = consumptions.find((c) => c.rawMaterialItemId === m.id && (isFerroalloy(m) ? c.steelGradeId === plan.item.steelGradeId : c.steelGradeId === null));
        return found ? [{ itemId: m.id, isFerroalloy: isFerroalloy(m), consumptionRate: found.consumptionRate }] : [];
      });
      if (!rates.some((r) => !r.isFerroalloy)) throw new AppException('MST-001', '용선 1t당 원단위가 없어요');
      const heatTon = setting.heatCapacityTon.mul(remainingHeatCount);
      const required = planRequirements(heatTon, yieldRate, rates);
      const requiredDate = plan.salesOrderItem ? dateOnly(plan.salesOrderItem.dueDate) : seoulToday(plan.createdAt);
      return [{ plan, remainingHeatCount, heatTon, requiredDate, ...required }];
    });

    const demands: MrpDemand[] = openPlans.flatMap((p) => p.materials.map((m) => ({ productionPlanId: p.plan.id, itemId: m.itemId, requiredDate: p.requiredDate, requiredTon: m.requiredTon })));
    const supplies: MrpSupply[] = [
      ...remainings.flatMap((r): MrpSupply[] =>
        r.item_id !== null && r.remaining_ton !== null ? [{ kind: 'REMAINING', itemId: r.item_id, ton: new Prisma.Decimal(r.remaining_ton), availableDate: null, reservedForPlanId: null, sourceId: r.item_id }] : [],
      ),
      ...openItems.map((o): MrpSupply => ({
        kind: 'SCHEDULED',
        itemId: o.item_id,
        ton: new Prisma.Decimal(o.scheduled_receipt_ton ?? 0),
        availableDate: o.expected_receipt_date ? dateOnly(o.expected_receipt_date) : null,
        reservedForPlanId: o.production_plan_id,
        sourceId: o.purchase_order_item_id,
      })),
    ];
    const isShown = (requiredDate: string) => requiredDate <= query.to;
    const lines = netRequirements(demands, supplies).filter((l) => isShown(l.requiredDate));
    const itemOf = new Map(materials.map((m) => [m.id, m]));
    const planOf = new Map(openPlans.map((p) => [p.plan.id, p.plan]));

    return {
      from: query.from,
      to: query.to,
      heatCapacityTon: tonText(setting.heatCapacityTon),
      plans: openPlans
        .filter((p) => isShown(p.requiredDate))
        .sort((a, b) => a.requiredDate.localeCompare(b.requiredDate) || a.plan.id - b.plan.id)
        .map((p) => ({
          productionPlanId: p.plan.id,
          productionPlanNo: p.plan.productionPlanNo,
          productionPlanStatus: p.plan.productionPlanStatus as ProductionPlanStatus,
          salesOrderNo: p.plan.salesOrderItem?.salesOrder.salesOrderNo ?? null,
          itemCode: p.plan.item.itemCode,
          itemName: p.plan.item.itemName,
          steelGradeCode: p.plan.item.steelGrade?.steelGradeCode ?? null,
          requiredDate: p.requiredDate,
          isBeforePeriod: p.requiredDate < query.from,
          remainingHeatCount: p.remainingHeatCount,
          heatTon: tonText(p.heatTon),
          requiredHotMetalTon: tonText(p.requiredHotMetalTon),
          materials: lines
            .filter((l) => l.productionPlanId === p.plan.id)
            .map((l) => ({ itemId: l.itemId, itemCode: itemOf.get(l.itemId)?.itemCode ?? '', requiredTon: tonText(l.requiredTon), netRequirementTon: tonText(l.netRequirementTon) })),
        })),
      materials: materialTotals(materials.map((m) => m.id), lines, supplies).map((t) => {
        const m = itemOf.get(t.itemId);
        return {
          itemId: t.itemId,
          itemCode: m?.itemCode ?? '',
          itemName: m?.itemName ?? '',
          rawMaterialType: (m?.rawMaterialType ?? null) as RawMaterialType | null,
          requiredTon: tonText(t.requiredTon),
          remainingTon: tonText(t.remainingTon),
          scheduledReceiptTon: tonText(t.scheduledReceiptTon),
          usedRemainingTon: tonText(t.usedRemainingTon),
          usedScheduledReceiptTon: tonText(t.usedScheduledReceiptTon),
          netRequirementTon: tonText(t.netRequirementTon),
          firstShortageDate: t.firstShortageDate,
        };
      }),
      requisitionLines: lines
        .filter((l) => l.netRequirementTon.gt(0))
        .map((l) => ({
          productionPlanId: l.productionPlanId,
          productionPlanNo: planOf.get(l.productionPlanId)?.productionPlanNo ?? '',
          itemId: l.itemId,
          itemCode: itemOf.get(l.itemId)?.itemCode ?? '',
          itemName: itemOf.get(l.itemId)?.itemName ?? '',
          netRequirementTon: tonText(l.netRequirementTon),
          requiredDate: l.requiredDate,
          existingPurchaseRequisitionNo: requisitions.find((r) => r.productionPlanId === l.productionPlanId && r.itemId === l.itemId)?.purchaseRequisitionNo ?? null,
        })),
    };
  }
}
