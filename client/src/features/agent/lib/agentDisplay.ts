// Agent 대응 후보 화면의 표시 규칙 (순수 함수). 코드 값은 공통 코드 표시명으로만 보인다.
import type { AgentCandidateView, AgentRiskType, AgentScanView } from '@fantasteel/shared';
import { ACTION_TYPE, DRAFT_STATUS, PERMISSION, type ActionType, type DraftStatus, type Permission } from '@/codes';
import type { BadgeTone } from '@/components/Badge';

/** 위험 유형 표시명 */
export const RISK_NAME: Record<AgentRiskType, string> = {
  RAW_SHORTAGE: '원료 부족',
  GOOD_QTY_SHORTAGE: '합격 매수 부족',
  DUE_RISK: '납기 위험',
  AGED_SURPLUS: '여재 장기 보유',
  QUALITY_RATE_RISE: '불합격률 상승',
};

/** 후보(Action Draft)를 만드는 위험 유형. 납기 위험·불합격률 상승은 후보 없이 알림만 보낸다 */
export const CANDIDATE_RISKS: readonly AgentRiskType[] = ['RAW_SHORTAGE', 'GOOD_QTY_SHORTAGE', 'AGED_SURPLUS'];

/** 후보가 만드는 업무의 확정 권한 (요구사항 REQ-AGT-006). 서버가 다시 확인한다 */
export const CONFIRM_PERMISSION: Partial<Record<ActionType, Permission>> = {
  [ACTION_TYPE.PURCHASE_REQUISITION_CREATE]: PERMISSION.PURCHASE_REQUISITION_CREATE,
  [ACTION_TYPE.REPRODUCTION_PLAN_CREATE]: PERMISSION.PRODUCTION_PLAN_CONFIRM,
  [ACTION_TYPE.ALLOCATION_CONFIRM]: PERMISSION.SHIPMENT_REQUEST_MANAGE,
};

export const STATUS_TONE: Record<DraftStatus, BadgeTone> = {
  AI_GENERATED: 'ai',
  WAITING_APPROVAL: 'wait',
  APPROVED: 'run',
  EXECUTED: 'ok',
  REJECTED: 'danger',
};

/** 아직 처리하지 않은 후보 (확정 대기·확정했지만 실행 전) */
export const isOpenCandidate = (c: Pick<AgentCandidateView, 'draftStatus'>): boolean =>
  c.draftStatus === DRAFT_STATUS.AI_GENERATED || c.draftStatus === DRAFT_STATUS.WAITING_APPROVAL || c.draftStatus === DRAFT_STATUS.APPROVED;

/** 확정·반려할 수 있는 후보 (확정 전) */
export const isConfirmable = (c: Pick<AgentCandidateView, 'draftStatus'>): boolean => c.draftStatus === DRAFT_STATUS.AI_GENERATED || c.draftStatus === DRAFT_STATUS.WAITING_APPROVAL;

/** 열린 후보를 앞에, 그 안에서는 최근 것을 앞에 */
export function sortCandidates(list: readonly AgentCandidateView[]): AgentCandidateView[] {
  return [...list].sort((a, b) => Number(isOpenCandidate(b)) - Number(isOpenCandidate(a)) || b.id - a.id);
}

/** 근거 값의 항목 이름 (서버가 남긴 영문 키 → 한글) */
const EVIDENCE_LABEL: Record<string, string> = {
  productionPlanNo: '생산계획',
  itemCode: '품목',
  netRequirementTon: '부족량(t)',
  requiredDate: '필요일',
  salesOrderNo: '수주',
  lineNo: '품목 순번',
  orderedQty: '수주 매수',
  shippedQty: '출하 매수',
  activeReservedQty: '예약 매수',
  openPlanRemainingQty: '진행 계획 잔여 매수',
  additionalPlanQty: '추가 계획 필요 매수',
  reservationAvailableQty: '예약 가용 매수',
  agedSurplusQty: '오래된 여재 매수',
  waitingOrderCount: '대기 수주 수',
  oldestProducedDate: '가장 오래된 생산완료일',
};

export const evidenceLabelOf = (key: string): string => EVIDENCE_LABEL[key] ?? key;

export interface AgedRecommendation {
  salesOrderItemId: number;
  salesOrderNo: string;
  lineNo: number;
  dueDate: string;
  unsecuredQty: number;
}

/** 여재 추천 후보의 대기 수주 목록 (payload.recommendations) */
export function recommendationsOf(payload: Record<string, unknown>): AgedRecommendation[] {
  const raw = payload.recommendations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): AgedRecommendation[] => {
    if (typeof r !== 'object' || r === null) return [];
    const o = r as Record<string, unknown>;
    return typeof o.salesOrderItemId === 'number' && typeof o.salesOrderNo === 'string' && typeof o.lineNo === 'number' && typeof o.dueDate === 'string' && typeof o.unsecuredQty === 'number'
      ? [{ salesOrderItemId: o.salesOrderItemId, salesOrderNo: o.salesOrderNo, lineNo: o.lineNo, dueDate: o.dueDate, unsecuredQty: o.unsecuredQty }]
      : [];
  });
}

/** 알림만 보내는 위험 유형: 결과의 created는 만든 후보가 아니라 보낸 알림 수다 */
const ALERT_RISKS: readonly AgentRiskType[] = ['DUE_RISK', 'QUALITY_RATE_RISE'];

/** 지금 감지를 돌린 결과 한 줄: "원료 부족 후보 1건 · 납기 위험 알림 0건". 실패한 규칙은 이름과 함께 뒤에 붙인다 */
export function scanSummary(view: AgentScanView): string {
  const done = view.results
    .filter((r) => r.error === null)
    .map((r) => `${RISK_NAME[r.riskType]} ${ALERT_RISKS.includes(r.riskType) ? '알림' : '후보'} ${r.created}건`);
  const failed = view.results.filter((r) => r.error !== null).map((r) => RISK_NAME[r.riskType]);
  return [done.join(' · ') || '돌린 규칙이 없어요', failed.length ? `실패: ${failed.join('·')}` : null].filter(Boolean).join(' · ');
}

/** 알림만 보내는 위험 유형을 화면에 알리는 한 줄 (후보 목록에 없는 이유) */
export const ALERT_ONLY_NOTE = `${ALERT_RISKS.map((type) => RISK_NAME[type]).join('·')}은 대응 후보 없이 알림만 보내요`;

/**
 * 지금 감지를 돌린 결과 한 줄(목록 위에 남는다, 이슈 #532): 새로 만든 후보·보낸 알림 수.
 * 0건이면 이유를 함께 보인다: 같은 대상의 처리 전 후보가 이미 있으면 새로 만들지 않는다.
 */
export function scanOutcomeText(view: AgentScanView): string {
  const ok = view.results.filter((r) => r.error === null);
  const candidates = ok.filter((r) => !ALERT_RISKS.includes(r.riskType)).reduce((sum, r) => sum + r.created, 0);
  const alerts = ok.filter((r) => ALERT_RISKS.includes(r.riskType)).reduce((sum, r) => sum + r.created, 0);
  const failed = view.results.filter((r) => r.error !== null).length;
  const parts = [`새 후보 ${candidates}건`, `알림 ${alerts}건`];
  if (failed > 0) parts.push(`실패한 규칙 ${failed}개`);
  const none = candidates === 0 && alerts === 0 && failed === 0 ? ' · 같은 대상의 처리 전 후보가 이미 있거나 지금은 위험이 없어요' : '';
  return `${parts.join(' · ')}${none}`;
}

/** 이 일수 이상 확인하지 않은 후보는 오래됐다고 알린다 (가정값, 이슈 #532) */
export const STALE_CANDIDATE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 확정·반려를 기다린 지 며칠째인지 (만든 시각 기준, 내림) */
export function candidateWaitingDays(createdAt: string, now: Date): number {
  const created = new Date(createdAt).getTime();
  return Number.isNaN(created) ? 0 : Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
}

/** 오래 확인하지 않은 후보 표시 글. 확정 전이고 STALE_CANDIDATE_DAYS 이상 기다렸을 때만 */
export function staleCandidateLabel(c: Pick<AgentCandidateView, 'draftStatus' | 'createdAt'>, now: Date): string | null {
  if (!isConfirmable(c)) return null;
  const days = candidateWaitingDays(c.createdAt, now);
  return days >= STALE_CANDIDATE_DAYS ? `${days}일째 확인 대기` : null;
}
