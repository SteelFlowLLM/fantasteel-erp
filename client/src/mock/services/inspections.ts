// 검사 입력·자동 판정·불합격 처리 (REQ-QC-001~004, REQ-INV-004·007, BP-QC-01, 업무 프로세스 4.3·10장).
// - 판정은 현재 검사 기준 버전으로 한다. 측정값을 한 번이라도 넣은 검사는 그때의 기준 버전(inspection_standard_id)을 유지한다.
// - 같은 검사 행을 고치고 전후 값을 작업 로그(INSPECTION_REGISTERED before/after)에 남긴다. 밀시트에 들어간 LOT은 고칠 수 없다.
// - 합격으로 적격이 되면 원래 수주 품목의 미확보 안에서 자동 예약(SYSTEM). 예약하지 못한 합격 슬래브는 여재로 표시.
// - 불합격(히트 불합격이면 하위 슬래브·코일 전체)은 배정 RELEASED(QUALITY_FAILURE)와 규격 풀 재조정.
import { DISPOSITION_STATUS, type DispositionStatus } from '@/codes';
import { isQualityExcluded } from '@/lib/eligibility';
import { pickFifo } from '@/lib/fifo';
import { applicableItems, judgeInspection } from '@/lib/inspectionJudgment';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { InspectionStandardItemRow, LotRow, MockTables, ProductionPlanRow, QualityInspectionRow } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import {
  ApiError,
  assertNotChanged,
  checkDecimal,
  checkText,
  currentStandardOf,
  employeeNameOf,
  FieldErrors,
  findById,
  inputError,
  inspectionProcessOf,
  mustGet,
  salesOrderIdOfLot,
  salesOrderIdOfPlan,
  steelGradeCodeOf,
  SYSTEM_ACTOR,
  uniqueIds,
  type PersonActor,
} from '@/mock/services/context';
import { heatOf, lotEligibility } from '@/mock/services/inventoryPool';
import { millSheetLotIdsOf } from '@/mock/services/millSheets';
import { rebalancePool, releaseAllocationOfFailedLot, reserveUpToShortage } from '@/mock/services/reservations';

type Tables = Readonly<MockTables>;

/** 검사 대상 LOT의 PENDING 검사 행을 만든다 (현재 기준이 없으면 만들지 않는다 — 입력할 때 MST-001) */
export function ensurePendingInspection(tx: MockTx, lot: LotRow): QualityInspectionRow | null {
  const processType = inspectionProcessOf(lot.lotType);
  if (!processType) return null;
  const existing = tx.tables.qualityInspection.find((q) => q.lotId === lot.id);
  if (existing) return existing;
  const standard = currentStandardOf(tx.tables, processType, lot.steelGradeId);
  if (!standard) return null;
  return insertRow(tx, 'qualityInspection', {
    lotId: lot.id,
    inspectionStandardId: standard.id,
    processType,
    inspectionResult: 'PENDING',
    inspectorEmployeeId: null,
    inspectedAt: null,
  });
}

/** 검사 판정에 쓰는 제품 두께: 슬래브·코일은 규격 두께, 히트는 없음(성분 기준에 두께 구간을 두지 않는다) */
export function lotThicknessOf(tables: Tables, lot: LotRow): string | null {
  if (lot.lotType !== 'SLAB' && lot.lotType !== 'COIL') return null;
  return findById(tables, 'item', lot.itemId)?.thicknessMm ?? null;
}

/** 이 LOT(제품 또는 그 히트)이 들어간 밀시트 번호들. 있으면 측정값을 고칠 수 없다 (REQ-QC-003) */
export function millSheetNosContainingLot(tables: Tables, lotId: number): string[] {
  return tables.millSheet.filter((m) => millSheetLotIdsOf(m.snapshot).includes(lotId)).map((m) => m.millSheetNo);
}

export const isInspectionLocked = (tables: Tables, lotId: number): boolean => millSheetNosContainingLot(tables, lotId).length > 0;

const valuesOf = (tables: Tables, inspectionId: number | undefined) =>
  inspectionId === undefined ? [] : tables.qualityInspectionValue.filter((v) => v.qualityInspectionId === inspectionId);

const inspectionSnapshot = (tables: Tables, row: QualityInspectionRow | undefined) =>
  row
    ? {
        id: row.id,
        inspectionStandardId: row.inspectionStandardId,
        inspectionResult: row.inspectionResult,
        values: valuesOf(tables, row.id).map((v) => ({
          inspectionItemCode: tables.inspectionStandardItem.find((i) => i.id === v.inspectionStandardItemId)?.inspectionItemCode ?? String(v.inspectionStandardItemId),
          measuredValue: v.measuredValue,
          isPassed: v.isPassed,
        })),
      }
    : null;

export interface RegisterInspectionInput {
  lotId: number;
  /** 입력한 항목 값. 빈 값(null·'')은 지운다. 넘기지 않은 항목은 그대로 둔다. */
  values: readonly { inspectionStandardItemId: number; measuredValue: string | null }[];
  /** 화면을 연 시점의 quality_inspection.updatedAt (없으면 확인 안 함) */
  expectedUpdatedAt?: string | null;
}

export interface RegisterInspectionResult {
  inspection: QualityInspectionRow;
  /** 자동 예약한 매수 합계 */
  autoReservedQty: number;
  /** 여재로 표시한 LOT 번호 */
  surplusLotNos: string[];
  /** 품질 불합격으로 적격에서 빠진 LOT 수 */
  excludedLotQty: number;
}

/** 측정값 등록·수정과 자동 판정 */
export function registerInspection(tx: MockTx, actor: PersonActor, input: RegisterInspectionInput): RegisterInspectionResult {
  const lot = mustGet(tx.tables, 'lot', input.lotId, 'LOT');
  const processType = inspectionProcessOf(lot.lotType);
  if (!processType) inputError('lotId', '히트·슬래브·코일 LOT만 검사해요');
  const lockedBy = millSheetNosContainingLot(tx.tables, lot.id);
  if (lockedBy.length > 0) inputError('lotId', `밀시트(${lockedBy.join(', ')})가 발행된 LOT이라 측정값을 고칠 수 없어요`);

  const existing = tx.tables.qualityInspection.find((q) => q.lotId === lot.id);
  if (existing) assertNotChanged(existing.updatedAt, input.expectedUpdatedAt, '검사 기록');
  const hasValues = existing ? valuesOf(tx.tables, existing.id).some((v) => v.measuredValue !== null) : false;
  const standard = existing && hasValues ? mustGet(tx.tables, 'inspectionStandard', existing.inspectionStandardId, '검사 기준') : currentStandardOf(tx.tables, processType, lot.steelGradeId);
  if (!standard) throw new ApiError('MST-001', `검사 기준(${steelGradeCodeOf(tx.tables, lot.steelGradeId) ?? '강종'})`);

  const items = applicableItems(
    tx.tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === standard.id),
    lotThicknessOf(tx.tables, lot),
  );
  const itemIds = new Set(items.map((i) => i.id));
  const errors = new FieldErrors();
  const measured = new Map<number, string | null>();
  if (existing && existing.inspectionStandardId === standard.id) for (const v of valuesOf(tx.tables, existing.id)) measured.set(v.inspectionStandardItemId, v.measuredValue);
  for (const v of input.values) {
    if (!itemIds.has(v.inspectionStandardItemId)) {
      errors.add(`values.${v.inspectionStandardItemId}`, '이 LOT의 검사 기준에 없는 항목이에요');
      continue;
    }
    const value = checkDecimal(errors, `values.${v.inspectionStandardItemId}`, v.measuredValue, { label: '측정값', scale: 4, integerDigits: 8, allowNegative: true });
    measured.set(v.inspectionStandardItemId, value);
  }
  errors.throwIfAny();

  const judgment = judgeInspection(items, measured);
  const before = inspectionSnapshot(tx.tables, existing);
  const products = lot.lotType === 'HEAT' ? tx.tables.lot.filter((l) => l.heatLotId === lot.id && (l.lotType === 'SLAB' || l.lotType === 'COIL')) : [lot];
  const eligibilityBefore = new Map(products.map((p) => [p.id, lotEligibility(tx.tables, p)]));

  const inspectionValues = { inspectionStandardId: standard.id, processType, inspectionResult: judgment.result, inspectorEmployeeId: actor.employeeId, inspectedAt: tx.nowIso };
  const inspection = existing ? (updateRow(tx, 'qualityInspection', existing.id, inspectionValues) ?? existing) : insertRow(tx, 'qualityInspection', { lotId: lot.id, ...inspectionValues });
  // 기준 버전이 바뀌었으면(값 없던 PENDING 행) 옛 항목 값은 지운다
  tx.tables.qualityInspectionValue.splice(
    0,
    tx.tables.qualityInspectionValue.length,
    ...tx.tables.qualityInspectionValue.filter((v) => v.qualityInspectionId !== inspection.id || itemIds.has(v.inspectionStandardItemId)),
  );
  for (const j of judgment.items) {
    const row = tx.tables.qualityInspectionValue.find((v) => v.qualityInspectionId === inspection.id && v.inspectionStandardItemId === j.inspectionStandardItemId);
    if (row) {
      if (row.measuredValue !== j.measuredValue || row.isPassed !== j.isPassed) updateRow(tx, 'qualityInspectionValue', row.id, { measuredValue: j.measuredValue, isPassed: j.isPassed });
    } else {
      insertRow(tx, 'qualityInspectionValue', { qualityInspectionId: inspection.id, inspectionStandardItemId: j.inspectionStandardItemId, measuredValue: j.measuredValue, isPassed: j.isPassed });
    }
  }
  updateRow(tx, 'lot', lot.id, { isPassed: judgment.result === 'PASS' ? true : judgment.result === 'FAIL' ? false : null });

  recordBusinessEvent(tx, {
    businessEventType: 'INSPECTION_REGISTERED',
    actor,
    targetType: 'quality_inspection',
    targetId: inspection.id,
    targetNo: lot.lotNo,
    salesOrderId: salesOrderIdOfLot(tx.tables, lot),
    beforeData: before,
    afterData: { ...inspectionSnapshot(tx.tables, inspection), inspectionStandardCode: standard.inspectionStandardCode, version: standard.version, missingRequiredItemIds: judgment.missingRequiredItemIds, failedItemIds: judgment.failedItemIds },
    lotIds: [lot.id],
  });

  const outcome = applyEligibilityChanges(tx, products, eligibilityBefore);
  return { inspection, ...outcome };
}

/**
 * 판정 뒤 적격이 바뀐 제품을 처리한다.
 * - 적격이 된 LOT: 계획의 원래 수주 품목(같은 규격)에 미확보만큼 자동 예약. 남은 슬래브는 여재(SURPLUS_CONVERTED).
 * - 적격에서 빠진 LOT: CONFIRMED 배정 해제 + 규격 풀 재조정 (QUALITY_FAILURE).
 */
function applyEligibilityChanges(tx: MockTx, products: readonly LotRow[], before: ReadonlyMap<number, string>): Omit<RegisterInspectionResult, 'inspection'> {
  const becameEligible: LotRow[] = [];
  const lostEligibility: LotRow[] = [];
  for (const product of products) {
    const current = tx.tables.lot.find((l) => l.id === product.id) ?? product;
    const now = lotEligibility(tx.tables, current);
    const was = before.get(product.id);
    if (now === 'ELIGIBLE' && was !== 'ELIGIBLE') becameEligible.push(current);
    if (now !== 'ELIGIBLE' && (was === 'ELIGIBLE' || now === 'FAILED' || now === 'HEAT_FAILED')) lostEligibility.push(current);
  }

  // 적격에서 빠진 것: 배정 해제 → 풀 재조정
  for (const lot of lostEligibility) releaseAllocationOfFailedLot(tx, lot.id);
  const lostByItem = new Map<number, LotRow[]>();
  for (const lot of lostEligibility) if (lot.itemId !== null) lostByItem.set(lot.itemId, [...(lostByItem.get(lot.itemId) ?? []), lot]);
  for (const [itemId, lots] of lostByItem) {
    const affected = uniqueIds(lots.map((l) => findById(tx.tables, 'productionPlan', l.productionPlanId)?.salesOrderItemId).filter((id): id is number => typeof id === 'number'));
    rebalancePool(tx, itemId, { affectedSalesOrderItemIds: affected, lotIds: lots.map((l) => l.id) });
  }

  // 적격이 된 것: 계획별로 자동 예약
  let autoReservedQty = 0;
  const surplusLots: LotRow[] = [];
  const byPlan = new Map<number, LotRow[]>();
  for (const lot of becameEligible) byPlan.set(lot.productionPlanId ?? 0, [...(byPlan.get(lot.productionPlanId ?? 0) ?? []), lot]);
  for (const [planId, lots] of byPlan) {
    const plan = findById(tx.tables, 'productionPlan', planId);
    const sameSpec = plan ? lots.filter((l) => l.itemId === plan.itemId) : [];
    let reserved = 0;
    if (plan && plan.salesOrderItemId !== null && sameSpec.length > 0) {
      const ordered = pickFifo(sameSpec, sameSpec.length);
      const result = reserveUpToShortage(tx, SYSTEM_ACTOR, {
        salesOrderItemId: plan.salesOrderItemId,
        reasonText: '검사 합격 생산분을 원래 수주에 자동 예약',
        lotIds: ordered.map((l) => l.id),
      });
      reserved = result.reservedQty;
      autoReservedQty += reserved;
    }
    // 여재: 슬래브 계획(또는 수주 연결이 끊긴 계획, 이미 완료되어 더 열연하지 않는 코일 계획)의 합격 슬래브 중 예약하지 못한 것
    const surplusCandidates = lots.filter(
      (l) => l.lotType === 'SLAB' && l.surplusAt === null && (!plan || plan.salesOrderItemId === null || plan.itemId === l.itemId || plan.productionPlanStatus === 'COMPLETED'),
    );
    surplusLots.push(...pickFifo(surplusCandidates, surplusCandidates.length).slice(Math.min(reserved, surplusCandidates.length)));
  }
  if (surplusLots.length > 0) {
    for (const lot of surplusLots) updateRow(tx, 'lot', lot.id, { surplusAt: tx.nowIso });
    const byPlanForEvent = new Map<number, LotRow[]>();
    for (const lot of surplusLots) byPlanForEvent.set(lot.productionPlanId ?? 0, [...(byPlanForEvent.get(lot.productionPlanId ?? 0) ?? []), lot]);
    for (const [planId, lots] of byPlanForEvent) {
      const plan = findById(tx.tables, 'productionPlan', planId);
      recordBusinessEvent(tx, {
        businessEventType: 'SURPLUS_CONVERTED',
        actor: SYSTEM_ACTOR,
        targetType: plan ? 'production_plan' : 'lot',
        targetId: plan ? plan.id : (lots[0]?.id ?? 0),
        targetNo: plan ? plan.productionPlanNo : (lots[0]?.lotNo ?? null),
        salesOrderId: salesOrderIdOfPlan(tx.tables, plan),
        afterData: { lotNos: lots.map((l) => l.lotNo), surplusQty: lots.length },
        reasonCode: 'SURPLUS_CONVERSION',
        reasonText: surplusReasonOf(plan, lots),
        lotIds: lots.map((l) => l.id),
      });
    }
  }
  return { autoReservedQty, surplusLotNos: surplusLots.map((l) => l.lotNo), excludedLotQty: lostEligibility.length };
}

function surplusReasonOf(plan: ProductionPlanRow | undefined, lots: readonly LotRow[]): string {
  if (plan && plan.salesOrderItemId === null) return '수주 연결이 해제된 계획의 합격 슬래브를 여재로 전환';
  if (plan && lots.some((l) => l.itemId !== plan.itemId)) return '계획 완료 후 남은 합격 슬래브를 여재로 전환';
  return '수주 미확보를 넘는 합격 슬래브를 여재로 전환';
}

/** 불합격 처리 상태 지정 (REQ-QC-004): 불합격 LOT(또는 히트 불합격 하위 LOT)만. 후속 처리 로직은 없다. */
export function setDisposition(
  tx: MockTx,
  actor: PersonActor,
  input: { lotId: number; dispositionStatus: DispositionStatus; dispositionReason: string; expectedUpdatedAt?: string | null },
): LotRow {
  const lot = mustGet(tx.tables, 'lot', input.lotId, 'LOT');
  assertNotChanged(lot.updatedAt, input.expectedUpdatedAt, 'LOT');
  if (!isQualityExcluded(lot, heatOf(tx.tables, lot))) inputError('lotId', '불합격 LOT만 처리 상태를 지정할 수 있어요');
  const errors = new FieldErrors();
  if (!Object.values(DISPOSITION_STATUS).includes(input.dispositionStatus)) errors.add('dispositionStatus', '처리 상태를 골라 주세요');
  const reason = checkText(errors, 'dispositionReason', input.dispositionReason, '사유', 500, true);
  errors.throwIfAny();
  const before = { dispositionStatus: lot.dispositionStatus, dispositionReason: lot.dispositionReason, dispositionAt: lot.dispositionAt };
  const updated = updateRow(tx, 'lot', lot.id, { dispositionStatus: input.dispositionStatus, dispositionReason: reason, dispositionAt: tx.nowIso }) ?? lot;
  recordBusinessEvent(tx, {
    businessEventType: 'DISPOSITION_SET',
    actor,
    targetType: 'lot',
    targetId: lot.id,
    targetNo: lot.lotNo,
    salesOrderId: salesOrderIdOfLot(tx.tables, lot),
    beforeData: before,
    afterData: { dispositionStatus: updated.dispositionStatus, dispositionReason: updated.dispositionReason, dispositionAt: updated.dispositionAt },
    reasonText: reason,
    lotIds: [lot.id],
  });
  return updated;
}

// ── 조회 ──────────────────────────────────────────────

export type InspectionStatus = 'PENDING' | 'PASS' | 'FAIL';

export interface InspectionQueueRow {
  lotId: number;
  lotNo: string;
  lotType: LotRow['lotType'];
  lotStatus: LotRow['lotStatus'];
  processType: string;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  producedDate: string;
  heatLotId: number | null;
  heatLotNo: string | null;
  heatResult: InspectionStatus | null;
  productionPlanNo: string | null;
  qualityInspectionId: number | null;
  inspectionResult: InspectionStatus;
  inspectionStandardCode: string | null;
  inspectionStandardVersion: number | null;
  inspectedAt: string | null;
  inspectorName: string | null;
  locked: boolean;
}

const resultOfLot = (lot: LotRow | undefined): InspectionStatus | null => (!lot ? null : lot.isPassed === true ? 'PASS' : lot.isPassed === false ? 'FAIL' : 'PENDING');

/** 검사 대상 목록: 판정 대기 먼저(생산완료일 → LOT 번호), 그다음 최근 판정 순 */
export function inspectionQueue(tables: Tables): InspectionQueueRow[] {
  const rows = tables.lot
    .filter((l) => l.lotType === 'HEAT' || l.lotType === 'SLAB' || l.lotType === 'COIL')
    .map((lot): InspectionQueueRow => {
      const inspection = tables.qualityInspection.find((q) => q.lotId === lot.id);
      const standard = inspection ? findById(tables, 'inspectionStandard', inspection.inspectionStandardId) : undefined;
      const item = findById(tables, 'item', lot.itemId);
      const heat = heatOf(tables, lot);
      return {
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotType: lot.lotType,
        lotStatus: lot.lotStatus,
        processType: inspectionProcessOf(lot.lotType) ?? '',
        itemId: lot.itemId,
        itemCode: item?.itemCode ?? null,
        itemName: item?.itemName ?? null,
        steelGradeCode: steelGradeCodeOf(tables, lot.steelGradeId),
        thicknessMm: lotThicknessOf(tables, lot),
        producedDate: lot.producedDate,
        heatLotId: heat?.id ?? null,
        heatLotNo: heat?.lotNo ?? null,
        heatResult: resultOfLot(heat),
        productionPlanNo: findById(tables, 'productionPlan', lot.productionPlanId)?.productionPlanNo ?? null,
        qualityInspectionId: inspection?.id ?? null,
        inspectionResult: resultOfLot(lot) ?? 'PENDING',
        inspectionStandardCode: standard?.inspectionStandardCode ?? null,
        inspectionStandardVersion: standard?.version ?? null,
        inspectedAt: inspection?.inspectedAt ?? null,
        inspectorName: employeeNameOf(tables, inspection?.inspectorEmployeeId),
        locked: isInspectionLocked(tables, lot.id),
      };
    });
  const pending = rows.filter((r) => r.inspectionResult === 'PENDING').sort((a, b) => a.producedDate.localeCompare(b.producedDate) || a.lotNo.localeCompare(b.lotNo));
  const judged = rows.filter((r) => r.inspectionResult !== 'PENDING').sort((a, b) => (b.inspectedAt ?? '').localeCompare(a.inspectedAt ?? '') || b.lotId - a.lotId);
  return [...pending, ...judged];
}

export interface InspectionFormItem {
  inspectionStandardItemId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  minThicknessMm: string | null;
  maxThicknessMm: string | null;
  isRequired: boolean;
  sortOrder: number;
  measuredValue: string | null;
  isPassed: boolean | null;
}

export interface InspectionFormView {
  lot: InspectionQueueRow;
  qualityInspectionId: number | null;
  /** 이 검사 행의 수정 시각 (registerInspection의 expectedUpdatedAt) */
  updatedAt: string | null;
  inspectionResult: InspectionStatus;
  /** 판정에 쓰는(쓴) 기준 버전. 값을 넣은 적이 없으면 현재 버전 */
  standard: { id: number; inspectionStandardCode: string; version: number; isCurrent: boolean } | null;
  currentStandard: { id: number; inspectionStandardCode: string; version: number } | null;
  /** 두께 구간(초과~이하)으로 거른 적용 항목 (샤르피는 SM 강종·6mm 초과 코일만) */
  items: InspectionFormItem[];
  locked: boolean;
  lockedMillSheetNos: string[];
}

export function inspectionFormOf(tables: Tables, lotId: number): InspectionFormView {
  const lot = mustGet(tables, 'lot', lotId, 'LOT');
  const processType = inspectionProcessOf(lot.lotType);
  if (!processType) inputError('lotId', '히트·슬래브·코일 LOT만 검사해요');
  const queueRow = inspectionQueue(tables).find((r) => r.lotId === lot.id);
  if (!queueRow) throw new ApiError('COM-003', lot.lotNo);
  const inspection = tables.qualityInspection.find((q) => q.lotId === lot.id);
  const values = valuesOf(tables, inspection?.id);
  const hasValues = values.some((v) => v.measuredValue !== null);
  const current = currentStandardOf(tables, processType, lot.steelGradeId);
  const standard = inspection && hasValues ? findById(tables, 'inspectionStandard', inspection.inspectionStandardId) : current;
  const items: InspectionStandardItemRow[] = standard
    ? applicableItems(
        tables.inspectionStandardItem.filter((i) => i.inspectionStandardId === standard.id),
        lotThicknessOf(tables, lot),
      ).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    : [];
  const lockedMillSheetNos = millSheetNosContainingLot(tables, lot.id);
  return {
    lot: queueRow,
    qualityInspectionId: inspection?.id ?? null,
    updatedAt: inspection?.updatedAt ?? null,
    inspectionResult: queueRow.inspectionResult,
    standard: standard ? { id: standard.id, inspectionStandardCode: standard.inspectionStandardCode, version: standard.version, isCurrent: standard.isCurrent } : null,
    currentStandard: current ? { id: current.id, inspectionStandardCode: current.inspectionStandardCode, version: current.version } : null,
    items: items.map((item) => {
      const value = values.find((v) => v.inspectionStandardItemId === item.id);
      return {
        inspectionStandardItemId: item.id,
        inspectionItemCode: item.inspectionItemCode,
        inspectionItemName: item.inspectionItemName,
        unit: item.unit,
        minValue: item.minValue,
        maxValue: item.maxValue,
        minThicknessMm: item.minThicknessMm,
        maxThicknessMm: item.maxThicknessMm,
        isRequired: item.isRequired,
        sortOrder: item.sortOrder,
        measuredValue: value?.measuredValue ?? null,
        isPassed: value?.isPassed ?? null,
      };
    }),
    locked: lockedMillSheetNos.length > 0,
    lockedMillSheetNos,
  };
}

export interface RejectedLotRow {
  lotId: number;
  lotNo: string;
  lotType: LotRow['lotType'];
  lotStatus: LotRow['lotStatus'];
  /** FAILED = 이 LOT 불합격, HEAT_FAILED = 상위 히트 불합격으로 제외 */
  reason: 'FAILED' | 'HEAT_FAILED';
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  heatLotNo: string | null;
  producedDate: string;
  productionPlanNo: string | null;
  inspectedAt: string | null;
  failedItems: { inspectionItemCode: string; inspectionItemName: string; unit: string | null; minValue: string | null; maxValue: string | null; measuredValue: string | null }[];
  dispositionStatus: DispositionStatus | null;
  dispositionReason: string | null;
  dispositionAt: string | null;
  updatedAt: string;
}

/** 불합격 관리 목록: 불합격 LOT(히트 포함)과 불합격 히트 때문에 제외된 하위 LOT */
export function rejectedLots(tables: Tables): RejectedLotRow[] {
  return tables.lot
    .filter((l) => (l.lotType === 'HEAT' || l.lotType === 'SLAB' || l.lotType === 'COIL') && isQualityExcluded(l, heatOf(tables, l)))
    .map((lot) => {
      const heat = heatOf(tables, lot);
      const inspection = tables.qualityInspection.find((q) => q.lotId === (lot.isPassed === false ? lot.id : (heat?.id ?? lot.id)));
      const failedItems = valuesOf(tables, inspection?.id)
        .filter((v) => v.isPassed === false)
        .map((v) => {
          const item = tables.inspectionStandardItem.find((i) => i.id === v.inspectionStandardItemId);
          return {
            inspectionItemCode: item?.inspectionItemCode ?? '',
            inspectionItemName: item?.inspectionItemName ?? '',
            unit: item?.unit ?? null,
            minValue: item?.minValue ?? null,
            maxValue: item?.maxValue ?? null,
            measuredValue: v.measuredValue,
          };
        });
      const item = findById(tables, 'item', lot.itemId);
      return {
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotType: lot.lotType,
        lotStatus: lot.lotStatus,
        reason: lot.isPassed === false ? ('FAILED' as const) : ('HEAT_FAILED' as const),
        itemCode: item?.itemCode ?? null,
        itemName: item?.itemName ?? null,
        steelGradeCode: steelGradeCodeOf(tables, lot.steelGradeId),
        heatLotNo: heat?.lotNo ?? null,
        producedDate: lot.producedDate,
        productionPlanNo: findById(tables, 'productionPlan', lot.productionPlanId)?.productionPlanNo ?? null,
        inspectedAt: inspection?.inspectedAt ?? null,
        failedItems,
        dispositionStatus: lot.dispositionStatus,
        dispositionReason: lot.dispositionReason,
        dispositionAt: lot.dispositionAt,
        updatedAt: lot.updatedAt,
      };
    })
    .sort((a, b) => b.producedDate.localeCompare(a.producedDate) || a.lotNo.localeCompare(b.lotNo));
}
