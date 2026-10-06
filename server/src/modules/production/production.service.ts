import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE, ITEM_TYPE, PROCESS_TYPE, PRODUCTION_PLAN_STATUS, type AuthUser, type ItemType } from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { calcHeatPlan, hotRollingYieldRateOf, type HeatPlan } from './heat-plan.calculator';
import { ProductionRepository } from './production.repository';

type Actor = AuthUser | 'SYSTEM';

const planSnapshot = (p: { id: number; productionPlanNo: string; salesOrderItemId: number | null; itemId: number; shortageQty: number; heatCount: number; productionPlanStatus: string }) => ({
  id: p.id,
  productionPlanNo: p.productionPlanNo,
  salesOrderItemId: p.salesOrderItemId,
  itemId: p.itemId,
  shortageQty: p.shortageQty,
  heatCount: p.heatCount,
  productionPlanStatus: p.productionPlanStatus,
});

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 트랜잭션: this.prisma.$transaction(async (tx) => { ... }) 안에서 repository와 businessEventRecorder.record(tx, ...)를 부른다.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ProductionRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
  ) {}

  /** 히트 편성 계산 (4.4). 수율·매핑·히트 용량이 없으면 MST-001 */
  async calcHeatPlanForItem(tx: Tx, itemId: number, shortageQty: number): Promise<HeatPlan> {
    const item = await this.repository.findItemForPlan(tx, itemId);
    if (!item?.theoreticalWeightTon) throw new AppException('MST-001', '규격의 이론중량이 없어요');
    const itemType = item.itemType as ItemType;
    const routings = await this.repository.findRoutings(tx, itemType);
    const yieldOf = (processType: string) => routings.find((r) => r.processType === processType)?.plannedYieldRate ?? null;
    const castingYieldRate = yieldOf(PROCESS_TYPE.CONTINUOUS_CASTING);
    const steelmakingYieldRate = yieldOf(PROCESS_TYPE.STEELMAKING);
    if (!castingYieldRate || !steelmakingYieldRate) throw new AppException('MST-001', '제강·연주 계획 수율이 없어요');
    let hotRollingYieldRate: Prisma.Decimal | null = null;
    if (itemType === ITEM_TYPE.COIL) {
      const slabWeight = item.specMappingAsCoilItem?.slabItem.theoreticalWeightTon;
      if (!slabWeight) throw new AppException('MST-001', '코일 규격에 대응하는 슬래브 규격 매핑이 없어요');
      hotRollingYieldRate = hotRollingYieldRateOf(item.theoreticalWeightTon, slabWeight);
    }
    const setting = await this.repository.findProductionSetting(tx);
    if (!setting) throw new AppException('MST-001', '히트 용량 설정값이 없어요');
    return calcHeatPlan({
      shortageQty,
      theoreticalWeightTon: item.theoreticalWeightTon,
      castingYieldRate,
      hotRollingYieldRate,
      steelmakingYieldRate,
      heatCapacityTon: setting.heatCapacityTon,
    });
  }

  /** 수주 등록의 부족분 생산계획 (REQ-PRD-001). 수주 등록 트랜잭션 안에서 sales-order가 부른다 */
  async createPlanForShortage(tx: Tx, input: { salesOrderId: number; salesOrderItemId: number; itemId: number; shortageQty: number; actor: Actor }) {
    const heat = await this.calcHeatPlanForItem(tx, input.itemId, input.shortageQty);
    const plan = await this.repository.createPlan(tx, {
      productionPlanNo: await this.numbering.nextDocumentNumber(tx, 'PRODUCTION_PLAN'),
      salesOrderItemId: input.salesOrderItemId,
      itemId: input.itemId,
      shortageQty: input.shortageQty,
      heatCount: heat.heatCount,
      productionPlanStatus: PRODUCTION_PLAN_STATUS.PLANNED,
    });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CREATED,
      actor: input.actor,
      target: { table: 'production_plan', id: plan.id },
      salesOrderId: input.salesOrderId,
      after: { ...planSnapshot(plan), targetTon: heat.targetTon, heatTon: heat.heatTon },
      reason: `ORDER_SHORTAGE: 재고 부족 ${input.shortageQty}매를 생산계획으로 (히트 ${heat.heatCount}개, 목표 ${heat.targetTon}t)`,
    });
    return plan;
  }

  /**
   * 수주 품목 취소 (BP-SO-02): 시작 전 계획은 취소, 진행중 계획은 수주 연결을 풀어 산출물을 여재로 둔다.
   * 두 경우 모두 그 계획의 확정 열연 배정을 해제한다. 완료 계획은 그대로 둔다(합격 제품은 예약 해제로 이미 가용 재고다).
   */
  async detachOrCancelPlansForSalesOrderItem(tx: Tx, input: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; actor: Actor }) {
    const cancelledPlanNos: string[] = [];
    const unlinkedPlanNos: string[] = [];
    const allocationReason = `ORDER_CANCELLED: 수주 ${input.salesOrderNo} 취소로 열연 배정 해제`;
    for (const plan of await this.repository.findPlansOfSalesOrderItem(tx, input.salesOrderItemId)) {
      if (plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.PLANNED) {
        await this.inventory.releaseHotRollingAllocationsOfPlan(tx, { productionPlanId: plan.id, salesOrderId: input.salesOrderId, actor: input.actor, reason: allocationReason });
        const cancelled = await this.repository.updatePlan(tx, plan.id, { productionPlanStatus: PRODUCTION_PLAN_STATUS.CANCELLED });
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED,
          actor: input.actor,
          target: { table: 'production_plan', id: plan.id },
          salesOrderId: input.salesOrderId,
          before: planSnapshot(plan),
          after: planSnapshot(cancelled),
          reason: `ORDER_CANCELLED: 수주 ${input.salesOrderNo} 취소로 시작 전 계획 취소`,
        });
        cancelledPlanNos.push(plan.productionPlanNo);
      } else if (plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.IN_PROGRESS) {
        await this.inventory.releaseHotRollingAllocationsOfPlan(tx, { productionPlanId: plan.id, salesOrderId: input.salesOrderId, actor: input.actor, reason: allocationReason });
        const unlinked = await this.repository.updatePlan(tx, plan.id, { salesOrderItemId: null });
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.SURPLUS_CONVERTED,
          actor: input.actor,
          target: { table: 'production_plan', id: plan.id },
          salesOrderId: input.salesOrderId,
          before: planSnapshot(plan),
          after: planSnapshot(unlinked),
          reason: `SURPLUS_CONVERSION: 수주 ${input.salesOrderNo} 취소로 진행중 계획의 수주 연결을 풀고 산출물을 여재로 전환`,
        });
        unlinkedPlanNos.push(plan.productionPlanNo);
      }
    }
    return { cancelledPlanNos, unlinkedPlanNos };
  }
}
