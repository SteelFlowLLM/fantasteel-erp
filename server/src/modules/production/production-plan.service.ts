import { Injectable } from '@nestjs/common';
import { ERROR_CODE, type AuthUser } from '@fantasteel/shared';
import { lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { SalesOrderStatusService } from '../sales-order/sales-order-status.service';
import type { CancelProductionPlanDto } from './dto/cancel-production-plan.dto';
import type { CreateReproductionPlanDto } from './dto/create-reproduction-plan.dto';
import type { HeatPlanDto } from './dto/heat-plan.dto';
import type { ListProductionPlansDto } from './dto/list-production-plans.dto';
import { ProductionMaterialService } from './production-material.service';
import { ProductionPlanProgressService } from './production-plan-progress.service';
import { ProductionPlanWriter } from './production-plan.writer';
import { type PlanRow, ProductionRepository } from './production.repository';
import { slabSpecOf, toLotView, toPlanSummary, toResultView, toSpecView } from './production.view';
import { YieldCalculator } from './yield.calculator';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

@Injectable()
export class ProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductionRepository,
    private readonly yields: YieldCalculator,
    private readonly materials: ProductionMaterialService,
    private readonly progress: ProductionPlanProgressService,
    private readonly writer: ProductionPlanWriter,
    private readonly stock: StockService,
    private readonly salesOrderStatus: SalesOrderStatusService,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListProductionPlansDto) {
    return (await this.repo.listPlans(this.prisma, { status: q.status, itemType: q.itemType, needsAction: q.needsAction })).map(toPlanSummary);
  }

  async get(id: number) {
    return this.detail(this.prisma, id);
  }

  /** 계획 상세: 수주·규격·편성·공정 진행·생산 LOT·귀속 슬래브·열연 필요·여재. */
  async detail(tx: Tx, id: number) {
    const plan = await this.repo.findPlan(tx, id);
    if (!plan) throw notFound('생산계획');
    const isCoil = plan.productSpec.item.itemType === 'COIL';
    const itemId = plan.salesOrderItemId;
    const lots = await this.repo.planLots(tx, plan.id);
    const view = (type: string) => lots.filter((l) => l.lotType === type).map((l) => toLotView(l, isCoil ? itemId : null));
    const facts = await this.progress.facts(tx, plan);
    const open = ['CONFIRMED', 'IN_PROGRESS'].includes(plan.productionPlanStatus);

    const defaultHotMetalTon = open ? await this.materials.remainingHotMetalNeedTon(tx, plan) : null;
    const resultRows = await this.repo.listResults(tx, { planId: plan.id });
    const results = resultRows.map((r) => toResultView(r, r.processCode === 'IRONMAKING' && r.productionResultStatus !== 'COMPLETED' ? defaultHotMetalTon : null));

    const earmarked = isCoil && itemId && open ? await this.repo.earmarkedSlabs(tx, itemId) : [];
    const allocations = isCoil ? await this.repo.rollingAllocations(tx, plan.id) : [];
    const slabs = lots.filter((l) => l.lotType === 'SLAB');
    const eligibleSlabs = slabs.filter((l) => l.lotStatus === 'IN_STOCK' && l.isPassed === true && l.heatLot?.isPassed === true);
    // 실제 여재: 코일 계획은 귀속되지 않고 남은 적격 슬래브, 슬래브 계획은 목표 매수를 넘는 적격 슬래브.
    const actualSurplusQty = isCoil
      ? eligibleSlabs.filter((l) => l.salesOrderItemId === null && !l.allocations.length).length
      : Math.max(0, slabs.filter((l) => l.isPassed === true && l.heatLot?.isPassed === true).length - plan.shortageQty);

    return {
      ...toPlanSummary(plan),
      results,
      lots: { hotMetals: view('HOT_METAL'), heats: view('HEAT'), slabs: view('SLAB'), coils: view('COIL') },
      /** 코일 수주 품목의 열연 투입용으로 잡혀 있는 적격 슬래브 (여재에서 끌어온 것 포함) */
      earmarkedSlabs: earmarked.map((l) => toLotView(l, itemId)),
      rollingAllocations: allocations.map((a) => ({
        id: a.id, status: a.status, lotId: a.lotId, lotNo: a.lot.lotNo, heatLotNo: a.lot.heatLot?.lotNo ?? null, confirmedAt: a.confirmedAt, consumedAt: a.consumedAt, releasedAt: a.releasedAt,
      })),
      rolling: isCoil
        ? {
            /** 이 계획으로 압연한 코일 수 */
            rolledQty: facts.rolledQty,
            /** 목표 매수까지 더 압연해야 하는 수 */
            remainingQty: Math.max(0, plan.shortageQty - facts.rolledQty),
            /** 수주 품목 기준으로 열연 투입용 슬래브가 더 필요한 수 (StockService.rollingNeedQty) */
            rollingNeedQty: itemId && open ? await this.stock.rollingNeedQty(tx, itemId) : 0,
            earmarkedSlabQty: facts.earmarkedSlabQty,
            confirmedAllocationQty: facts.confirmedRollingAllocationQty,
          }
        : null,
      surplus: {
        /** 편성 시 예상한 여재 = 슬래브 계획 매수 − 새로 만들 목표 매수 */
        expectedQty: Math.max(0, plan.plannedSlabQty - (plan.shortageQty - plan.surplusUseQty)),
        actualQty: actualSurplusQty,
      },
      /** 이 계획이 수주 품목에 아직 채워 줄 수 있는 매수 (재생산 필요 매수 계산에 쓴다) */
      remainingTargetQty: await this.progress.remainingTargetQty(tx, plan),
    };
  }

  // ───────────────────────────── 히트 편성 ─────────────────────────────

  /** 히트 편성 미리보기 (저장하지 않음). 편성 계산·쓸 수 있는 여재·원료 총소요와 잔량을 돌려준다. */
  async heatPreview(id: number, dto: HeatPlanDto) {
    const plan = await this.repo.findPlan(this.prisma, id);
    if (!plan) throw notFound('생산계획');
    return this.preview(this.prisma, plan, dto.surplusUseQty ?? 0);
  }

  private async preview(tx: Tx, plan: PlanRow, surplusUseQty: number) {
    const isCoil = plan.productSpec.item.itemType === 'COIL';
    if (surplusUseQty > plan.shortageQty) throw badInput('여재 사용 매수가 부족 매수보다 많습니다');
    if (!isCoil && surplusUseQty > 0) throw badInput('여재 사용은 코일 계획에서만 지정할 수 있습니다 (슬래브 수주는 등록할 때 재고를 먼저 예약합니다)');
    const calc = await this.yields.calcHeatPlan(tx, plan.productSpecId, plan.shortageQty - surplusUseQty);
    const surplus = await this.availableSurplus(tx, calc.slabSpecId);
    const required = await this.yields.rawMaterialRequirements(tx, calc.hotMetalTon, new Map([[calc.steelGradeId, calc.heatTon]]));
    const rawMaterials = (await this.repo.rawMaterials(tx)).map((rm) => {
      const requiredTon = required.get(rm.id) ?? D(0);
      const remainingTon = rm.inventories[0]?.onHandTon ?? D(0);
      const shortageTon = Prisma.Decimal.max(0, requiredTon.sub(remainingTon));
      return { rawMaterialId: rm.id, materialCode: rm.materialCode, rawMaterialName: rm.item.itemName, rawMaterialType: rm.rawMaterialType, requiredTon, remainingTon, shortageTon, isShort: shortageTon.gt(0) };
    });
    return {
      productionPlanId: plan.id,
      productionPlanNo: plan.productionPlanNo,
      productionPlanStatus: plan.productionPlanStatus,
      itemType: calc.itemType,
      shortageQty: plan.shortageQty,
      surplusUseQty,
      /** 새로 생산할 매수 = 부족 매수 − 여재 사용 매수 */
      targetQty: calc.targetQty,
      targetTon: calc.targetTon,
      steelmakingYieldRate: calc.steelmakingYieldRate,
      castingYieldRate: calc.castingYieldRate,
      hotRollingYieldRate: calc.hotRollingYieldRate,
      cumulativeYieldRate: calc.cumulativeYieldRate,
      requiredInputTon: calc.requiredInputTon,
      heatCapacityTon: calc.heatCapacityTon,
      heatCount: calc.heatCount,
      heatTon: calc.heatTon,
      hotMetalTon: calc.hotMetalTon,
      slabQtyPerHeat: calc.slabQtyPerHeat,
      plannedSlabQty: calc.plannedSlabQty,
      expectedSurplusQty: calc.expectedSurplusQty,
      slabSpecId: calc.slabSpecId,
      surplus: {
        /** 재고 풀에서 지금 열연에 쓸 수 있는 여재 슬래브 매수 (다른 수주 예약분 제외) */
        availableQty: surplus.availableQty,
        /** 이 계획에서 쓸 수 있는 최대 매수 (코일 계획만, 슬래브 계획은 0) */
        maxUseQty: isCoil ? Math.min(plan.shortageQty, surplus.availableQty) : 0,
        lots: surplus.lots.map((l) => toLotView(l)),
      },
      rawMaterials,
      hasRawShortage: rawMaterials.some((r) => r.isShort),
    };
  }

  /** 재고 풀의 여재 슬래브 (FIFO)와 그중 쓸 수 있는 매수 = min(미배정 적격 슬래브 수, 예약 가용 매수). */
  private async availableSurplus(tx: Tx, slabSpecId: number) {
    const lots = await this.repo.poolSlabs(tx, slabSpecId);
    const availableQty = Math.min(lots.length, await this.stock.availableQty(tx, slabSpecId));
    return { lots: lots.slice(0, availableQty), availableQty };
  }

  /**
   * 히트 편성 확정 (REQ-PRD-002). 편성 값을 저장하고 공정별 READY 실적을 만든다.
   * 실적 행 구조: 제선 1행(계획당) · 제강 1행/히트 · 연주 1행/히트 · 열연 1행(코일 계획, 배치로 나눠 등록하면 남은 매수의 행이 이어서 생긴다).
   */
  async confirm(id: number, dto: HeatPlanDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      await lockRow(tx, 'production_plan', id);
      const plan = await this.repo.findPlan(tx, id);
      if (!plan) throw notFound('생산계획');
      if (plan.productionPlanStatus !== 'PLANNED') throw invalidState('계획 상태의 생산계획만 히트 편성을 확정할 수 있습니다');
      const surplusUseQty = dto.surplusUseQty ?? 0;
      const p = await this.preview(tx, plan, surplusUseQty);
      const item = plan.salesOrderItem;

      if (surplusUseQty > 0) {
        if (!item) throw invalidState('수주 품목과 연결되지 않은 계획에는 여재를 쓸 수 없습니다');
        if (surplusUseQty > p.surplus.availableQty) throw new AppException(ERROR_CODE.INV_001, `쓸 수 있는 여재 슬래브가 ${p.surplus.availableQty}매뿐입니다`);
        // 여재를 FIFO로 이 코일 수주 품목의 열연 투입용으로 귀속시킨다 → 재고 풀에서 빠져 다른 예약이 가져가지 못한다.
        const lots = (await this.repo.poolSlabs(tx, p.slabSpecId)).slice(0, surplusUseQty);
        for (const lot of lots) await this.stock.earmarkForRolling(tx, lot.id, item.id);
      }

      const now = new Date();
      await this.repo.updatePlan(tx, plan.id, {
        productionPlanStatus: 'CONFIRMED', confirmedAt: now, surplusUseQty,
        heatCount: p.heatCount, plannedSlabQty: p.plannedSlabQty, requiredInputTon: p.requiredInputTon, cumulativeYieldRate: p.cumulativeYieldRate,
      });
      const rows: Prisma.ProductionResultCreateManyInput[] = [];
      if (p.heatCount > 0) rows.push({ productionPlanId: plan.id, processCode: 'IRONMAKING' });
      for (let seq = 1; seq <= p.heatCount; seq++) rows.push({ productionPlanId: plan.id, processCode: 'STEELMAKING', heatSeq: seq });
      for (let seq = 1; seq <= p.heatCount; seq++) rows.push({ productionPlanId: plan.id, processCode: 'CASTING', heatSeq: seq, plannedQty: p.slabQtyPerHeat });
      if (p.itemType === 'COIL') rows.push({ productionPlanId: plan.id, processCode: 'HOT_ROLLING', plannedQty: plan.shortageQty });
      await this.repo.createResults(tx, rows);

      await this.events.record(tx, {
        actor: user,
        eventType: 'PRODUCTION_PLAN_CONFIRMED',
        targetType: 'PRODUCTION_PLAN',
        targetId: plan.id,
        targetNo: plan.productionPlanNo,
        salesOrderId: item?.salesOrderId ?? null,
        summary: `${plan.productionPlanNo} 히트 편성 확정: 히트 ${p.heatCount}개, 슬래브 계획 ${p.plannedSlabQty}매${surplusUseQty ? `, 여재 사용 ${surplusUseQty}매` : ''}, 예상 여재 ${p.expectedSurplusQty}매`,
        before: { productionPlanStatus: 'PLANNED' },
        after: {
          productionPlanStatus: 'CONFIRMED', heatCount: p.heatCount, plannedSlabQty: p.plannedSlabQty, surplusUseQty,
          requiredInputTon: p.requiredInputTon, cumulativeYieldRate: p.cumulativeYieldRate, hotMetalTon: p.hotMetalTon, expectedSurplusQty: p.expectedSurplusQty,
        },
        reasonCode: 'ORDER_SHORTAGE',
      });
      if (item) await this.salesOrderStatus.recalcItem(tx, item.id);
      this.realtime.changed('production-plans', 'production-results');
      return this.detail(tx, plan.id);
    });
  }

  /** 생산계획 취소: 어떤 실적도 시작하기 전에만. 편성 때 잡아 둔 여재와 열연 배정을 풀어 준다. */
  async cancel(id: number, dto: CancelProductionPlanDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      await lockRow(tx, 'production_plan', id);
      const plan = await this.repo.findPlan(tx, id);
      if (!plan) throw notFound('생산계획');
      if (!['PLANNED', 'CONFIRMED'].includes(plan.productionPlanStatus) || plan.productionResults.some((r) => r.productionResultStatus !== 'READY')) {
        throw invalidState('작업을 시작한 뒤에는 생산계획을 취소할 수 없습니다');
      }
      const item = plan.salesOrderItem;
      for (const a of await this.repo.rollingAllocations(tx, plan.id, 'CONFIRMED')) await this.stock.releaseAllocation(tx, a.id);
      let releasedSurplusQty = 0;
      if (item && plan.surplusUseQty > 0) {
        // 편성 때 귀속시킨 여재를 재고 풀로 돌린다. 어느 LOT이었는지는 저장하지 않으므로 최근 생산분부터 매수만큼 푼다.
        const earmarked = (await this.repo.earmarkedSlabs(tx, item.id)).filter((l) => !l.allocations.length).reverse();
        for (const lot of earmarked.slice(0, plan.surplusUseQty)) {
          await this.stock.releaseEarmark(tx, lot.id);
          releasedSurplusQty++;
        }
      }
      await this.repo.updatePlan(tx, plan.id, { productionPlanStatus: 'CANCELLED', cancelledAt: new Date() });
      await this.events.record(tx, {
        actor: user,
        eventType: 'PRODUCTION_PLAN_CANCELLED',
        targetType: 'PRODUCTION_PLAN',
        targetId: plan.id,
        targetNo: plan.productionPlanNo,
        salesOrderId: item?.salesOrderId ?? null,
        summary: `생산계획 ${plan.productionPlanNo} 취소${releasedSurplusQty ? ` (여재 ${releasedSurplusQty}매 재고 풀로 복귀)` : ''}`,
        before: { productionPlanStatus: plan.productionPlanStatus },
        after: { productionPlanStatus: 'CANCELLED', releasedSurplusQty },
        reason: dto.reason ?? null,
      });
      if (item) await this.salesOrderStatus.recalcItem(tx, item.id);
      this.realtime.changed('production-plans', 'production-results');
      return this.detail(tx, plan.id);
    });
  }

  // ───────────────────────────── 재생산 (REQ-PRD-006) ─────────────────────────────

  /** 재생산 전 확인: 미확보 매수, 진행 계획이 채워 줄 매수, 추가 계획 필요 매수, 쓸 수 있는 재고·여재. */
  async reproductionPreview(salesOrderItemId: number) {
    return this.reproductionNeed(this.prisma, salesOrderItemId);
  }

  private async reproductionNeed(tx: Tx, salesOrderItemId: number) {
    const item = await this.repo.findSalesOrderItem(tx, salesOrderItemId);
    if (!item) throw notFound('수주 품목');
    const isCoil = item.productSpec.item.itemType === 'COIL';
    const unsecuredQty = await this.stock.unsecuredQty(tx, item.id);
    const openPlans = [];
    let openPlanRemainingQty = 0;
    for (const plan of await this.repo.openPlansOfItem(tx, item.id)) {
      const remainingTargetQty = await this.progress.remainingTargetQty(tx, plan);
      openPlanRemainingQty += remainingTargetQty;
      openPlans.push({ id: plan.id, productionPlanNo: plan.productionPlanNo, productionPlanStatus: plan.productionPlanStatus, shortageQty: plan.shortageQty, remainingTargetQty });
    }
    const additionalQty = Math.max(0, unsecuredQty - openPlanRemainingQty);
    const stockAvailableQty = await this.stock.availableQty(tx, item.productSpecId);
    const slabSpec = isCoil ? item.productSpec.coilMapping?.slabSpec ?? null : null;
    const surplus = slabSpec ? await this.availableSurplus(tx, slabSpec.id) : null;
    return {
      salesOrderItemId: item.id,
      salesOrderId: item.salesOrderId,
      salesOrderNo: item.salesOrder.salesOrderNo,
      lineNo: item.lineNo,
      customerName: item.salesOrder.customer.customerName,
      salesOrderItemStatus: item.salesOrderItemStatus,
      productSpec: toSpecView(item.productSpec),
      orderedQty: item.orderedQty,
      shippedQty: item.shippedQty,
      /** 현재 미확보 매수 = max(0, 주문 − 누적 출고 − ACTIVE 예약) */
      unsecuredQty,
      openPlans,
      openPlanRemainingQty,
      /** 추가 계획 필요 매수 = max(0, 미확보 − 진행 계획 잔여 목표) */
      additionalQty,
      /** 같은 규격의 예약 가용 재고. 재생산 계획을 만들기 전에 이 매수만큼 먼저 예약한다 */
      stockAvailableQty,
      /** 재고 예약 뒤에도 남아 새 계획으로 만들 매수 */
      planQty: Math.max(0, additionalQty - stockAvailableQty),
      /** 코일 품목이면 대응 슬래브 규격의 여재 (새 계획의 히트 편성에서 surplusUseQty로 쓸 수 있다). 슬래브 품목은 null */
      surplus: surplus && slabSpec ? { slabSpec: toSpecView(slabSpec), availableQty: surplus.availableQty, lots: surplus.lots.map((l) => toLotView(l)) } : null,
    };
  }

  /**
   * 재생산 계획 생성. 필요한 매수는 서버가 계산한다: 추가 계획 필요 매수 = max(0, 미확보 − 진행 계획 잔여 목표).
   * 같은 규격의 가용 재고(슬래브 품목이면 여재)가 있으면 그것부터 예약하고, 그래도 모자란 만큼만 계획을 만든다 (인수 시나리오 14.1의 5·6).
   */
  async createReproduction(dto: CreateReproductionPlanDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      await lockRow(tx, 'sales_order_item', dto.salesOrderItemId);
      const need = await this.reproductionNeed(tx, dto.salesOrderItemId);
      if (need.salesOrderItemStatus === 'CANCELLED') throw invalidState('취소된 수주 품목입니다');
      if (need.additionalQty <= 0) throw invalidState('추가로 생산할 매수가 없습니다 (미확보 매수가 없거나 진행 중인 계획으로 채워집니다)');
      const reservedFromStockQty = await this.stock.reserveForItem(tx, { salesOrderItemId: need.salesOrderItemId, maxQty: need.additionalQty, actor: user, reasonCode: 'STOCK_FIRST' });
      const planQty = need.additionalQty - reservedFromStockQty;
      let planId: number | null = null;
      if (planQty > 0) {
        const plan = await this.writer.createForShortage(tx, {
          salesOrderItemId: need.salesOrderItemId, shortageQty: planQty, actor: user, isReproduction: true,
          reason: dto.reason ?? '합격 매수 부족으로 재생산',
        });
        planId = plan.id;
      }
      await this.salesOrderStatus.recalcItem(tx, need.salesOrderItemId);
      this.realtime.changed('production-plans', 'sales-orders');
      return {
        additionalQty: need.additionalQty,
        /** 계획을 만들기 전에 가용 재고에서 먼저 예약한 매수 */
        reservedFromStockQty,
        /** 새 재생산 계획의 목표 매수 (0이면 재고로 모두 채워 계획을 만들지 않았다) */
        planQty,
        plan: planId ? await this.detail(tx, planId) : null,
      };
    });
  }
}
