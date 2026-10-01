// 작업 실적: 제선·제강·연주 (REQ-PRD-003, REQ-LOT-001~004, BP-PRD-02 표의 모든 행, 업무 프로세스 9.2·10장).
// - 작업 상태값은 없다: started_at / completed_at (completed_at null = 진행 중). 한 번에 등록하거나 시작 후 완료할 수 있다.
// - 이벤트: PRODUCTION_STARTED(작업 시작), PRODUCTION_RESULT_REGISTERED(실적 등록·작업 완료).
// - 제선: 원료별 투입량 = 용선량 × 원단위(t/t)를 입고일 순 FIFO로 원료 LOT에서 차감 → 원료→용선 PERIOD_BASED(기간·차감량).
// - 제강: 용선을 생산 순 FIFO로 투입(N:M ACTUAL_INPUT), 히트 톤 = 투입 용선량 × 제강 계획 수율,
//         합금철 = 히트 톤 × kg/t ÷ 1,000을 입고일 순 FIFO로 차감 → 합금철→히트 ACTUAL_INPUT. 히트는 성분 검사 대상.
// - 연주: 히트 하나를 한 번 연주, 슬래브 히트번호-SS (1:N). 최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량).
// - 원료·용선 잔량은 음수가 되지 않는다(모자라면 입력 오류). 잔량이 0이 되면 LOT은 CONSUMED.
// - 진행 중 작업(시작만 한 실적)이 있으면 같은 공정의 새 실적·새 시작을 받지 않고 '작업 완료'로만 마친다.
//   연주 작업 완료는 시작 때 기록한 히트로만 한다. 실적 등록으로 계획이 완료되는데 시작만 한 실적이 남으면 거부한다(트랜잭션 취소).
import { PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import { decCmp, decMul, decSum, TON_DIGITS } from '@/lib/decimal';
import { planFifoDeduction, type FifoDeduction } from '@/lib/fifo';
import { maxSlabQtyFromHeat } from '@/lib/heatPlanning';
import { ferroalloyTonFor, rawMaterialTonFor } from '@/lib/mrp';
import { calcWeightTon } from '@/lib/weight';
import { recordBusinessEvent } from '@/mock/businessEvents';
import type { LotRow, MockTables, ProductionPlanRow, ProductionResultRow } from '@/mock/schema';
import { issueHeatNo, issueHotMetalNo, issueSlabNo } from '@/mock/sequence';
import { insertRow, updateRow, type MockTx } from '@/mock/store';
import {
  castingSlabSpecOf,
  checkDateTime,
  checkDecimal,
  FieldErrors,
  inputError,
  InputError,
  mustGet,
  productItemTypeOf,
  refreshInventory,
  routingYieldOf,
  salesOrderIdOfPlan,
  seoulDateOf,
  theoreticalWeightOf,
  type PersonActor,
} from '@/mock/services/context';
import { ensurePendingInspection } from '@/mock/services/inspections';
import { refreshPlanStatus } from '@/mock/services/productionPlans';

type Tables = Readonly<MockTables>;

const CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

/** 실적 시뮬레이션이 넘기는 값 (REQ-PRD-007) */
export interface SimulationMark {
  randomSeed: number;
  sampleLossRate?: string | null;
  lossQty?: number | null;
}

interface ResultTimes {
  startedAt: string;
  completedAt: string;
}

function checkTimes(errors: FieldErrors, startedAt: string, completedAt: string): ResultTimes {
  const s = checkDateTime(errors, 'startedAt', startedAt, '작업 시작 일시');
  const c = checkDateTime(errors, 'completedAt', completedAt, '작업 완료 일시');
  if (s && c && c < s) errors.add('completedAt', '작업 완료 일시는 시작 일시 뒤여야 해요');
  return { startedAt: s ?? '', completedAt: c ?? '' };
}

/** 계획을 확인한다: 취소·완료된 계획과 라우팅에 없는 공정은 입력 오류 */
export function planForWork(tx: MockTx, productionPlanId: number, processType: ProcessType): ProductionPlanRow {
  const plan = mustGet(tx.tables, 'productionPlan', productionPlanId, '생산계획');
  if (plan.productionPlanStatus === 'CANCELLED') inputError('productionPlanId', '취소된 생산계획이에요');
  if (plan.productionPlanStatus === 'COMPLETED' && processType !== 'HOT_ROLLING') inputError('productionPlanId', '이미 완료된 생산계획이에요');
  const item = mustGet(tx.tables, 'item', plan.itemId, '규격');
  const type = productItemTypeOf(item);
  if (!tx.tables.routing.some((r) => r.itemType === type && r.processType === processType)) inputError('processType', '이 계획의 라우팅에 없는 공정이에요');
  return plan;
}

function resultEventBase(tx: MockTx, plan: ProductionPlanRow) {
  return { targetType: 'production_result' as const, salesOrderId: salesOrderIdOfPlan(tx.tables, plan) };
}

// ── 진행 중 작업 (04 10장 "작업: 상태값 없음, 실적의 시작·완료 시각으로 판단", REQ-PRD-003) ──

/** 작업 시작만 기록한(완료 일시가 없는) 실적. processType을 주면 그 공정만 */
export function openResultsOf(tables: Tables, productionPlanId: number, processType?: ProcessType): ProductionResultRow[] {
  return tables.productionResult
    .filter((r) => r.productionPlanId === productionPlanId && r.completedAt === null && (!processType || r.processType === processType))
    .sort((a, b) => a.id - b.id);
}

/** 연주 작업을 시작할 때 기록한 히트 (PRODUCTION_STARTED.afterData.heatLotId). ERD production_result에 히트 칸이 없어 작업 로그에서 읽는다 */
export function startedHeatLotIdOf(tables: Tables, productionResultId: number): number | null {
  const event = tables.businessEvent.find((e) => e.businessEventType === 'PRODUCTION_STARTED' && e.targetType === 'production_result' && e.targetId === productionResultId);
  const after = event?.afterData;
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const heatLotId = after.heatLotId;
  return typeof heatLotId === 'number' ? heatLotId : null;
}

const processLabelsOf = (rows: readonly ProductionResultRow[]): string => [...new Set(rows.map((r) => PROCESS_TYPE_LABEL[r.processType]))].join('·');

/**
 * 같은 공정에 진행 중(작업 시작만 한) 실적이 있으면 새 실적·새 작업 시작을 받지 않는다.
 * 진행 중 작업은 '작업 완료'(productionResultId)로만 마친다. 그래야 시작만 한 행이 남은 채 계획이 완료되지 않는다.
 */
function assertNoOpenWorkOfProcess(tables: Tables, productionPlanId: number, processType: ProcessType, productionResultId?: number | null): void {
  if (productionResultId) return;
  const open = openResultsOf(tables, productionPlanId, processType);
  if (open.length > 0) inputError('productionResultId', `진행 중인 ${PROCESS_TYPE_LABEL[processType]} 작업이 있어요. 그 작업을 '작업 완료'로 마쳐 주세요`);
}

/** 연주 작업 완료는 작업 시작 때 기록한 히트로만 한다 (작업 로그와 실적·슬래브의 히트가 같아야 한다) */
function assertStartedHeat(tables: Tables, productionResultId: number | null | undefined, heatLotId: number): void {
  if (!productionResultId) return;
  const startedHeatLotId = startedHeatLotIdOf(tables, productionResultId);
  if (startedHeatLotId === null || startedHeatLotId === heatLotId) return;
  const heatNo = tables.lot.find((l) => l.id === startedHeatLotId)?.lotNo ?? String(startedHeatLotId);
  inputError('heatLotId', `작업 시작 때 기록한 히트 ${heatNo}로 완료해 주세요`);
}

/** 실적 등록으로 계획이 완료되었는데 진행 중 작업이 남아 있으면 거부한다 (트랜잭션 전체 취소) */
export function assertNoOpenWorkOnCompletion(tables: Tables, productionPlanId: number): void {
  const plan = tables.productionPlan.find((p) => p.id === productionPlanId);
  if (plan?.productionPlanStatus !== 'COMPLETED') return;
  const open = openResultsOf(tables, productionPlanId);
  if (open.length > 0) inputError('productionPlanId', `작업 시작만 한 ${processLabelsOf(open)} 실적이 남아 있어요. 먼저 '작업 완료'로 마쳐야 계획을 완료할 수 있어요`);
}

/** 실적 시뮬레이션 전: 진행 중 작업이 있으면 실행하지 않는다 (시뮬레이션은 새 실적만 만들어 시작한 행이 남는다) */
export function assertNoOpenWorkForSimulation(tables: Tables, productionPlanId: number): void {
  const open = openResultsOf(tables, productionPlanId);
  if (open.length > 0) inputError('productionPlanId', `작업 시작만 한 ${processLabelsOf(open)} 실적이 있어요. '작업 완료'로 마친 뒤 시뮬레이션해 주세요`);
}

/**
 * 작업 시작만 기록한다 (completed_at = null, PRODUCTION_STARTED). 첫 실적이면 계획이 IN_PROGRESS가 된다.
 * 연주는 heatLotId를, 제선·제강은 고로·전로 코드를 함께 받는다(완료할 때 다시 받는다).
 */
export function startWork(
  tx: MockTx,
  actor: PersonActor,
  input: { productionPlanId: number; processType: ProcessType; startedAt: string; blastFurnaceCode?: string | null; converterCode?: string | null; heatLotId?: number | null },
): ProductionResultRow {
  assertNoOpenWorkOfProcess(tx.tables, input.productionPlanId, input.processType);
  const plan = planForWork(tx, input.productionPlanId, input.processType);
  const errors = new FieldErrors();
  const startedAt = checkDateTime(errors, 'startedAt', input.startedAt, '작업 시작 일시');
  if (input.processType === 'IRONMAKING' && !CODE_PATTERN.test(input.blastFurnaceCode ?? '')) errors.add('blastFurnaceCode', '고로 코드를 입력해 주세요 (예: BF2)');
  if (input.processType === 'STEELMAKING' && !CODE_PATTERN.test(input.converterCode ?? '')) errors.add('converterCode', '전로 코드를 입력해 주세요 (예: BOF1)');
  errors.throwIfAny();
  const result = insertRow(tx, 'productionResult', {
    productionPlanId: plan.id,
    processType: input.processType,
    blastFurnaceCode: input.processType === 'IRONMAKING' ? (input.blastFurnaceCode ?? null) : null,
    converterCode: input.processType === 'STEELMAKING' ? (input.converterCode ?? null) : null,
    startedAt: startedAt ?? tx.nowIso,
    completedAt: null,
    inputTon: null,
    outputTon: null,
    outputQty: null,
    lossQty: null,
    sampleLossRate: null,
    randomSeed: null,
    isSimulated: false,
    operatorEmployeeId: actor.employeeId,
  });
  recordBusinessEvent(tx, {
    ...resultEventBase(tx, plan),
    businessEventType: 'PRODUCTION_STARTED',
    actor,
    targetId: result.id,
    targetNo: plan.productionPlanNo,
    afterData: { processType: result.processType, productionPlanNo: plan.productionPlanNo, startedAt: result.startedAt, heatLotId: input.heatLotId ?? null, blastFurnaceCode: result.blastFurnaceCode, converterCode: result.converterCode },
    lotIds: input.heatLotId ? [input.heatLotId] : [],
  });
  refreshPlanStatus(tx, plan.id);
  return result;
}

/** 시작한 실적을 완료하거나, 시작·완료를 한 번에 만든다 */
export function upsertCompletedResult(
  tx: MockTx,
  actor: PersonActor,
  plan: ProductionPlanRow,
  input: {
    productionResultId?: number | null;
    processType: ProcessType;
    times: ResultTimes;
    blastFurnaceCode?: string | null;
    converterCode?: string | null;
    simulation?: SimulationMark | null;
  },
): ProductionResultRow {
  const sim = input.simulation ?? null;
  const values = {
    blastFurnaceCode: input.blastFurnaceCode ?? null,
    converterCode: input.converterCode ?? null,
    startedAt: input.times.startedAt,
    completedAt: input.times.completedAt,
    isSimulated: sim !== null,
    randomSeed: sim?.randomSeed ?? null,
    sampleLossRate: sim?.sampleLossRate ?? null,
    lossQty: sim?.lossQty ?? null,
  };
  if (input.productionResultId) {
    const started = mustGet(tx.tables, 'productionResult', input.productionResultId, '작업 실적');
    if (started.productionPlanId !== plan.id || started.processType !== input.processType) inputError('productionResultId', '다른 계획·공정의 작업이에요');
    if (started.completedAt !== null) inputError('productionResultId', '이미 완료한 작업이에요');
    return updateRow(tx, 'productionResult', started.id, { ...values, startedAt: started.startedAt }) ?? started;
  }
  const result = insertRow(tx, 'productionResult', {
    productionPlanId: plan.id,
    processType: input.processType,
    ...values,
    inputTon: null,
    outputTon: null,
    outputQty: null,
    operatorEmployeeId: actor.employeeId,
  });
  recordBusinessEvent(tx, {
    ...resultEventBase(tx, plan),
    businessEventType: 'PRODUCTION_STARTED',
    actor,
    targetId: result.id,
    targetNo: plan.productionPlanNo,
    afterData: { processType: input.processType, productionPlanNo: plan.productionPlanNo, startedAt: result.startedAt, isSimulated: result.isSimulated },
  });
  return result;
}

/** FIFO 차감을 실제로 적용한다 (잔량 0 → CONSUMED) */
function applyDeductions(tx: MockTx, deductions: readonly FifoDeduction<LotRow & { remainingTon: string }>[]): void {
  for (const d of deductions) {
    const empty = decCmp(d.remainingAfterTon, 0) <= 0;
    updateRow(tx, 'lot', d.lot.id, { remainingTon: d.remainingAfterTon, ...(empty ? { lotStatus: 'CONSUMED' as const, consumedAt: tx.nowIso } : {}) });
  }
}

type TonLot = LotRow & { remainingTon: string };
const withRemaining = (lot: LotRow): lot is TonLot => lot.remainingTon !== null;

/** 그 날짜까지 들어온(만든) 미소진 LOT */
function stockLotsUntil(tx: MockTx, filter: (lot: LotRow) => boolean, date: string): TonLot[] {
  return tx.tables.lot.filter((l) => filter(l) && l.lotStatus === 'AVAILABLE' && l.producedDate <= date).filter(withRemaining).filter((l) => decCmp(l.remainingTon, 0) > 0);
}

export interface LotInput {
  lotId: number;
  lotNo: string;
  ton: string;
}

export interface IronmakingInput {
  productionPlanId: number;
  blastFurnaceCode: string;
  startedAt: string;
  completedAt: string;
  /** 용선량(t) */
  outputTon: string;
  productionResultId?: number | null;
  simulation?: SimulationMark | null;
}

/** 제선 실적 → 용선 LOT HM-고로-YYMMDD-NN */
export function registerIronmaking(tx: MockTx, actor: PersonActor, input: IronmakingInput): { result: ProductionResultRow; hotMetalLot: LotRow; rawMaterialInputs: LotInput[] } {
  assertNoOpenWorkOfProcess(tx.tables, input.productionPlanId, 'IRONMAKING', input.productionResultId);
  const plan = planForWork(tx, input.productionPlanId, 'IRONMAKING');
  const errors = new FieldErrors();
  const times = checkTimes(errors, input.startedAt, input.completedAt);
  if (!CODE_PATTERN.test(input.blastFurnaceCode ?? '')) errors.add('blastFurnaceCode', '고로 코드를 입력해 주세요 (예: BF2)');
  const outputTon = checkDecimal(errors, 'outputTon', input.outputTon, { label: '용선량', scale: 3, integerDigits: 9, positive: true, required: true });
  errors.throwIfAny();
  const hotMetalTon = outputTon ?? '0';
  const completedDate = seoulDateOf(times.completedAt);

  // 원료별 투입량 = 용선량 × 원단위 (철광석·석탄·석회석, 공통 원단위)
  const plans: { itemName: string; deductions: FifoDeduction<TonLot>[]; shortageTon: string }[] = [];
  for (const consumption of tx.tables.specificConsumption.filter((c) => c.steelGradeId === null)) {
    const material = mustGet(tx.tables, 'item', consumption.itemId, '원료');
    if (material.rawMaterialType === 'FERROALLOY') continue;
    const requiredTon = rawMaterialTonFor(hotMetalTon, consumption.consumptionRate);
    const lots = stockLotsUntil(tx, (l) => l.lotType === 'RAW_MATERIAL' && l.itemId === material.id, completedDate);
    plans.push({ itemName: material.itemName, ...planFifoDeduction(lots, requiredTon) });
  }
  const short = plans.filter((p) => decCmp(p.shortageTon, 0) > 0);
  if (short.length > 0) {
    const message = `원료 LOT 잔량이 모자라요: ${short.map((p) => `${p.itemName} ${p.shortageTon}t`).join(', ')}`;
    throw new InputError(message, { outputTon: message });
  }

  const result = upsertCompletedResult(tx, actor, plan, { productionResultId: input.productionResultId, processType: 'IRONMAKING', times, blastFurnaceCode: input.blastFurnaceCode, simulation: input.simulation });
  const allDeductions = plans.flatMap((p) => p.deductions);
  applyDeductions(tx, allDeductions);
  const hotMetalLot = insertRow(tx, 'lot', {
    lotNo: issueHotMetalNo(tx, input.blastFurnaceCode, new Date(times.completedAt)),
    lotType: 'HOT_METAL',
    lotStatus: 'AVAILABLE',
    itemId: null,
    steelGradeId: null,
    heatLotId: null,
    initialTon: hotMetalTon,
    remainingTon: hotMetalTon,
    blastFurnaceCode: input.blastFurnaceCode,
    converterCode: null,
    yardId: null,
    goodsReceiptId: null,
    productionResultId: result.id,
    productionPlanId: plan.id,
    isPassed: null,
    dispositionStatus: null,
    dispositionReason: null,
    dispositionAt: null,
    surplusAt: null,
    producedDate: completedDate,
    consumedAt: null,
    shippedAt: null,
  });
  for (const d of allDeductions) {
    insertRow(tx, 'lotRelation', {
      parentLotId: d.lot.id,
      childLotId: hotMetalLot.id,
      lotRelationEvidence: 'PERIOD_BASED',
      inputTon: d.ton,
      periodStartedAt: times.startedAt,
      periodEndedAt: times.completedAt,
    });
  }
  const inputTon = decSum(allDeductions.map((d) => d.ton));
  const completed = updateRow(tx, 'productionResult', result.id, { inputTon, outputTon: hotMetalTon }) ?? result;
  const rawMaterialInputs = allDeductions.map((d) => ({ lotId: d.lot.id, lotNo: d.lot.lotNo, ton: d.ton }));
  recordBusinessEvent(tx, {
    ...resultEventBase(tx, plan),
    businessEventType: 'PRODUCTION_RESULT_REGISTERED',
    actor,
    targetId: completed.id,
    targetNo: hotMetalLot.lotNo,
    afterData: {
      processType: 'IRONMAKING',
      productionPlanNo: plan.productionPlanNo,
      blastFurnaceCode: input.blastFurnaceCode,
      startedAt: times.startedAt,
      completedAt: times.completedAt,
      outputTon: hotMetalTon,
      outputLotNo: hotMetalLot.lotNo,
      rawMaterialInputs,
      isSimulated: completed.isSimulated,
    },
    lotIds: [hotMetalLot.id, ...rawMaterialInputs.map((r) => r.lotId)],
  });
  refreshPlanStatus(tx, plan.id);
  assertNoOpenWorkOnCompletion(tx.tables, plan.id);
  return { result: completed, hotMetalLot, rawMaterialInputs };
}

export interface SteelmakingInput {
  productionPlanId: number;
  converterCode: string;
  startedAt: string;
  completedAt: string;
  /** 투입 용선량(t). 용선 LOT은 생산 순 FIFO로 자동 선택 */
  inputHotMetalTon: string;
  productionResultId?: number | null;
  simulation?: SimulationMark | null;
}

/** 제강 실적 → 히트 LOT HT-전로-YYMMDD-NNN (성분 검사 대상) */
export function registerSteelmaking(
  tx: MockTx,
  actor: PersonActor,
  input: SteelmakingInput,
): { result: ProductionResultRow; heatLot: LotRow; hotMetalInputs: LotInput[]; ferroalloyInputs: LotInput[] } {
  assertNoOpenWorkOfProcess(tx.tables, input.productionPlanId, 'STEELMAKING', input.productionResultId);
  const plan = planForWork(tx, input.productionPlanId, 'STEELMAKING');
  const item = mustGet(tx.tables, 'item', plan.itemId, '규격');
  const errors = new FieldErrors();
  const times = checkTimes(errors, input.startedAt, input.completedAt);
  if (!CODE_PATTERN.test(input.converterCode ?? '')) errors.add('converterCode', '전로 코드를 입력해 주세요 (예: BOF1)');
  const hotMetalTon = checkDecimal(errors, 'inputHotMetalTon', input.inputHotMetalTon, { label: '투입 용선량', scale: 3, integerDigits: 9, positive: true, required: true });
  errors.throwIfAny();
  const madeHeats = tx.tables.lot.filter((l) => l.productionPlanId === plan.id && l.lotType === 'HEAT').length;
  if (madeHeats >= plan.heatCount) inputError('productionPlanId', `편성한 히트 ${plan.heatCount}개를 모두 만들었어요`);
  const completedDate = seoulDateOf(times.completedAt);
  const steelmakingYield = routingYieldOf(tx.tables, productItemTypeOf(item), 'STEELMAKING');
  const heatTon = decMul(hotMetalTon ?? '0', steelmakingYield, TON_DIGITS);

  const hotMetalPlan = planFifoDeduction(stockLotsUntil(tx, (l) => l.lotType === 'HOT_METAL', completedDate), hotMetalTon ?? '0');
  const alloyPlans: { itemName: string; deductions: FifoDeduction<TonLot>[]; shortageTon: string }[] = [];
  for (const consumption of tx.tables.specificConsumption.filter((c) => c.steelGradeId !== null && c.steelGradeId === item.steelGradeId)) {
    const material = mustGet(tx.tables, 'item', consumption.itemId, '원료');
    if (material.rawMaterialType !== 'FERROALLOY') continue;
    const requiredTon = ferroalloyTonFor(heatTon, consumption.consumptionRate);
    alloyPlans.push({ itemName: material.itemName, ...planFifoDeduction(stockLotsUntil(tx, (l) => l.lotType === 'RAW_MATERIAL' && l.itemId === material.id, completedDate), requiredTon) });
  }
  const shortages = [
    ...(decCmp(hotMetalPlan.shortageTon, 0) > 0 ? [`용선 ${hotMetalPlan.shortageTon}t`] : []),
    ...alloyPlans.filter((p) => decCmp(p.shortageTon, 0) > 0).map((p) => `${p.itemName} ${p.shortageTon}t`),
  ];
  if (shortages.length > 0) {
    const message = `LOT 잔량이 모자라요: ${shortages.join(', ')}`;
    throw new InputError(message, { inputHotMetalTon: message });
  }

  const result = upsertCompletedResult(tx, actor, plan, { productionResultId: input.productionResultId, processType: 'STEELMAKING', times, converterCode: input.converterCode, simulation: input.simulation });
  const alloyDeductions = alloyPlans.flatMap((p) => p.deductions);
  applyDeductions(tx, hotMetalPlan.deductions);
  applyDeductions(tx, alloyDeductions);
  const heatLot = insertRow(tx, 'lot', {
    lotNo: issueHeatNo(tx, input.converterCode, new Date(times.completedAt)),
    lotType: 'HEAT',
    lotStatus: 'AVAILABLE',
    itemId: null,
    steelGradeId: item.steelGradeId,
    heatLotId: null,
    initialTon: heatTon,
    remainingTon: null,
    blastFurnaceCode: null,
    converterCode: input.converterCode,
    yardId: null,
    goodsReceiptId: null,
    productionResultId: result.id,
    productionPlanId: plan.id,
    isPassed: null,
    dispositionStatus: null,
    dispositionReason: null,
    dispositionAt: null,
    surplusAt: null,
    producedDate: completedDate,
    consumedAt: null,
    shippedAt: null,
  });
  for (const d of [...hotMetalPlan.deductions, ...alloyDeductions]) {
    insertRow(tx, 'lotRelation', { parentLotId: d.lot.id, childLotId: heatLot.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: d.ton, periodStartedAt: null, periodEndedAt: null });
  }
  ensurePendingInspection(tx, heatLot);
  const completed = updateRow(tx, 'productionResult', result.id, { inputTon: hotMetalTon, outputTon: heatTon }) ?? result;
  const hotMetalInputs = hotMetalPlan.deductions.map((d) => ({ lotId: d.lot.id, lotNo: d.lot.lotNo, ton: d.ton }));
  const ferroalloyInputs = alloyDeductions.map((d) => ({ lotId: d.lot.id, lotNo: d.lot.lotNo, ton: d.ton }));
  recordBusinessEvent(tx, {
    ...resultEventBase(tx, plan),
    businessEventType: 'PRODUCTION_RESULT_REGISTERED',
    actor,
    targetId: completed.id,
    targetNo: heatLot.lotNo,
    afterData: {
      processType: 'STEELMAKING',
      productionPlanNo: plan.productionPlanNo,
      converterCode: input.converterCode,
      heatSeq: madeHeats + 1,
      startedAt: times.startedAt,
      completedAt: times.completedAt,
      inputHotMetalTon: hotMetalTon,
      heatTon,
      outputLotNo: heatLot.lotNo,
      hotMetalInputs,
      ferroalloyInputs,
      isSimulated: completed.isSimulated,
    },
    lotIds: [heatLot.id, ...hotMetalInputs.map((i) => i.lotId), ...ferroalloyInputs.map((i) => i.lotId)],
  });
  refreshPlanStatus(tx, plan.id);
  assertNoOpenWorkOnCompletion(tx.tables, plan.id);
  return { result: completed, heatLot, hotMetalInputs, ferroalloyInputs };
}

export interface CastingInput {
  productionPlanId: number;
  heatLotId: number;
  /** 슬래브 생산 매수 */
  outputQty: number;
  startedAt: string;
  completedAt: string;
  /** 규격 (생략하면 계획의 슬래브 규격). 다르면 입력 오류 */
  itemId?: number | null;
  productionResultId?: number | null;
  simulation?: SimulationMark | null;
}

/** 히트에서 연주할 수 있는 슬래브 최대 매수 (규칙: floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량)) */
export function maxCastingQtyOf(tx: MockTx | { tables: MockTx['tables'] }, plan: ProductionPlanRow, heat: LotRow): number {
  const item = mustGet(tx.tables, 'item', plan.itemId, '규격');
  const castingYield = routingYieldOf(tx.tables, productItemTypeOf(item), 'CONTINUOUS_CASTING');
  return maxSlabQtyFromHeat(heat.initialTon ?? '0', castingYield, theoreticalWeightOf(castingSlabSpecOf(tx.tables, plan)));
}

/** 연주 실적 → 슬래브 LOT 히트번호-SS (표면·치수 검사 대상) */
export function registerCasting(tx: MockTx, actor: PersonActor, input: CastingInput): { result: ProductionResultRow; slabLots: LotRow[] } {
  assertNoOpenWorkOfProcess(tx.tables, input.productionPlanId, 'CONTINUOUS_CASTING', input.productionResultId);
  assertStartedHeat(tx.tables, input.productionResultId, input.heatLotId);
  const plan = planForWork(tx, input.productionPlanId, 'CONTINUOUS_CASTING');
  const heat = mustGet(tx.tables, 'lot', input.heatLotId, '히트');
  if (heat.lotType !== 'HEAT' || heat.productionPlanId !== plan.id) inputError('heatLotId', '이 계획의 히트가 아니에요');
  if (tx.tables.lot.some((l) => l.heatLotId === heat.id && l.lotType === 'SLAB')) inputError('heatLotId', '이미 연주한 히트예요');
  const slabSpec = castingSlabSpecOf(tx.tables, plan);
  if (input.itemId && input.itemId !== slabSpec.id) inputError('itemId', `이 계획의 슬래브 규격은 ${slabSpec.itemCode}예요`);
  const errors = new FieldErrors();
  const times = checkTimes(errors, input.startedAt, input.completedAt);
  const maxQty = maxCastingQtyOf(tx, plan, heat);
  if (!Number.isInteger(input.outputQty) || input.outputQty < 1) errors.add('outputQty', '슬래브 생산 매수는 1 이상의 정수로 입력해 주세요');
  else if (input.outputQty > maxQty) errors.add('outputQty', `히트 생산량을 넘었어요. 이 히트에서 나올 수 있는 슬래브는 최대 ${maxQty}매예요`);
  errors.throwIfAny();
  const completedDate = seoulDateOf(times.completedAt);
  const slabTheoreticalWeightTon = theoreticalWeightOf(slabSpec);

  const result = upsertCompletedResult(tx, actor, plan, { productionResultId: input.productionResultId, processType: 'CONTINUOUS_CASTING', times, simulation: input.simulation });
  const slabLots: LotRow[] = [];
  for (let n = 0; n < input.outputQty; n += 1) {
    const slab = insertRow(tx, 'lot', {
      lotNo: issueSlabNo(tx, heat.lotNo),
      lotType: 'SLAB',
      lotStatus: 'AVAILABLE',
      itemId: slabSpec.id,
      steelGradeId: heat.steelGradeId,
      heatLotId: heat.id,
      initialTon: null,
      remainingTon: null,
      blastFurnaceCode: null,
      converterCode: null,
      yardId: slabSpec.defaultYardId,
      goodsReceiptId: null,
      productionResultId: result.id,
      productionPlanId: plan.id,
      isPassed: null,
      dispositionStatus: null,
      dispositionReason: null,
      dispositionAt: null,
      // 여재 표시는 검사로 적격이 된 뒤에 한다 (BP-SO-02, REQ-INV-008: 여재 = 미배정 합격 슬래브)
      surplusAt: null,
      producedDate: completedDate,
      consumedAt: null,
      shippedAt: null,
    });
    insertRow(tx, 'lotRelation', { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: 'ACTUAL_INPUT', inputTon: slabTheoreticalWeightTon, periodStartedAt: null, periodEndedAt: null });
    ensurePendingInspection(tx, slab);
    slabLots.push(slab);
  }
  const completed =
    updateRow(tx, 'productionResult', result.id, { inputTon: heat.initialTon, outputQty: input.outputQty, outputTon: calcWeightTon(input.outputQty, slabTheoreticalWeightTon) }) ?? result;
  refreshInventory(tx, slabSpec.id);
  recordBusinessEvent(tx, {
    ...resultEventBase(tx, plan),
    businessEventType: 'PRODUCTION_RESULT_REGISTERED',
    actor,
    targetId: completed.id,
    targetNo: heat.lotNo,
    afterData: {
      processType: 'CONTINUOUS_CASTING',
      productionPlanNo: plan.productionPlanNo,
      heatNo: heat.lotNo,
      itemCode: slabSpec.itemCode,
      startedAt: times.startedAt,
      completedAt: times.completedAt,
      outputQty: input.outputQty,
      maxQty,
      lossQty: completed.lossQty,
      sampleLossRate: completed.sampleLossRate,
      randomSeed: completed.randomSeed,
      outputLotNos: slabLots.map((s) => s.lotNo),
      isSimulated: completed.isSimulated,
    },
    lotIds: [heat.id, ...slabLots.map((s) => s.id)],
  });
  refreshPlanStatus(tx, plan.id);
  assertNoOpenWorkOnCompletion(tx.tables, plan.id);
  return { result: completed, slabLots };
}
