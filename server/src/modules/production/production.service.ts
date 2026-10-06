import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  ITEM_TYPE,
  PROCESS_TYPE,
  PRODUCTION_PLAN_STATUS,
  SALES_ORDER_ITEM_STATUS,
  type AuthUser,
  type HeatFormation,
  type ItemType,
  type PageResult,
  type ProductionPlanDetail,
  type ProductionPlanStatus,
  type ProductionPlanSummary,
  type ReproductionCheck,
  type ReproductionResult,
  type SalesOrderItemStatus,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { CancelProductionPlanDto, ListProductionPlansDto } from './dto/production-plan.dto';
import { calcHeatPlan, hotRollingYieldRateOf, plannedSlabQtyOf, slabQtyFromHeat, type HeatPlan } from './heat-plan.calculator';
import { reproductionCheckOf } from './plan-progress.calculator';
import { planHeatsOf, planProgressOf, toPlanLot, toPlanSummary } from './production-plan.mapper';
import { toResultView } from './production-result.mapper';
import { ProductionResultRepository } from './production-result.repository';
import { ProductionRepository, type PlanLotRow } from './production.repository';

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

const rate = (v: Prisma.Decimal) => v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);

/** 히트 편성에 쓰는 기준정보 (라우팅 수율·규격 매핑·히트 용량). 하나라도 없으면 MST-001 */
export interface HeatPlanBasis {
  itemId: number;
  itemType: ItemType;
  steelGradeId: number | null;
  theoreticalWeightTon: Prisma.Decimal;
  castingYieldRate: Prisma.Decimal;
  steelmakingYieldRate: Prisma.Decimal;
  /** 코일만 (코일 이론중량 ÷ 슬래브 이론중량) */
  hotRollingYieldRate: Prisma.Decimal | null;
  heatCapacityTon: Prisma.Decimal;
  /** 연주할 슬래브 규격: 슬래브 계획은 자기, 코일 계획은 매핑된 슬래브 */
  slabItem: { id: number; itemCode: string; theoreticalWeightTon: Prisma.Decimal };
}

/**
 * 생산계획·히트 편성·재생산 (REQ-PRD-001·002·006, BP-PRD-01, docs/backend/production.md).
 * 트랜잭션: this.prisma.$transaction(async (tx) => { ... }) 안에서 repository와 businessEventRecorder.record(tx, ...)를 부른다.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ProductionRepository,
    private readonly results: ProductionResultRepository,
    private readonly numbering: NumberingService,
    private readonly businessEventRecorder: BusinessEventRecorder,
    @Inject(forwardRef(() => InventoryService)) private readonly inventory: InventoryService,
  ) {}

  /** 히트 편성 기준정보 (4.4). 수율·매핑·히트 용량이 없으면 MST-001 (BP-PRD-01 "수율·배합·기준 단위가 없으면 확정하지 않는다") */
  async heatPlanBasisOf(tx: Tx, itemId: number): Promise<HeatPlanBasis> {
    const item = await this.repository.findItemForPlan(tx, itemId);
    if (!item?.theoreticalWeightTon) throw new AppException('MST-001', '규격의 이론중량이 없어요');
    const itemType = item.itemType as ItemType;
    const routings = await this.repository.findRoutings(tx, itemType);
    const yieldOf = (processType: string) => routings.find((r) => r.processType === processType)?.plannedYieldRate ?? null;
    const castingYieldRate = yieldOf(PROCESS_TYPE.CONTINUOUS_CASTING);
    const steelmakingYieldRate = yieldOf(PROCESS_TYPE.STEELMAKING);
    if (!castingYieldRate || !steelmakingYieldRate) throw new AppException('MST-001', '제강·연주 계획 수율이 없어요');
    let hotRollingYieldRate: Prisma.Decimal | null = null;
    let slabItem = { id: item.id, itemCode: item.itemCode, theoreticalWeightTon: item.theoreticalWeightTon };
    if (itemType === ITEM_TYPE.COIL) {
      const mapped = item.specMappingAsCoilItem?.slabItem;
      if (!mapped?.theoreticalWeightTon) throw new AppException('MST-001', '코일 규격에 대응하는 슬래브 규격 매핑이 없어요');
      hotRollingYieldRate = hotRollingYieldRateOf(item.theoreticalWeightTon, mapped.theoreticalWeightTon);
      slabItem = { id: mapped.id, itemCode: mapped.itemCode, theoreticalWeightTon: mapped.theoreticalWeightTon };
    }
    const setting = await this.repository.findProductionSetting(tx);
    if (!setting) throw new AppException('MST-001', '히트 용량 설정값이 없어요');
    return {
      itemId: item.id,
      itemType,
      steelGradeId: item.steelGradeId,
      theoreticalWeightTon: item.theoreticalWeightTon,
      castingYieldRate,
      steelmakingYieldRate,
      hotRollingYieldRate,
      heatCapacityTon: setting.heatCapacityTon,
      slabItem,
    };
  }

  /** 히트 편성 계산 (4.4). 수율·매핑·히트 용량이 없으면 MST-001 */
  async calcHeatPlanForItem(tx: Tx, itemId: number, shortageQty: number): Promise<HeatPlan> {
    return calcHeatPlan(this.heatPlanInputOf(await this.heatPlanBasisOf(tx, itemId), shortageQty));
  }

  private heatPlanInputOf(basis: HeatPlanBasis, shortageQty: number) {
    return {
      shortageQty,
      theoreticalWeightTon: basis.theoreticalWeightTon,
      castingYieldRate: basis.castingYieldRate,
      hotRollingYieldRate: basis.hotRollingYieldRate,
      steelmakingYieldRate: basis.steelmakingYieldRate,
      heatCapacityTon: basis.heatCapacityTon,
    };
  }

  /** 히트 편성표: 4.4 계산 + 히트당 슬래브·계획 슬래브·예상 여재 */
  async heatFormationOf(tx: Tx, plan: { itemId: number; shortageQty: number; heatCount: number }): Promise<HeatFormation> {
    const basis = await this.heatPlanBasisOf(tx, plan.itemId);
    const heat = calcHeatPlan(this.heatPlanInputOf(basis, plan.shortageQty));
    const slabQtyPerHeat = slabQtyFromHeat(basis.heatCapacityTon, basis.castingYieldRate, basis.slabItem.theoreticalWeightTon);
    const cumulative = basis.hotRollingYieldRate === null ? basis.castingYieldRate : basis.castingYieldRate.mul(basis.hotRollingYieldRate);
    return {
      shortageQty: plan.shortageQty,
      theoreticalWeightTon: basis.theoreticalWeightTon.toFixed(3),
      targetTon: heat.targetTon,
      castingYieldRate: rate(basis.castingYieldRate),
      hotRollingYieldRate: basis.hotRollingYieldRate === null ? null : rate(basis.hotRollingYieldRate),
      cumulativeYieldRate: rate(cumulative),
      requiredMoltenSteelTon: heat.requiredMoltenSteelTon,
      heatCapacityTon: basis.heatCapacityTon.toFixed(3),
      heatCount: heat.heatCount,
      heatTon: heat.heatTon,
      steelmakingYieldRate: rate(basis.steelmakingYieldRate),
      requiredHotMetalTon: heat.requiredHotMetalTon,
      slabItemId: basis.slabItem.id,
      slabItemCode: basis.slabItem.itemCode,
      slabTheoreticalWeightTon: basis.slabItem.theoreticalWeightTon.toFixed(3),
      slabQtyPerHeat,
      ...plannedSlabQtyOf({ slabQtyPerHeat, heatCount: heat.heatCount, shortageQty: plan.shortageQty }),
      savedHeatCount: plan.heatCount,
    };
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

  // ── 생산계획 조회·히트 편성·취소 (API-200~205) ─────────────

  async listPlans(query: ListProductionPlansDto): Promise<PageResult<ProductionPlanSummary>> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const filter = { productionPlanStatus: query.productionPlanStatus, itemType: query.itemType, salesOrderId: query.salesOrderId, isReproduction: query.isReproduction };
    const [rows, total] = await Promise.all([
      this.repository.findPlans(this.prisma, filter, { skip: (page - 1) * size, take: size }),
      this.repository.countPlans(this.prisma, filter),
    ]);
    // 진행 값은 이 쪽 계획들의 LOT·열연 배정을 한 번에 읽어 계산한다
    const ids = rows.map((r) => r.id);
    const [lots, rolling] = await Promise.all([this.repository.findLotsOfPlans(this.prisma, ids), this.repository.countConfirmedRollingByPlans(this.prisma, ids)]);
    const basisByItem = new Map<number, HeatPlanBasis | null>();
    const items: ProductionPlanSummary[] = [];
    for (const row of rows) {
      if (!basisByItem.has(row.itemId)) basisByItem.set(row.itemId, await this.heatPlanBasisOf(this.prisma, row.itemId).catch(() => null));
      const basis = basisByItem.get(row.itemId);
      const progress = planProgressOf(
        { ...row, itemType: row.item.itemType as ItemType, productionPlanStatus: row.productionPlanStatus as ProductionPlanStatus },
        lots.filter((l: PlanLotRow) => l.productionResult?.productionPlanId === row.id),
        [],
        rolling.get(row.id) ?? 0,
      );
      items.push(toPlanSummary(row, progress, basis ? calcHeatPlan(this.heatPlanInputOf(basis, row.shortageQty)).requiredMoltenSteelTon : null));
    }
    return { items, page, size, total };
  }

  async getPlanDetail(id: number, tx: Tx = this.prisma): Promise<ProductionPlanDetail> {
    const plan = await this.repository.findPlan(tx, id);
    if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    const [lots, results, resultRows, rolling, planEvents] = await Promise.all([
      this.repository.findLotsOfPlans(tx, [id]),
      this.repository.findResultsOfPlan(tx, id),
      this.results.findResults(tx, { productionPlanId: id }),
      this.repository.countConfirmedRollingByPlans(tx, [id]),
      this.repository.findPlanEvents(tx, id),
    ]);
    const resultEvents = await this.results.findResultEvents(tx, resultRows.map((r) => r.id));
    let formation: HeatFormation | null = null;
    let formationError: string | null = null;
    try {
      formation = await this.heatFormationOf(tx, plan);
    } catch (e) {
      if (!(e instanceof AppException)) throw e;
      formationError = e.message;
    }
    const planned = plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.PLANNED;
    const progress = planProgressOf(
      { ...plan, itemType: plan.item.itemType as ItemType, productionPlanStatus: plan.productionPlanStatus as ProductionPlanStatus },
      lots,
      results,
      rolling.get(id) ?? 0,
    );
    const created = planEvents.find((e) => e.businessEventType !== BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED);
    const cancelled = planEvents.findLast((e) => e.businessEventType === BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED);
    const soItems = plan.salesOrderItem?.salesOrder.salesOrderItems ?? [];
    return {
      ...toPlanSummary(plan, progress, formation?.requiredMoltenSteelTon ?? null),
      salesOrderItem: plan.salesOrderItem
        ? { id: plan.salesOrderItem.id, orderedQty: plan.salesOrderItem.orderedQty, salesOrderItemStatus: plan.salesOrderItem.salesOrderItemStatus as SalesOrderItemStatus }
        : null,
      formation,
      formationError,
      progress,
      lots: lots.map(toPlanLot),
      reproduction: plan.salesOrderItemId === null ? null : await this.reproductionCheck(tx, plan.salesOrderItemId),
      canCancel: planned,
      canConfirm: planned,
      results: resultRows.map((r) => toResultView(r, resultEvents)).reverse(),
      heats: planHeatsOf(plan.heatCount, lots),
      createdEmployeeName: created?.actorEmployee?.employeeName ?? null,
      cancelledAt: plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.CANCELLED ? (cancelled?.createdAt.toISOString() ?? plan.updatedAt.toISOString()) : null,
      salesOrderOwnerName: plan.salesOrderItem?.salesOrder.ownerEmployee.employeeName ?? null,
      salesOrderLineNo: plan.salesOrderItem ? soItems.findIndex((i) => i.id === plan.salesOrderItem?.id) + 1 : null,
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  /** 히트 편성 미리보기 (API-203): 저장하지 않는다 */
  async previewHeatPlan(id: number): Promise<HeatFormation> {
    const plan = await this.repository.findPlan(this.prisma, id);
    if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
    return this.heatFormationOf(this.prisma, plan);
  }

  /**
   * 히트 편성 확정 (API-204): 시작 전(PLANNED) 계획의 히트 수를 지금 기준정보로 다시 계산해 저장한다.
   * 계획 상태 "편성 확정"은 두지 않고(SPEC 5장), 공통 코드에 확정 이벤트가 없어 작업 로그는 남기지 않는다.
   */
  async confirmHeatPlan(id: number): Promise<ProductionPlanDetail> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockPlan(tx, id);
      if (!locked) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      if (locked.production_plan_status !== PRODUCTION_PLAN_STATUS.PLANNED) throw new AppException('COM-001', '작업을 시작한 계획은 히트 편성을 바꿀 수 없어요');
      const plan = await this.repository.findPlan(tx, id);
      if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      const formation = await this.heatFormationOf(tx, plan);
      if (formation.heatCount !== plan.heatCount) await this.repository.updatePlan(tx, id, { heatCount: formation.heatCount });
    });
    return this.getPlanDetail(id);
  }

  /** 생산계획 취소 (API-205): 첫 실적 등록 전(PLANNED)만. 그 계획의 확정 열연 배정도 해제한다 */
  async cancelPlan(user: AuthUser, id: number, dto: CancelProductionPlanDto): Promise<ProductionPlanDetail> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockPlan(tx, id);
      if (!locked) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      if (locked.production_plan_status === PRODUCTION_PLAN_STATUS.CANCELLED) throw new AppException('COM-001', '이미 취소된 계획이에요');
      if (locked.production_plan_status !== PRODUCTION_PLAN_STATUS.PLANNED) {
        throw new AppException('COM-001', '작업 실적이 등록된 계획은 취소할 수 없어요 (계획 상태에서만 취소)');
      }
      const plan = await this.repository.findPlan(tx, id);
      if (!plan) throw new AppException('COM-003', '생산계획을 찾을 수 없어요');
      const salesOrderId = plan.salesOrderItem?.salesOrder.id ?? null;
      const reason = `생산계획 ${plan.productionPlanNo} 취소${dto.reason ? ` · ${dto.reason}` : ''}`;
      await this.inventory.releaseHotRollingAllocationsOfPlan(tx, { productionPlanId: id, salesOrderId, actor: user, reason });
      const cancelled = await this.repository.updatePlan(tx, id, { productionPlanStatus: PRODUCTION_PLAN_STATUS.CANCELLED });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CANCELLED,
        actor: user,
        target: { table: 'production_plan', id },
        salesOrderId,
        before: planSnapshot({ ...plan, productionPlanStatus: locked.production_plan_status }),
        after: planSnapshot(cancelled),
        reason,
      });
    });
    return this.getPlanDetail(id);
  }

  // ── 재생산 계획 생성 (API-202, REQ-PRD-006, BP-QC-01) ────────

  /**
   * 합격 매수가 수주 대비 부족하면(추가 계획 필요 > 0) 여재(예약 가용)를 먼저 예약하고, 남은 매수만 재생산 계획으로 만든다 (14.1-5·6).
   * 진행 계획 잔여 목표나 판정 대기 제품으로 채울 수 있으면 만들지 않는다. 자동 초안은 P2(REQ-AGT-003)라 담당자가 직접 만든다.
   */
  async createReproductionPlan(user: AuthUser, salesOrderItemId: number): Promise<ReproductionResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockSalesOrderItem(tx, salesOrderItemId);
      if (!locked) throw new AppException('COM-003', '수주 품목을 찾을 수 없어요');
      if (locked.sales_order_item_status !== SALES_ORDER_ITEM_STATUS.OPEN && locked.sales_order_item_status !== SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED) {
        throw new AppException('COM-001', '취소·출하완료된 수주 품목은 재생산하지 않아요');
      }
      const check = await this.reproductionCheck(tx, salesOrderItemId);
      if (!check || check.additionalPlanQty <= 0) {
        throw new AppException('COM-001', '추가 계획이 필요하지 않아요 (예약·진행 계획·검사 대기 제품으로 채워져요)');
      }
      const reservedFromSurplusQty = await this.inventory.reserveForSalesOrderItem(tx, {
        salesOrderId: locked.sales_order_id,
        salesOrderItemId,
        itemId: locked.item_id,
        qty: check.additionalPlanQty,
        actor: user,
      });
      const shortageQty = check.additionalPlanQty - reservedFromSurplusQty;
      if (shortageQty <= 0) return { check, reservedFromSurplusQty, plan: null };

      const heat = await this.calcHeatPlanForItem(tx, locked.item_id, shortageQty);
      const plan = await this.repository.createPlan(tx, {
        productionPlanNo: await this.numbering.nextDocumentNumber(tx, 'PRODUCTION_PLAN'),
        salesOrderItemId,
        itemId: locked.item_id,
        shortageQty,
        heatCount: heat.heatCount,
        productionPlanStatus: PRODUCTION_PLAN_STATUS.PLANNED,
        isReproduction: true,
      });
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.REPRODUCTION_PLAN_CREATED,
        actor: user,
        target: { table: 'production_plan', id: plan.id },
        salesOrderId: locked.sales_order_id,
        after: { ...planSnapshot(plan), isReproduction: true, targetTon: heat.targetTon, heatTon: heat.heatTon, reservedFromSurplusQty, check },
        reason: `QUALITY_FAILURE: 합격 매수가 수주 대비 ${check.additionalPlanQty}매 부족${reservedFromSurplusQty > 0 ? ` (여재 ${reservedFromSurplusQty}매 먼저 예약)` : ''} → 재생산 ${shortageQty}매 (히트 ${heat.heatCount}개)`,
      });
      const created = await this.repository.findPlan(tx, plan.id);
      return { check, reservedFromSurplusQty, plan: created ? toPlanSummary(created) : null };
    });
  }

  // ── 재생산 판단 (4.5, 14.1-6) ─────────────────────────

  /** 수주 품목의 재생산 판단값. 연결 계획마다 합격·판정 대기 매수를 세어 진행 계획 잔여 목표를 구한다 */
  async reproductionCheck(tx: Tx, salesOrderItemId: number): Promise<ReproductionCheck | null> {
    const soItem = await this.repository.findSalesOrderItemForReproduction(tx, salesOrderItemId);
    if (!soItem) return null;
    const lots = soItem.productionPlans.length > 0 ? await this.repository.findLotsOfPlans(tx, soItem.productionPlans.map((p) => p.id)) : [];
    const plans = soItem.productionPlans.map((p) => {
      const progress = planProgressOf(
        { itemId: p.itemId, itemType: p.item.itemType as ItemType, heatCount: 0, shortageQty: p.shortageQty, productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus, salesOrderItemId },
        lots.filter((l: PlanLotRow) => l.productionResult?.productionPlanId === p.id),
        [],
      );
      return { plan: p, input: { productionPlanStatus: p.productionPlanStatus as ProductionPlanStatus, shortageQty: p.shortageQty, passedQty: progress.passedQty, pendingQty: progress.pendingQty }, remainingTargetQty: progress.remainingTargetQty };
    });
    const inventory = await this.repository.findInventory(tx, soItem.itemId);
    const check = reproductionCheckOf({
      salesOrderItemId: soItem.id,
      orderedQty: soItem.orderedQty,
      salesOrderItemStatus: soItem.salesOrderItemStatus as SalesOrderItemStatus,
      reservations: soItem.reservations,
      plans: plans.map((p) => p.input),
      reservationAvailableQty: inventory ? inventory.onHandQty - inventory.reservedQty - inventory.rollingAllocatedQty : 0,
    });
    return {
      ...check,
      salesOrderId: soItem.salesOrderId,
      salesOrderNo: soItem.salesOrder.salesOrderNo,
      lineNo: soItem.salesOrder.salesOrderItems.findIndex((i) => i.id === soItem.id) + 1,
      salesOrderItemStatus: soItem.salesOrderItemStatus as SalesOrderItemStatus,
      unshippedQty: Math.max(0, check.orderedQty - check.shippedQty),
      openPlans: plans
        .filter((p) => p.plan.productionPlanStatus !== PRODUCTION_PLAN_STATUS.CANCELLED)
        .map((p) => ({
          id: p.plan.id,
          productionPlanNo: p.plan.productionPlanNo,
          productionPlanStatus: p.plan.productionPlanStatus as ProductionPlanStatus,
          isReproduction: p.plan.isReproduction,
          shortageQty: p.plan.shortageQty,
          remainingTargetQty: p.remainingTargetQty,
        })),
    };
  }
}
