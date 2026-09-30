import { Injectable } from '@nestjs/common';
import { ERROR_CODE, LOT_TYPE_LABEL, type AuthUser, type LotType } from '@fantasteel/shared';
import { lockLots, lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { StockService } from '../inventory/stock.service';
import { NotificationSender } from '../notification/notification.sender';
import { ProductionPlanProgressService } from '../production/production-plan-progress.service';
import type { ListInspectionsDto } from './dto/list-inspections.dto';
import { judgeInspection, type InspectionSpecItem, type JudgedValue, type MeasuredInput } from './inspection-judge';
import { type InspectionLotRow, type InspectionRow, QualityRepository } from './quality.repository';

/** LOT 유형 → 검사 공정 (REQ-QC-001). 히트 = 제강 성분, 슬래브 = 연주 표면·치수, 코일 = 열연 치수·기계적 성질. */
const PROCESS_OF_LOT: Record<string, string> = { HEAT: 'STEELMAKING', SLAB: 'CASTING', COIL: 'HOT_ROLLING' };
const LOT_TYPE_OF_PROCESS: Record<string, string> = { STEELMAKING: 'HEAT', CASTING: 'SLAB', HOT_ROLLING: 'COIL' };
const INSPECTION_NAME: Record<string, string> = { STEELMAKING: '성분 검사', CASTING: '슬래브 검사', HOT_ROLLING: '코일 검사' };

export interface RegisterInspectionInput { lotId: number; values: MeasuredInput[]; memo?: string | null }
/** 품질 담당이 등록하면 actor = 사원, 실적 시뮬레이션이면 actor = null(SYSTEM) + isSimulated. */
export interface RegisterInspectionContext { actor: AuthUser | null; isSimulated?: boolean; inspectedAt?: Date }

const limitText = (v: JudgedValue) =>
  v.minValue !== null && v.maxValue !== null ? `${v.minValue}~${v.maxValue}` : v.maxValue !== null ? `≤ ${v.maxValue}` : v.minValue !== null ? `≥ ${v.minValue}` : '-';

@Injectable()
export class QualityInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QualityRepository,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly planProgress: ProductionPlanProgressService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 조회 ─────────────────────────────

  /** 검사 대기 LOT(측정할 항목·기준 포함) 또는 등록된 검사 목록. */
  async list(q: ListInspectionsDto) {
    if ((q.status ?? 'pending') === 'done') {
      const rows = await this.repo.listInspections(this.prisma, { processCode: q.processCode, lotId: q.lotId });
      return this.toInspectionViews(this.prisma, rows);
    }
    const lots = await this.repo.pendingLots(this.prisma, { lotType: q.processCode ? LOT_TYPE_OF_PROCESS[q.processCode] : undefined, lotId: q.lotId });
    const specCache = new Map<string, InspectionSpecItem[]>();
    const out = [];
    for (const lot of lots) {
      const processCode = PROCESS_OF_LOT[lot.lotType];
      const key = `${processCode}:${lot.steelGradeId}`;
      if (!specCache.has(key)) specCache.set(key, await this.inspectionSpecFor(this.prisma, lot));
      out.push({ inspectionResult: 'PENDING' as const, processCode, inspectionName: INSPECTION_NAME[processCode], lot: this.toLotView(lot), items: specCache.get(key)! });
    }
    return out;
  }

  async get(id: number) {
    const row = await this.repo.findInspection(this.prisma, id);
    if (!row) throw notFound('검사');
    return (await this.toInspectionViews(this.prisma, [row]))[0];
  }

  /**
   * LOT에 적용할 검사 항목과 기준 (REQ-QC-002).
   * 히트는 강종 성분 규격, 슬래브·코일은 공정별 검사 항목(강종 전용 + 공통. 같은 코드면 강종 전용이 우선).
   */
  async inspectionSpecFor(tx: Tx, lot: { lotType: string; steelGradeId: number | null }): Promise<InspectionSpecItem[]> {
    const processCode = PROCESS_OF_LOT[lot.lotType];
    if (!processCode) return [];
    if (lot.lotType === 'HEAT') {
      if (!lot.steelGradeId) return [];
      return (await this.repo.compositionSpecs(tx, lot.steelGradeId)).map((c) => ({
        inspectionItemCode: c.elementCode, inspectionItemName: c.elementCode, unit: '%', minValue: c.minValue, maxValue: c.maxValue, isRequired: true, sortOrder: c.sortOrder,
      }));
    }
    const rows = await this.repo.inspectionItems(tx, processCode, lot.steelGradeId);
    const byCode = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = byCode.get(r.inspectionItemCode);
      if (!prev || (prev.steelGradeId === null && r.steelGradeId !== null)) byCode.set(r.inspectionItemCode, r);
    }
    return [...byCode.values()]
      .sort((a, b) => Number(b.steelGradeId !== null) - Number(a.steelGradeId !== null) || a.sortOrder - b.sortOrder)
      .map((r, i) => ({
        inspectionItemCode: r.inspectionItemCode, inspectionItemName: r.inspectionItemName, unit: r.unit, minValue: r.minValue, maxValue: r.maxValue, isRequired: r.isRequired, sortOrder: i,
      }));
  }

  // ───────────────────────────── 등록·자동 판정 ─────────────────────────────

  async register(input: RegisterInspectionInput, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const id = await this.registerInspection(tx, input, { actor: user });
      const row = await this.repo.findInspection(tx, id);
      return (await this.toInspectionViews(tx, [row!]))[0];
    });
  }

  /**
   * 검사 등록 + 자동 판정 (REQ-QC-003). 호출한 쪽의 트랜잭션 안에서 실행한다 (실적 시뮬레이션도 이 함수를 쓴다).
   * 측정값 저장 → LOT 판정 → 작업 로그 → StockService.onLotJudged(재고 반영·자동 예약·귀속) → 계획 완료 확인 → 알림.
   * 검사 id를 돌려준다.
   */
  async registerInspection(tx: Tx, input: RegisterInspectionInput, ctx: RegisterInspectionContext): Promise<number> {
    const peek = await this.repo.findLot(tx, input.lotId);
    if (!peek) throw notFound('LOT');
    // 같은 수주 품목의 LOT 판정이 동시에 들어오면 열연 필요 매수·자동 예약 계산이 겹칠 수 있어, 수주 품목 → LOT 순서로 잠근다.
    const lockItemId = peek.salesOrderItemId ?? peek.productionPlan?.salesOrderItemId ?? null;
    if (lockItemId) await lockRow(tx, 'sales_order_item', lockItemId);
    await lockLots(tx, [input.lotId]);
    const lot = await this.repo.findLot(tx, input.lotId);
    if (!lot) throw notFound('LOT');
    const processCode = PROCESS_OF_LOT[lot.lotType];
    if (!processCode) throw badInput('히트·슬래브·코일 LOT만 검사할 수 있습니다');
    const name = INSPECTION_NAME[processCode];
    if (lot.isPassed !== null || (await this.repo.findInspectionOfLot(tx, lot.id, processCode))) throw invalidState(`${lot.lotNo}: 이미 ${name}가 등록된 LOT입니다 (재검사는 지원하지 않습니다)`);
    if (lot.lotType !== 'HEAT' && lot.lotStatus !== 'IN_STOCK') throw invalidState(`${lot.lotNo}: 이미 투입·출고된 LOT은 검사할 수 없습니다`);
    if (lot.heatLot?.isPassed === false) throw invalidState(`${lot.lotNo}: 상위 히트 ${lot.heatLot.lotNo}가 성분 불합격이라 검사 대상이 아닙니다`);

    const judged = judgeInspection(await this.inspectionSpecFor(tx, lot), input.values);
    if (!judged.ok) {
      const codes = judged.itemCodes.join(', ');
      if (judged.reason === 'NO_SPEC') throw new AppException(ERROR_CODE.MST_001, `${lot.lotNo}: ${name} 기준이 등록되어 있지 않아 판정할 수 없습니다`);
      if (judged.reason === 'NO_LIMIT') throw new AppException(ERROR_CODE.MST_001, `검사 기준(min/max)이 없는 필수 항목이 있어 판정할 수 없습니다: ${codes}`);
      if (judged.reason === 'MISSING_REQUIRED') throw badInput(`필수 측정값이 비어 있어 판정하지 않았습니다: ${codes}`);
      if (judged.reason === 'DUPLICATE_ITEM') throw badInput(`같은 검사 항목이 두 번 들어 있습니다: ${codes}`);
      throw badInput(`이 LOT의 검사 항목이 아닙니다: ${codes}`);
    }

    const passed = judged.result === 'PASS';
    const inspectedAt = ctx.inspectedAt ?? new Date();
    const inspection = await this.repo.createInspection(
      tx,
      {
        qualityInspectionNo: await this.numbering.documentNo(tx, 'QI'), lotId: lot.id, processCode, inspectionResult: judged.result,
        inspectorEmployeeId: ctx.actor?.employeeId ?? null, inspectedAt, memo: input.memo ?? null,
      },
      judged.values.map((v) => ({
        inspectionItemCode: v.inspectionItemCode, inspectionItemName: v.inspectionItemName, unit: v.unit,
        minValue: v.minValue, maxValue: v.maxValue, measuredValue: v.measuredValue, isPassed: v.isPassed, sortOrder: v.sortOrder,
      })),
    );
    await this.repo.setLotJudgment(tx, lot.id, passed);

    const salesOrderId = (lot.salesOrderItem ?? lot.productionPlan?.salesOrderItem)?.salesOrderId ?? null;
    const reasonCode = ctx.isSimulated ? ('SIMULATION' as const) : passed ? ('QUALITY_PASSED' as const) : ('QUALITY_FAILURE' as const);
    const failed = judged.values.filter((v) => v.isPassed === false);
    const children = lot.lotType === 'HEAT' ? await this.repo.heatChildren(tx, lot.id) : [];
    await this.events.record(tx, {
      actor: ctx.actor,
      eventType: 'INSPECTION_REGISTERED',
      targetType: 'QUALITY_INSPECTION',
      targetId: inspection.id,
      targetNo: inspection.qualityInspectionNo,
      salesOrderId,
      lotIds: [lot.id],
      summary: `${lot.lotNo} ${name} ${passed ? '합격' : '불합격'}`,
      after: { lotNo: lot.lotNo, inspectionResult: judged.result, values: judged.values.map((v) => ({ inspectionItemCode: v.inspectionItemCode, measuredValue: v.measuredValue, minValue: v.minValue, maxValue: v.maxValue, isPassed: v.isPassed })) },
      reasonCode,
    });
    if (!passed) {
      await this.events.record(tx, {
        actor: ctx.actor,
        eventType: 'REJECTED_JUDGED',
        targetType: 'LOT',
        targetId: lot.id,
        targetNo: lot.lotNo,
        salesOrderId,
        lotIds: [lot.id, ...children.map((c) => c.id)],
        summary: `${lot.lotNo} 불합격: ${failed.map((v) => `${v.inspectionItemName} ${v.measuredValue} (기준 ${limitText(v)})`).join(', ')}${children.length ? ` — 하위 LOT ${children.length}개 사용 불가` : ''}`,
        before: { isPassed: null },
        after: { isPassed: false, failedItems: failed.map((v) => v.inspectionItemCode), blockedChildLotNos: children.map((c) => c.lotNo) },
        reasonCode: 'QUALITY_FAILURE',
      });
      // 불합격 히트의 하위 슬래브·코일은 쓸 수 없다. 남아 있는 CONFIRMED 배정은 해제한다 (REQ-INV-007).
      if (children.length) {
        for (const a of await this.repo.confirmedAllocationsOfLots(tx, children.map((c) => c.id))) {
          await this.stock.releaseAllocation(tx, a.id);
          await this.events.record(tx, {
            actor: ctx.actor, eventType: 'ALLOCATION_RELEASED', targetType: 'ALLOCATION', targetId: a.id, targetNo: a.lot.lotNo, salesOrderId, lotIds: [a.lotId],
            summary: `${a.lot.lotNo} 배정 해제: 상위 히트 ${lot.lotNo} 성분 불합격`, before: { status: 'CONFIRMED' }, after: { status: 'RELEASED' }, reasonCode: 'QUALITY_FAILURE',
          });
        }
      }
    }

    // 판정으로 새로 적격이 된 LOT을 재고에 반영하고 원래 수주 품목에 자동 예약한다 (같은 트랜잭션).
    await this.stock.onLotJudged(tx, lot.id);
    if (lot.productionPlanId) await this.planProgress.refresh(tx, lot.productionPlanId, ctx.actor);
    await this.notifyJudged(tx, lot, name, passed, ctx);
    this.realtime.changed('quality-inspections', 'lots', 'inventories', 'production-plans');
    return inspection.id;
  }

  /** 불합격 → 품질 부서 + 생산 역할. 코일 계획의 슬래브가 합격해 열연 투입이 가능해지면 생산 역할에 한 번 알린다. */
  private async notifyJudged(tx: Tx, lot: InspectionLotRow, name: string, passed: boolean, ctx: RegisterInspectionContext): Promise<void> {
    const planNo = lot.productionPlan?.productionPlanNo;
    if (!passed) {
      const input = {
        notificationType: 'QUALITY' as const,
        title: `${lot.lotNo} ${name} 불합격`,
        body: `${planNo ? `${planNo} · ` : ''}처리 상태 지정과 재생산 여부 확인이 필요합니다`,
        dedupeKey: `REJECTED:${lot.id}`,
        excludeEmployeeId: ctx.actor?.employeeId ?? null,
      };
      if (ctx.actor) await this.notifications.toDepartment(tx, ctx.actor.departmentId, { ...input, linkPath: `/quality/rejected?lot=${lot.id}` });
      else await this.notifications.toRole(tx, 'QUALITY', { ...input, linkPath: `/quality/rejected?lot=${lot.id}` });
      await this.notifications.toRole(tx, 'PRODUCTION', { ...input, linkPath: lot.productionPlanId ? `/production/plans?plan=${lot.productionPlanId}` : `/quality/rejected?lot=${lot.id}` });
      return;
    }
    const itemId = lot.productionPlan?.salesOrderItemId;
    if (lot.lotType === 'COIL' || !lot.productionPlanId || !itemId) return;
    const [item] = await this.repo.salesOrderItemsWithSpec(tx, [itemId]);
    if (item?.productSpec.item.itemType !== 'COIL' || (await this.repo.countEarmarkedSlabs(tx, itemId)) === 0) return;
    await this.notifications.toRole(tx, 'PRODUCTION', {
      notificationType: 'PRODUCTION',
      title: `${planNo} 열연 투입 슬래브 배정 가능`,
      body: '합격 슬래브가 준비되었습니다. 열연 투입 슬래브를 배정해 주세요',
      linkPath: `/production/rolling?plan=${lot.productionPlanId}`,
      dedupeKey: `ROLLING_READY:${lot.productionPlanId}`,
    });
  }

  // ───────────────────────────── 응답 모양 ─────────────────────────────

  private toLotView(lot: InspectionLotRow) {
    // 히트처럼 LOT에 수주 품목이 없으면 생산계획의 수주 품목을 보여 준다.
    const item = lot.salesOrderItem ?? lot.productionPlan?.salesOrderItem ?? null;
    return {
      id: lot.id,
      lotNo: lot.lotNo,
      lotType: lot.lotType,
      lotTypeName: LOT_TYPE_LABEL[lot.lotType as LotType] ?? lot.lotType,
      lotStatus: lot.lotStatus,
      isPassed: lot.isPassed,
      steelGradeId: lot.steelGradeId,
      steelGradeCode: lot.steelGrade?.steelGradeCode ?? null,
      productSpecId: lot.productSpecId,
      specCode: lot.productSpec?.specCode ?? null,
      heatLotId: lot.heatLot?.id ?? null,
      heatLotNo: lot.heatLot?.lotNo ?? null,
      /** 상위 히트 성분 검사 결과 (null = 아직 판정 전, 히트 LOT 자신이면 null) */
      heatIsPassed: lot.heatLot?.isPassed ?? null,
      productionPlanId: lot.productionPlan?.id ?? null,
      productionPlanNo: lot.productionPlan?.productionPlanNo ?? null,
      salesOrderItemId: item?.id ?? null,
      salesOrderId: item?.salesOrderId ?? null,
      salesOrderNo: item?.salesOrder.salesOrderNo ?? null,
      customerName: item?.salesOrder.customer.customerName ?? null,
      producedAt: lot.producedAt,
    };
  }

  private async toInspectionViews(tx: Tx, rows: InspectionRow[]) {
    const ids = [...new Set(rows.map((r) => r.inspectorEmployeeId).filter((v): v is number => v !== null))];
    const names = new Map((ids.length ? await this.repo.employeeNames(tx, ids) : []).map((e) => [e.id, e.employeeName]));
    return rows.map((r) => ({
      id: r.id,
      qualityInspectionNo: r.qualityInspectionNo,
      processCode: r.processCode,
      inspectionName: INSPECTION_NAME[r.processCode] ?? r.processCode,
      inspectionResult: r.inspectionResult,
      inspectorEmployeeId: r.inspectorEmployeeId,
      /** null = 시스템(실적 시뮬레이션·시드) */
      inspectorEmployeeName: r.inspectorEmployeeId ? names.get(r.inspectorEmployeeId) ?? null : null,
      inspectedAt: r.inspectedAt,
      memo: r.memo,
      lot: this.toLotView(r.lot),
      values: r.values.map((v) => ({
        inspectionItemCode: v.inspectionItemCode, inspectionItemName: v.inspectionItemName, unit: v.unit,
        minValue: v.minValue, maxValue: v.maxValue, measuredValue: v.measuredValue, isPassed: v.isPassed, sortOrder: v.sortOrder,
      })),
    }));
  }
}
