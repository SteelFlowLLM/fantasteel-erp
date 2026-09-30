import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { NotificationSender } from '../notification/notification.sender';
import { SalesOrderStatusService } from '../sales-order/sales-order-status.service';
import { type LotRow, type PlanRow, ProductionRepository } from './production.repository';

const UPSTREAM = ['IRONMAKING', 'STEELMAKING', 'CASTING'];

export interface PlanFacts {
  itemType: 'SLAB' | 'COIL';
  /** 제선·제강·연주 실적이 모두 완료됐는지 */
  upstreamDone: boolean;
  /** 아직 연주하지 않은 히트의 슬래브 계획 매수 합계 */
  uncastQty: number;
  /** 판정을 기다리는 LOT 수 (히트·슬래브·코일). 불합격 히트의 하위 LOT은 기다리지 않는다 */
  unsettledLotCount: number;
  /** 아직 이 계획의 목표에 쓰일 수 있는 매수 (잔여 목표 계산용) */
  potentialQty: number;
  rolledQty: number;
  confirmedRollingAllocationQty: number;
  earmarkedSlabQty: number;
  rollingDone: boolean;
}

const heatFailed = (l: LotRow) => l.heatLot?.isPassed === false;
const unsettled = (l: LotRow) => l.isPassed === null && !heatFailed(l);
const eligible = (l: LotRow) => l.lotStatus === 'IN_STOCK' && l.isPassed === true && l.heatLot?.isPassed === true;

/**
 * 생산계획 상태 전이와 "진행 계획 잔여 목표 매수" 계산.
 * 실적 완료와 검사 판정 뒤에 refresh를 불러 계획 완료 여부를 다시 본다 (품질 모듈도 호출).
 *
 * 계획 완료(COMPLETED) 조건 — 모두 만족해야 한다.
 *  1) 제선·제강·연주 실적이 전부 COMPLETED
 *  2) 이 계획이 만든 히트·슬래브·코일 LOT이 모두 판정됨 (불합격 히트의 하위 LOT은 판정된 것으로 본다)
 *  3) 코일 계획이면 열연이 끝남: 작업 중인 열연 실적과 CONFIRMED 열연 배정이 없고,
 *     (압연한 코일 수 ≥ 목표 매수) 또는 (수주 품목에 귀속된 적격 슬래브가 더 없음)
 */
@Injectable()
export class ProductionPlanProgressService {
  constructor(
    private readonly repo: ProductionRepository,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly salesOrderStatus: SalesOrderStatusService,
    private readonly realtime: RealtimeService,
  ) {}

  async facts(tx: Tx, plan: PlanRow): Promise<PlanFacts> {
    const itemType = plan.productSpec.item.itemType as 'SLAB' | 'COIL';
    const results = plan.productionResults;
    const upstreamDone = results.filter((r) => UPSTREAM.includes(r.processCode)).every((r) => r.productionResultStatus === 'COMPLETED');
    const uncastQty = results.filter((r) => r.processCode === 'CASTING' && r.productionResultStatus !== 'COMPLETED').reduce((s, r) => s + (r.plannedQty ?? 0), 0);
    const lots = (await this.repo.planLots(tx, plan.id)).filter((l) => l.lotType !== 'HOT_METAL');
    const unsettledLotCount = lots.filter(unsettled).length;
    const slabs = lots.filter((l) => l.lotType === 'SLAB');
    const itemId = plan.salesOrderItemId;

    if (itemType === 'SLAB') {
      // 적격이 된 슬래브는 이미 재고 풀에 들어가 자동 예약까지 끝났으므로 더 기대할 것이 아니다.
      const waiting = slabs.filter((l) => l.lotStatus === 'IN_STOCK' && l.isPassed !== false && !heatFailed(l) && !eligible(l)).length;
      return { itemType, upstreamDone, uncastQty, unsettledLotCount, potentialQty: uncastQty + waiting, rolledQty: 0, confirmedRollingAllocationQty: 0, earmarkedSlabQty: 0, rollingDone: true };
    }

    const coils = lots.filter((l) => l.lotType === 'COIL');
    const rolledQty = coils.length;
    const pendingCoilQty = coils.filter(unsettled).length;
    const waitingSlabQty = slabs.filter((l) => l.lotStatus === 'IN_STOCK' && l.isPassed !== false && !heatFailed(l) && !eligible(l)).length;
    const earmarkedSlabQty = itemId ? (await this.repo.earmarkedSlabs(tx, itemId)).length : 0;
    const confirmedRollingAllocationQty = await this.repo.countConfirmedRollingAllocations(tx, plan.id);
    const rollingStarted = results.some((r) => r.processCode === 'HOT_ROLLING' && r.productionResultStatus === 'STARTED');
    const rollingDone = !rollingStarted && confirmedRollingAllocationQty === 0 && (rolledQty >= plan.shortageQty || earmarkedSlabQty === 0);
    return {
      itemType, upstreamDone, uncastQty, unsettledLotCount,
      potentialQty: uncastQty + waitingSlabQty + earmarkedSlabQty + pendingCoilQty,
      rolledQty, confirmedRollingAllocationQty, earmarkedSlabQty, rollingDone,
    };
  }

  /**
   * 진행 계획의 잔여 목표 매수 (업무 프로세스 정의서 4.5).
   * 편성 전(PLANNED)은 목표 매수 전부, 편성 후에는 min(목표 매수, 아직 나올 수 있는 매수).
   */
  async remainingTargetQty(tx: Tx, plan: PlanRow): Promise<number> {
    if (plan.productionPlanStatus === 'PLANNED') return plan.shortageQty;
    if (plan.productionPlanStatus !== 'CONFIRMED' && plan.productionPlanStatus !== 'IN_PROGRESS') return 0;
    return Math.min(plan.shortageQty, (await this.facts(tx, plan)).potentialQty);
  }

  /** 첫 작업 시작: CONFIRMED → IN_PROGRESS. */
  async markStarted(tx: Tx, plan: PlanRow): Promise<void> {
    if (plan.productionPlanStatus !== 'CONFIRMED') return;
    await this.repo.updatePlan(tx, plan.id, { productionPlanStatus: 'IN_PROGRESS' });
    if (plan.salesOrderItemId) await this.salesOrderStatus.recalcItem(tx, plan.salesOrderItemId);
    this.realtime.changed('production-plans');
  }

  /** 실적 완료·검사 판정 뒤에 부른다. 완료 조건을 만족하면 COMPLETED로 바꾼다. 바꿨으면 true. */
  async refresh(tx: Tx, productionPlanId: number, actor: AuthUser | null = null): Promise<boolean> {
    const plan = await this.repo.findPlan(tx, productionPlanId);
    if (!plan || plan.productionPlanStatus !== 'IN_PROGRESS') return false;
    const f = await this.facts(tx, plan);
    if (!f.upstreamDone || f.unsettledLotCount > 0 || !f.rollingDone) return false;

    const now = new Date();
    await this.repo.deleteReadyRollingResults(tx, plan.id);
    await this.repo.updatePlan(tx, plan.id, { productionPlanStatus: 'COMPLETED', completedAt: now });
    const item = plan.salesOrderItem;
    const lots = (await this.repo.planLots(tx, plan.id)).filter((l) => l.lotType === f.itemType);
    const passed = lots.filter((l) => l.isPassed === true && l.heatLot?.isPassed === true).length;
    const unit = f.itemType === 'COIL' ? '개' : '매';
    await this.events.record(tx, {
      actor,
      eventType: 'WORK_COMPLETED',
      targetType: 'PRODUCTION_PLAN',
      targetId: plan.id,
      targetNo: plan.productionPlanNo,
      salesOrderId: item?.salesOrderId ?? null,
      summary: `생산계획 ${plan.productionPlanNo} 완료 (목표 ${plan.shortageQty}${unit}, 합격 ${passed}${unit}, 미합격 ${lots.length - passed}${unit})`,
      before: { productionPlanStatus: 'IN_PROGRESS' },
      after: { productionPlanStatus: 'COMPLETED', passedQty: passed, producedQty: lots.length },
    });
    if (item) {
      await this.salesOrderStatus.recalcItem(tx, item.id);
      await this.notifications.toEmployees(tx, [item.salesOrder.ownerEmployeeId], {
        notificationType: 'PRODUCTION',
        title: `생산계획 ${plan.productionPlanNo} 완료`,
        body: `${item.salesOrder.salesOrderNo} #${item.lineNo} 생산·검사 완료 (합격 ${passed}${unit} / 목표 ${plan.shortageQty}${unit})`,
        linkPath: `/sales-orders/${item.salesOrderId}`,
        dedupeKey: `PLAN_COMPLETED:${plan.id}`,
        excludeEmployeeId: actor?.employeeId ?? null,
      });
    }
    this.realtime.changed('production-plans', 'production-results', 'sales-orders');
    return true;
  }
}
