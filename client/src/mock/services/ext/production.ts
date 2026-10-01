// 생산 영역 보완 규칙 (검토 반영, 2026-10-02). core 서비스에 아직 없는 확인이라 병렬 규칙대로 새 파일에 둔다.
// 병합 때 core(productionResults.ts·productionPlans.ts·simulation.ts)로 옮기면 이 파일은 지운다.
// 근거: 04 업무 프로세스 10장 "작업: 상태값 없음, 실적의 시작·완료 시각으로 판단", 생산계획 PLANNED → IN_PROGRESS → COMPLETED, REQ-PRD-003.
import { PROCESS_TYPE_LABEL, type ProcessType } from '@/codes';
import type { MockTables, ProductionResultRow } from '@/mock/schema';
import { inputError } from '@/mock/services/context';

type Tables = Readonly<MockTables>;

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

const labelsOf = (rows: readonly ProductionResultRow[]): string => [...new Set(rows.map((r) => PROCESS_TYPE_LABEL[r.processType]))].join('·');

/**
 * 같은 공정에 진행 중(작업 시작만 한) 실적이 있으면 새 실적·새 작업 시작을 받지 않는다.
 * 진행 중 작업은 '작업 완료'(productionResultId)로만 마친다. 그래야 시작만 한 행이 남은 채 계획이 완료되지 않는다.
 */
export function assertNoOpenWorkOfProcess(tables: Tables, productionPlanId: number, processType: ProcessType, productionResultId?: number | null): void {
  if (productionResultId) return;
  const open = openResultsOf(tables, productionPlanId, processType);
  if (open.length > 0) inputError('productionResultId', `진행 중인 ${PROCESS_TYPE_LABEL[processType]} 작업이 있어요. 그 작업을 '작업 완료'로 마쳐 주세요`);
}

/** 연주 작업 완료는 작업 시작 때 기록한 히트로만 한다 (작업 로그와 실적·슬래브의 히트가 같아야 한다) */
export function assertStartedHeat(tables: Tables, productionResultId: number | null | undefined, heatLotId: number): void {
  if (!productionResultId) return;
  const startedHeatLotId = startedHeatLotIdOf(tables, productionResultId);
  if (startedHeatLotId === null || startedHeatLotId === heatLotId) return;
  const heatLotNo = tables.lot.find((l) => l.id === startedHeatLotId)?.lotNo ?? String(startedHeatLotId);
  inputError('heatLotId', `작업 시작 때 기록한 히트 ${heatLotNo}로 완료해 주세요`);
}

/** 실적 등록으로 계획이 완료되었는데 진행 중 작업이 남아 있으면 거부한다 (트랜잭션 전체 취소) */
export function assertNoOpenWorkOnCompletion(tables: Tables, productionPlanId: number): void {
  const plan = tables.productionPlan.find((p) => p.id === productionPlanId);
  if (plan?.productionPlanStatus !== 'COMPLETED') return;
  const open = openResultsOf(tables, productionPlanId);
  if (open.length > 0) inputError('productionPlanId', `작업 시작만 한 ${labelsOf(open)} 실적이 남아 있어요. 먼저 '작업 완료'로 마쳐야 계획을 완료할 수 있어요`);
}

/** 실적 시뮬레이션 전: 진행 중 작업이 있으면 실행하지 않는다 (시뮬레이션은 새 실적만 만들어 시작한 행이 남는다) */
export function assertNoOpenWorkForSimulation(tables: Tables, productionPlanId: number): void {
  const open = openResultsOf(tables, productionPlanId);
  if (open.length > 0) inputError('productionPlanId', `작업 시작만 한 ${labelsOf(open)} 실적이 있어요. '작업 완료'로 마친 뒤 시뮬레이션해 주세요`);
}
