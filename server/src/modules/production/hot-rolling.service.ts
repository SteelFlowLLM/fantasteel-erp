import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  LOT_STATUS,
  LOT_TYPE,
  PROCESS_TYPE,
  PRODUCTION_PLAN_STATUS,
  type AuthUser,
  type HotRollingDetail,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { ConfirmHotRollingDto, ReleaseHotRollingDto } from './dto/hot-rolling.dto';
import { toPlanLot, toPlanSummary } from './production-plan.mapper';
import { toResultView } from './production-result.mapper';
import { ProductionResultRepository } from './production-result.repository';
import { ProductionService } from './production.service';
import { ProductionRepository } from './production.repository';

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * 열연 투입 배정 (REQ-PRD-004, REQ-INV-006·009, BP-INV-01).
 * 코일 계획에 필요한 매수만큼 합격 슬래브를 FIFO로 추천받아 확정한다. 배정·재고 변경은 inventory 서비스가 같은 tx에서 한다.
 * 열연 실적(코일 생성)은 작업 실적 등록(processType HOT_ROLLING)으로 한다.
 */
@Injectable()
export class HotRollingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: ProductionRepository,
    private readonly resultRepository: ProductionResultRepository,
    private readonly production: ProductionService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
  ) {}

  async detail(productionPlanId: number, tx: Tx = this.prisma): Promise<HotRollingDetail> {
    const plan = await this.plans.findPlan(tx, productionPlanId);
    if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    if (plan.item.itemType !== ITEM_TYPE.COIL) throw new AppException('COM-004', '열연 투입은 코일 계획만 해요');
    const basis = await this.production.heatPlanBasisOf(tx, plan.itemId);
    const slabItemId = basis.slabItem.id;
    const [lots, allocations, inventory, candidates] = await Promise.all([
      this.plans.findLotsOfPlans(tx, [productionPlanId]),
      this.inventory.hotRollingAllocationsOfPlan(tx, productionPlanId),
      this.plans.findInventory(tx, slabItemId),
      this.inventory.hotRollingCandidates(tx, slabItemId),
    ]);
    const coils = lots.filter((l) => l.lotType === LOT_TYPE.COIL).map((l) => ({ ...toPlanLot(l), hasConfirmedAllocation: l.allocations.length > 0 }));
    const failedCoilQty = coils.filter((c) => c.judgement === 'FAIL').length;
    const usableCoilQty = coils.length - failedCoilQty;
    const confirmedAllocationQty = allocations.filter((a) => a.allocationStatus === ALLOCATION_STATUS.CONFIRMED).length;
    const neededQty = Math.max(0, plan.shortageQty - usableCoilQty - confirmedAllocationQty);
    const pool = {
      onHandQty: inventory?.onHandQty ?? 0,
      reservedQty: inventory?.reservedQty ?? 0,
      rollingAllocatedQty: inventory?.rollingAllocatedQty ?? 0,
      availableQty: (inventory?.onHandQty ?? 0) - (inventory?.reservedQty ?? 0) - (inventory?.rollingAllocatedQty ?? 0),
    };
    const open = plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.PLANNED || plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.IN_PROGRESS;
    // 수주 취소로 연결이 끊긴 코일 계획은 열연하지 않고 슬래브 단계에 여재로 남긴다 (BP-SO-02 여재 전환 해석)
    const notRollableReason =
      plan.salesOrderItemId === null ? '수주 연결이 없는 코일 계획은 열연하지 않아요. 남은 합격 슬래브는 여재예요' : !open ? '완료·취소된 계획이에요' : null;
    const recommendableQty = notRollableReason === null ? Math.min(neededQty, Math.max(0, pool.availableQty)) : 0;
    const allocatedLotIds = allocations.map((a) => a.lotId);
    const [owners, yards, allocatedLots, resultRows] = await Promise.all([
      this.plans.findPlanIdsOfLots(tx, [...candidates.map((c) => c.id), ...allocatedLotIds]),
      this.plans.findYardNames(tx),
      this.plans.findLotsByIds(tx, allocatedLotIds),
      this.resultRepository.findResults(tx, { productionPlanId, processType: PROCESS_TYPE.HOT_ROLLING }),
    ]);
    const planNos = await this.plans.findPlanNos(tx, [...new Set([...owners.values()].flatMap((id) => (id === null ? [] : [id])))]);
    const sourcePlanNoOf = (lotId: number) => {
      const owner = owners.get(lotId);
      return owner === undefined || owner === null ? null : (planNos.get(owner) ?? null);
    };
    const allocatedLotById = new Map(allocatedLots.map((l) => [l.id, toPlanLot(l)]));
    const resultEvents = await this.resultRepository.findResultEvents(tx, resultRows.map((r) => r.id));
    const item = await this.plans.findItemForPlan(tx, plan.itemId);
    return {
      plan: toPlanSummary(plan),
      coilItem: { id: plan.itemId, itemCode: plan.item.itemCode, itemName: plan.item.itemName, theoreticalWeightTon: basis.theoreticalWeightTon.toFixed(3) },
      slabItem: {
        id: slabItemId,
        itemCode: basis.slabItem.itemCode,
        itemName: item?.specMappingAsCoilItem?.slabItem.itemName ?? basis.slabItem.itemCode,
        theoreticalWeightTon: basis.slabItem.theoreticalWeightTon.toFixed(3),
      },
      slabItemId,
      slabItemCode: basis.slabItem.itemCode,
      shortageQty: plan.shortageQty,
      usableCoilQty,
      failedCoilQty,
      confirmedAllocationQty,
      neededQty,
      slabPool: pool,
      recommendableQty,
      isRollable: notRollableReason === null,
      notRollableReason,
      candidates: candidates.map((c, index) => ({
        lotId: c.id,
        lotNo: c.lot_no,
        producedDate: dateOnly(c.produced_date),
        heatNo: c.heat_no,
        yardId: c.yard_id,
        fifoRank: index + 1,
        isRecommended: index < recommendableQty,
        isOwnPlan: owners.get(c.id) === productionPlanId,
        sourcePlanNo: sourcePlanNoOf(c.id),
        yardName: c.yard_id === null ? null : (yards.get(c.yard_id) ?? null),
      })),
      allocations,
      rollingAllocations: allocations.map((a) => {
        const lot = allocatedLotById.get(a.lotId);
        return {
          allocationId: a.id,
          allocationStatus: a.allocationStatus,
          lotId: a.lotId,
          lotNo: a.lotNo,
          producedDate: a.producedDate,
          heatNo: a.heatNo,
          sourcePlanNo: sourcePlanNoOf(a.lotId),
          confirmedAt: a.createdAt,
          isRollable: a.allocationStatus === ALLOCATION_STATUS.CONFIRMED && lot?.lotStatus === LOT_STATUS.AVAILABLE && lot.judgement === 'PASS',
        };
      }),
      results: resultRows.map((r) => toResultView(r, resultEvents)).reverse(),
      coils,
    };
  }

  /** FIFO 추천: 저장하지 않고 작업 로그(ALLOCATION_RECOMMENDED)만 남긴다 (REQ-INV-006) */
  async recommend(user: AuthUser, productionPlanId: number): Promise<HotRollingDetail> {
    return this.prisma.$transaction(async (tx) => {
      const detail = await this.detail(productionPlanId, tx);
      const recommended = detail.candidates.filter((c) => c.isRecommended);
      if (recommended.length > 0) {
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.ALLOCATION_RECOMMENDED,
          actor: user,
          target: { table: 'production_plan', id: productionPlanId },
          salesOrderId: detail.plan.salesOrderId,
          lotIds: recommended.map((c) => c.lotId),
          after: { allocationPurpose: 'HOT_ROLLING', neededQty: detail.neededQty, recommendedLotNos: recommended.map((c) => c.lotNo) },
          reason: `FIFO_RECOMMENDATION: 생산완료일이 오래된 순으로 ${recommended.length}매 추천 (더 필요한 슬래브 ${detail.neededQty}매)`,
        });
      }
      return detail;
    });
  }

  /** 배정 확정: 고른 슬래브마다 CONFIRMED 배정 (필요 매수 안에서, 판매 예약 비침범) */
  async confirm(user: AuthUser, productionPlanId: number, dto: ConfirmHotRollingDto): Promise<HotRollingDetail> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.plans.lockPlan(tx, productionPlanId))) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      await this.confirmInTx(tx, user, productionPlanId, dto.lotIds);
    });
    return this.detail(productionPlanId);
  }

  /** 배정 확정 본체 (계획을 잠근 tx 안에서). 실적 시뮬레이션도 부른다 */
  async confirmInTx(tx: Tx, actor: AuthUser | 'SYSTEM', productionPlanId: number, lotIds: readonly number[]): Promise<void> {
    const detail = await this.detail(productionPlanId, tx);
    if (!detail.isRollable) throw new AppException('COM-001', detail.notRollableReason ?? '열연할 수 없는 계획이에요');
    if (lotIds.length > detail.neededQty) throw new AppException('INV-001', `더 배정할 슬래브는 ${detail.neededQty}매예요`);
    for (const lotId of [...lotIds].sort((a, b) => a - b)) {
      await this.inventory.confirmHotRollingAllocation(tx, { productionPlanId, lotId, slabItemId: detail.slabItemId, salesOrderId: detail.plan.salesOrderId, actor });
    }
  }

  /** 배정 해제·변경 (투입 전만) */
  async release(user: AuthUser, productionPlanId: number, allocationId: number, dto: ReleaseHotRollingDto): Promise<HotRollingDetail> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.plans.lockPlan(tx, productionPlanId))) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      const detail = await this.detail(productionPlanId, tx);
      if (dto.newLotId !== undefined && !detail.isRollable) throw new AppException('COM-001', detail.notRollableReason ?? '열연할 수 없는 계획이에요');
      await this.inventory.releaseHotRollingAllocation(tx, {
        allocationId,
        productionPlanId,
        slabItemId: detail.slabItemId,
        salesOrderId: detail.plan.salesOrderId,
        newLotId: dto.newLotId,
        reason: dto.reason,
        actor: user,
      });
    });
    return this.detail(productionPlanId);
  }
}
