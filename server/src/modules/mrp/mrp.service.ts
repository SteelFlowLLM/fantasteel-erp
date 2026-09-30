import { Injectable } from '@nestjs/common';
import { PRODUCTION_PLAN_STATUS, type AuthUser } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { YieldCalculator } from '../production/yield.calculator';
import { MrpRepository, type MrpRunRow } from './mrp.repository';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ZERO = D(0);
const nonNegative = (v: Prisma.Decimal) => Prisma.Decimal.max(ZERO, v);

/** 생산계획 1건이 아직 만들지 않은 히트와 그 히트가 요구하는 용선·원료 (공급 차감 전) */
export interface MrpPlanDemand {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: string;
  steelGradeId: number;
  steelGradeCode: string;
  specCode: string;
  itemType: string;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  dueDate: Date | null;
  /** 아직 만들지 않은 히트 수 */
  heatCount: number;
  heatTon: Prisma.Decimal;
  /** 이 계획의 필요 용선 = 히트 톤 ÷ 제강 수율 */
  hotMetalTon: Prisma.Decimal;
  /** 원료별 소요 (용선 재고 차감 전) */
  requirements: { rawMaterialId: number; requiredTon: Prisma.Decimal }[];
}

export interface MrpRequirementCalc {
  rawMaterialId: number;
  /** 총소요 */
  requiredTon: Prisma.Decimal;
  /** 원료 LOT 잔량 합계 */
  remainingTon: Prisma.Decimal;
  scheduledReceiptTon: Prisma.Decimal;
  /** 순소요 = max(0, 총소요 − 잔량 − 입고예정) */
  netRequiredTon: Prisma.Decimal;
  requiredDate: Date | null;
}

export interface MrpCalc {
  heatCount: number;
  heatTon: Prisma.Decimal;
  /** 필요 용선 = Σ(히트 톤 ÷ 제강 수율) */
  requiredHotMetalTon: Prisma.Decimal;
  /** 용선 LOT 잔량 합계 */
  hotMetalRemainingTon: Prisma.Decimal;
  /** 새로 만들어야 하는 용선 = max(0, 필요 용선 − 용선 잔량). 원료 소요는 이 값으로 계산한다 */
  hotMetalTon: Prisma.Decimal;
  plans: MrpPlanDemand[];
  requirements: MrpRequirementCalc[];
}

/** 작업 로그에 남기는 실행 시점 내역 (직렬화된 모양) */
interface RunSnapshot {
  requiredHotMetalTon: string;
  hotMetalRemainingTon: string;
  plans: {
    productionPlanId: number; productionPlanNo: string; productionPlanStatus: string; steelGradeCode: string; specCode: string; itemType: string;
    salesOrderId: number | null; salesOrderNo: string | null; dueDate: string | null; heatCount: number; heatTon: string; hotMetalTon: string;
    requirements: { rawMaterialId: number; requiredTon: string }[];
  }[];
}

function readSnapshot(raw: unknown): RunSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Partial<RunSnapshot>;
  return Array.isArray(o.plans) && typeof o.requiredHotMetalTon === 'string' && typeof o.hotMetalRemainingTon === 'string' ? (o as RunSnapshot) : null;
}

/**
 * MRP (REQ-PRD-005, 업무 프로세스 정의서 4.4).
 * 진행 중인 생산계획 전체의 "아직 만들지 않은 히트"를 모아 한 번에 계산한다.
 * 공급(용선 잔량·원료 LOT 잔량·입고예정)은 계획별이 아니라 합계에서 한 번만 뺀다 → 같은 공급을 계획마다 중복 차감하지 않는다.
 * 제강 수율은 용선 환산에 한 번만 쓰고, 합금철은 히트 톤 기준이라 수율을 다시 적용하지 않는다.
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MrpRepository,
    private readonly yields: YieldCalculator,
    private readonly numbering: NumberingService,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  /** MRP 실행: 계산 결과를 mrp_run·mrp_requirement에 저장한다. 구매요청은 만들지 않는다 (자동 초안은 P2). */
  async run(user: AuthUser) {
    const id = await this.prisma.tx(async (tx) => {
      const calc = await this.calculate(tx);
      const run = await this.repo.createRun(tx, {
        mrpRunNo: await this.numbering.documentNo(tx, 'MRP'),
        runEmployeeId: user.employeeId,
        hotMetalTon: calc.hotMetalTon,
        heatTon: calc.heatTon,
        heatCount: calc.heatCount,
        requirements: calc.requirements,
      });
      const shortages = calc.requirements.filter((r) => r.netRequiredTon.gt(0)).length;
      await this.events.record(tx, {
        actor: user,
        eventType: 'MRP_RUN',
        targetType: 'MRP_RUN',
        targetId: run.id,
        targetNo: run.mrpRunNo,
        summary: `MRP ${run.mrpRunNo} 실행 · 생산계획 ${calc.plans.length}건 · 히트 ${calc.heatCount}개(${calc.heatTon.toFixed(3)}t) · 부족 원료 ${shortages}종`,
        after: {
          heatCount: calc.heatCount, heatTon: calc.heatTon, requiredHotMetalTon: calc.requiredHotMetalTon, hotMetalRemainingTon: calc.hotMetalRemainingTon,
          hotMetalTon: calc.hotMetalTon,
          plans: calc.plans,
          requirements: calc.requirements,
        },
      });
      this.realtime.changed('mrp-runs');
      return run.id;
    });
    return this.detail(id);
  }

  /** 저장 없이 계산만 한다 (단위 테스트·다른 모듈용). */
  async calculate(tx: Tx): Promise<MrpCalc> {
    const plans = await this.repo.findOpenPlans(tx);
    const producedHeats = await this.repo.countHeatLots(tx, plans.map((p) => p.id));
    const capacityTon = await this.yields.heatCapacityTon(tx);
    const steelmakingYields = new Map<string, Prisma.Decimal>();

    const demands: MrpPlanDemand[] = [];
    let requiredHotMetalRaw = ZERO;
    const heatTonBySteelGrade = new Map<number, Prisma.Decimal>();
    for (const plan of plans) {
      const itemType = plan.productSpec.item.itemType as 'SLAB' | 'COIL';
      let heatCount: number;
      if (plan.productionPlanStatus === PRODUCTION_PLAN_STATUS.PLANNED) {
        // 히트 편성 전: 새로 만들 매수(부족 − 여재 사용)로 편성을 계산한다
        heatCount = (await this.yields.calcHeatPlan(tx, plan.productSpecId, Math.max(0, plan.shortageQty - plan.surplusUseQty))).heatCount;
      } else {
        heatCount = Math.max(0, plan.heatCount - (producedHeats.get(plan.id) ?? 0));
      }
      if (heatCount <= 0) continue;
      if (!steelmakingYields.has(itemType)) steelmakingYields.set(itemType, (await this.yields.routingYields(tx, itemType)).steelmaking);
      const heatTon = capacityTon.mul(heatCount);
      const hotMetalRaw = heatTon.div(steelmakingYields.get(itemType)!);
      const hotMetalTon = hotMetalRaw.toDecimalPlaces(3);
      requiredHotMetalRaw = requiredHotMetalRaw.add(hotMetalRaw);
      heatTonBySteelGrade.set(plan.steelGradeId, (heatTonBySteelGrade.get(plan.steelGradeId) ?? ZERO).add(heatTon));
      const share = await this.yields.rawMaterialRequirements(tx, hotMetalTon, new Map([[plan.steelGradeId, heatTon]]));
      const salesOrder = plan.salesOrderItem?.salesOrder ?? null;
      demands.push({
        productionPlanId: plan.id, productionPlanNo: plan.productionPlanNo, productionPlanStatus: plan.productionPlanStatus,
        steelGradeId: plan.steelGradeId, steelGradeCode: plan.steelGrade.steelGradeCode, specCode: plan.productSpec.specCode, itemType,
        salesOrderId: salesOrder?.id ?? null, salesOrderNo: salesOrder?.salesOrderNo ?? null, dueDate: salesOrder?.dueDate ?? null,
        heatCount, heatTon, hotMetalTon,
        requirements: [...share].filter(([, ton]) => ton.gt(0)).map(([rawMaterialId, requiredTon]) => ({ rawMaterialId, requiredTon })),
      });
    }

    const requiredHotMetalTon = requiredHotMetalRaw.toDecimalPlaces(3);
    const hotMetalRemainingTon = await this.repo.sumHotMetalRemainingTon(tx);
    const hotMetalTon = nonNegative(requiredHotMetalTon.sub(hotMetalRemainingTon));
    const gross = await this.yields.rawMaterialRequirements(tx, hotMetalTon, heatTonBySteelGrade);

    const remaining = await this.repo.sumRawMaterialRemainingTon(tx);
    const scheduled = new Map<number, Prisma.Decimal>();
    for (const item of await this.repo.findOpenPurchaseOrderItems(tx)) {
      scheduled.set(item.rawMaterialId, (scheduled.get(item.rawMaterialId) ?? ZERO).add(nonNegative(item.orderedTon.sub(item.receivedTon))));
    }

    const requirements = [...gross].sort(([a], [b]) => a - b).map(([rawMaterialId, requiredTon]): MrpRequirementCalc => {
      const remainingTon = remaining.get(rawMaterialId) ?? ZERO;
      const scheduledReceiptTon = scheduled.get(rawMaterialId) ?? ZERO;
      // 필요일 = 이 원료를 쓰는 계획에 연결된 수주 납기 중 가장 이른 날
      const dueDates = demands.filter((d) => d.dueDate && d.requirements.some((r) => r.rawMaterialId === rawMaterialId)).map((d) => d.dueDate as Date);
      return {
        rawMaterialId, requiredTon, remainingTon, scheduledReceiptTon,
        netRequiredTon: nonNegative(requiredTon.sub(remainingTon).sub(scheduledReceiptTon)),
        requiredDate: dueDates.length ? new Date(Math.min(...dueDates.map((d) => d.getTime()))) : null,
      };
    });

    return {
      heatCount: demands.reduce((sum, d) => sum + d.heatCount, 0),
      heatTon: demands.reduce((sum, d) => sum.add(d.heatTon), ZERO),
      requiredHotMetalTon, hotMetalRemainingTon, hotMetalTon, plans: demands, requirements,
    };
  }

  // ───────────────────────────── 조회 ─────────────────────────────

  async list() {
    const runs = await this.repo.findRuns(this.prisma);
    const employees = await this.employeeMap(runs);
    return runs.map((run) => ({
      id: run.id,
      mrpRunNo: run.mrpRunNo,
      createdAt: run.createdAt,
      runEmployee: run.runEmployeeId ? (employees.get(run.runEmployeeId) ?? null) : null,
      heatCount: run.heatCount,
      heatTon: run.heatTon,
      hotMetalTon: run.hotMetalTon,
      shortageCount: run.requirements.filter((r) => r.netRequiredTon.gt(0)).length,
      totalNetRequiredTon: run.requirements.reduce((sum, r) => sum.add(r.netRequiredTon), ZERO),
    }));
  }

  async latest() {
    const run = await this.repo.findLatestRun(this.prisma);
    return run ? this.toDetailView(run) : null;
  }

  async detail(id: number) {
    const run = await this.repo.findRun(this.prisma, id);
    if (!run) throw notFound('MRP 실행');
    return this.toDetailView(run);
  }

  private async employeeMap(runs: MrpRunRow[]) {
    const ids = [...new Set(runs.map((r) => r.runEmployeeId).filter((v): v is number => v !== null))];
    return new Map((await this.repo.findEmployees(this.prisma, ids)).map((e) => [e.id, e]));
  }

  /**
   * 저장된 계산 결과 + 실행 시점의 계획별 내역 + "지금" 이 원료를 덮고 있는 구매요청·발주.
   * 덮임 여부는 조회할 때마다 다시 계산한다 (MRP 뒤에 구매요청을 올렸는지 화면에서 바로 보이게 → 중복 요청 방지).
   */
  private async toDetailView(run: MrpRunRow) {
    const tx: Tx = this.prisma;
    const snapshot = readSnapshot(await this.repo.findRunSnapshot(tx, run.id));
    const employees = await this.employeeMap([run]);
    const rawMaterialIds = run.requirements.map((r) => r.rawMaterialId);
    const openRequisitionItems = await this.repo.findOpenRequisitionItems(tx, rawMaterialIds);
    const openPurchaseOrderItems = await this.repo.findOpenPurchaseOrderItems(tx, rawMaterialIds);
    const orderedAfterRun = await this.repo.findPurchaseOrderItemsConfirmedAfter(tx, rawMaterialIds, run.createdAt);

    return {
      id: run.id,
      mrpRunNo: run.mrpRunNo,
      createdAt: run.createdAt,
      runEmployee: run.runEmployeeId ? (employees.get(run.runEmployeeId) ?? null) : null,
      heatCount: run.heatCount,
      heatTon: run.heatTon,
      requiredHotMetalTon: snapshot?.requiredHotMetalTon ?? null,
      hotMetalRemainingTon: snapshot?.hotMetalRemainingTon ?? null,
      hotMetalTon: run.hotMetalTon,
      plans: (snapshot?.plans ?? []).map(({ requirements: _requirements, ...plan }) => plan),
      requirements: run.requirements.map((r) => {
        const openRequisitions = openRequisitionItems
          .filter((it) => it.rawMaterialId === r.rawMaterialId && it.orderedTon.lt(it.requiredTon))
          .map((it) => ({
            purchaseRequisitionId: it.purchaseRequisition.id,
            purchaseRequisitionNo: it.purchaseRequisition.purchaseRequisitionNo,
            purchaseRequisitionStatus: it.purchaseRequisition.purchaseRequisitionStatus,
            unorderedTon: it.requiredTon.sub(it.orderedTon),
          }));
        const openPurchaseOrders = openPurchaseOrderItems
          .filter((it) => it.rawMaterialId === r.rawMaterialId && it.receivedTon.lt(it.orderedTon))
          .map((it) => ({
            purchaseOrderId: it.purchaseOrder.id,
            purchaseOrderNo: it.purchaseOrder.purchaseOrderNo,
            dueDate: it.purchaseOrder.dueDate,
            outstandingTon: it.orderedTon.sub(it.receivedTon),
          }));
        const openRequisitionTon = openRequisitions.reduce((sum, it) => sum.add(it.unorderedTon), ZERO);
        const orderedAfterRunTon = orderedAfterRun.filter((it) => it.rawMaterialId === r.rawMaterialId).reduce((sum, it) => sum.add(it.orderedTon), ZERO);
        const uncoveredTon = nonNegative(r.netRequiredTon.sub(openRequisitionTon).sub(orderedAfterRunTon));
        return {
          id: r.id,
          rawMaterial: { id: r.rawMaterial.id, materialCode: r.rawMaterial.materialCode, rawMaterialType: r.rawMaterial.rawMaterialType, itemName: r.rawMaterial.item.itemName },
          requiredTon: r.requiredTon,
          remainingTon: r.remainingTon,
          scheduledReceiptTon: r.scheduledReceiptTon,
          netRequiredTon: r.netRequiredTon,
          requiredDate: r.requiredDate,
          contributions: (snapshot?.plans ?? []).flatMap((p) => {
            const share = p.requirements.find((x) => x.rawMaterialId === r.rawMaterialId);
            return share
              ? [{ productionPlanId: p.productionPlanId, productionPlanNo: p.productionPlanNo, salesOrderNo: p.salesOrderNo, dueDate: p.dueDate, heatCount: p.heatCount, requiredTon: share.requiredTon }]
              : [];
          }),
          coverage: { openRequisitionTon, openRequisitions, openPurchaseOrders, orderedAfterRunTon, uncoveredTon, isCovered: uncoveredTon.lte(0) },
        };
      }),
    };
  }
}
