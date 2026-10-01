// 생산 화면(생산계획·작업 실적·열연 투입 배정)이 함께 쓰는 표시 계산. 업무 규칙은 core 서비스가 계산하고, 여기서는 보여 주는 모양만 정한다.
import { PROCESS_TYPE_LABEL, type ProcessType, type ProductItemType, type ProductionPlanStatus } from '@/codes';
import type { StepItem, StepState } from '@/components/Steps';
import type { BadgeTone } from '@/components/Badge';
import { actualLossRateOf } from '@/lib/simulationLoss';

/** 계획 상태 배지 색 */
export const PLAN_STATUS_TONE: Record<ProductionPlanStatus, BadgeTone> = {
  PLANNED: 'wait',
  IN_PROGRESS: 'run',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
};

/** 수율 문자열 → 백분율 ("0.9596" → "95.96%"). 값을 다시 계산하지 않고 자리만 옮긴다. */
export function fmtYieldRate(rate: string | null | undefined): string {
  if (rate === null || rate === undefined || rate.trim() === '') return '-';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) return '-';
  const fraction = (m[3] ?? '').padEnd(2, '0');
  const integer = `${m[2]}${fraction.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = fraction.slice(2).replace(/0+$/, '');
  return `${m[1]}${integer}${rest ? `.${rest}` : ''}%`;
}

/** 손실률 0.0312 → "3.12%" */
export const fmtLossRate = (rate: string | null | undefined): string => fmtYieldRate(rate);

/** 실제 감소율 = 손실 매수 ÷ 계획 매수 (업무 프로세스 8장 '샘플 손실률과 실제 감소율을 함께') */
export function actualLossRateText(plannedQty: number | null | undefined, lossQty: number | null | undefined): string {
  if (plannedQty === null || plannedQty === undefined || lossQty === null || lossQty === undefined || plannedQty <= 0) return '-';
  return `${(actualLossRateOf(plannedQty, lossQty) * 100).toFixed(2)}%`;
}

/** 계획의 공정 순서 (라우팅): 슬래브 = 제선 → 제강 → 연주, 코일 = + 열연 */
export const planProcesses = (itemType: ProductItemType): ProcessType[] =>
  itemType === 'COIL' ? ['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING', 'HOT_ROLLING'] : ['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING'];

export interface StepProgressInput {
  itemType: ProductItemType;
  productionPlanStatus: ProductionPlanStatus;
  heatCount: number;
  heatsMadeQty: number;
  heatsCastQty: number;
  coilQty: number;
  shortageQty: number;
  /** 공정별 실적 수 (완료 + 진행 중) */
  resultCount: Partial<Record<ProcessType, number>>;
  /** 공정별 진행 중(완료 일시 없음) 실적 수 */
  openCount: Partial<Record<ProcessType, number>>;
}

function stateOf(done: boolean, started: boolean): StepState {
  if (done) return 'done';
  return started ? 'run' : 'todo';
}

/** 히트 편성 → 제선 → 제강 → 연주 → [열연] 진행 표시 (분모를 함께 보인다, 4.5) */
export function processStepItems(input: StepProgressInput): StepItem[] {
  const allHeatsMade = input.heatsMadeQty >= input.heatCount;
  const allHeatsCast = input.heatsCastQty >= input.heatCount;
  const count = (p: ProcessType) => input.resultCount[p] ?? 0;
  const open = (p: ProcessType) => (input.openCount[p] ?? 0) > 0;
  const items: StepItem[] = [
    { key: 'formation', label: `히트 편성 · ${input.heatCount}히트`, state: input.productionPlanStatus === 'CANCELLED' ? 'todo' : 'done' },
    {
      key: 'IRONMAKING',
      label: `${PROCESS_TYPE_LABEL.IRONMAKING} ${count('IRONMAKING')}건`,
      state: stateOf(allHeatsMade && !open('IRONMAKING'), count('IRONMAKING') > 0),
    },
    {
      key: 'STEELMAKING',
      label: `${PROCESS_TYPE_LABEL.STEELMAKING} ${input.heatsMadeQty}/${input.heatCount}`,
      state: stateOf(allHeatsMade && !open('STEELMAKING'), input.heatsMadeQty > 0 || open('STEELMAKING')),
    },
    {
      key: 'CONTINUOUS_CASTING',
      label: `${PROCESS_TYPE_LABEL.CONTINUOUS_CASTING} ${input.heatsCastQty}/${input.heatCount}`,
      state: stateOf(allHeatsCast && !open('CONTINUOUS_CASTING'), input.heatsCastQty > 0 || open('CONTINUOUS_CASTING')),
    },
  ];
  if (input.itemType === 'COIL') {
    items.push({
      key: 'HOT_ROLLING',
      label: `${PROCESS_TYPE_LABEL.HOT_ROLLING} ${input.coilQty}/${input.shortageQty}`,
      state: stateOf(input.coilQty >= input.shortageQty && input.shortageQty > 0, input.coilQty > 0 || open('HOT_ROLLING')),
    });
  }
  return items;
}

/** 실적 목록 → 공정별 실적 수·진행 중 수 */
export function countResultsByProcess(results: readonly { processType: string; completedAt: string | null }[]): {
  resultCount: Partial<Record<ProcessType, number>>;
  openCount: Partial<Record<ProcessType, number>>;
} {
  const resultCount: Partial<Record<ProcessType, number>> = {};
  const openCount: Partial<Record<ProcessType, number>> = {};
  for (const r of results) {
    const p = r.processType as ProcessType;
    resultCount[p] = (resultCount[p] ?? 0) + 1;
    if (r.completedAt === null) openCount[p] = (openCount[p] ?? 0) + 1;
  }
  return { resultCount, openCount };
}

/** 납기가 지났는지 (완료·취소된 계획은 표시하지 않는다) */
export const isOverdue = (dLabelText: string, status: ProductionPlanStatus): boolean =>
  dLabelText.startsWith('D+') && status !== 'COMPLETED' && status !== 'CANCELLED';
