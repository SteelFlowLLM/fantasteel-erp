// 초안 화면 표시용 순수 함수 (상태 배지 색·흐름 단계·실행 결과 읽기·구매요청 입력 폼·업무 유형 등록부). 업무 규칙은 서버가 확인한다.
import {
  ACTION_TYPE_GRADE,
  ACTION_TYPE_LABEL,
  DRAFT_STATUS,
  DRAFT_STATUS_LABEL,
  PURCHASE_REQUISITION_STATUS_LABEL,
  type ActionType,
  type DraftStatus,
  type PurchaseRequisitionStatus,
} from '@/codes';
import type { BadgeTone } from '@/components/Badge';
import type { StepItem } from '@/components/Steps';
import { ACTION_TYPE_GUIDE, MESSAGE_ACTION_TYPES } from '@/features/actionDrafts/lib/typedDrafts';
import { withEulReul } from '@/lib/josa';
import { PURCHASE_REQUISITION_STATUS_TONE } from '@/lib/statusTone';

/** 초안 상태 배지 색 (옛 화면: 생성 ai · 확인 대기 wait · 확정 run · ERP 반영 ok · 반려 danger) */
export const DRAFT_STATUS_TONE: Record<DraftStatus, BadgeTone> = {
  AI_GENERATED: 'ai',
  WAITING_APPROVAL: 'wait',
  APPROVED: 'run',
  EXECUTED: 'ok',
  REJECTED: 'danger',
};

const isPurchaseRequisitionStatus = (value: string): value is PurchaseRequisitionStatus => value in PURCHASE_REQUISITION_STATUS_LABEL;

/** 만들어진 구매요청의 상태 표시 (표시명·색) */
export function getRequisitionStatusDisplay(status: string): { label: string; tone: BadgeTone } {
  return isPurchaseRequisitionStatus(status) ? { label: PURCHASE_REQUISITION_STATUS_LABEL[status], tone: PURCHASE_REQUISITION_STATUS_TONE[status] } : { label: status, tone: 'neutral' };
}

const FLOW: readonly DraftStatus[] = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL, DRAFT_STATUS.APPROVED, DRAFT_STATUS.EXECUTED];

/**
 * 초안 흐름 (REQ-ACT-003): 생성 → 확인 대기 → 확정 → ERP 반영, 반려하면 반려로 끝난다.
 * 지금 상태는 '진행 중', 앞 단계는 '완료'. ERP 반영은 끝 상태라 모두 '완료'.
 */
export function buildDraftFlowSteps(status: DraftStatus): StepItem[] {
  if (status === DRAFT_STATUS.REJECTED) {
    return [
      { key: DRAFT_STATUS.AI_GENERATED, label: DRAFT_STATUS_LABEL.AI_GENERATED, state: 'done' },
      { key: DRAFT_STATUS.WAITING_APPROVAL, label: DRAFT_STATUS_LABEL.WAITING_APPROVAL, state: 'done' },
      { key: DRAFT_STATUS.REJECTED, label: DRAFT_STATUS_LABEL.REJECTED, state: 'run' },
    ];
  }
  const current = FLOW.indexOf(status);
  return FLOW.map((step, index) => ({
    key: step,
    label: DRAFT_STATUS_LABEL[step],
    state: status === DRAFT_STATUS.EXECUTED || index < current ? 'done' : index === current ? 'run' : 'todo',
  }));
}

export interface DraftExecutionFailure {
  attempts: number;
  errorCode: string | null;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 확정 뒤 구매요청을 만들지 못했을 때 서버가 남긴 실행 결과 (attempts·errorCode·message). 성공했거나 없으면 null. */
export function getExecutionFailure(executionResult: unknown): DraftExecutionFailure | null {
  if (!isRecord(executionResult) || typeof executionResult.message !== 'string' || executionResult.targetId) return null;
  return {
    attempts: typeof executionResult.attempts === 'number' ? executionResult.attempts : 1,
    errorCode: typeof executionResult.errorCode === 'string' ? executionResult.errorCode : null,
    message: executionResult.message,
  };
}

/** 확정·실행이 막혔을 때 배너 제목 (ACT-001 · PUR-001 · 그 밖). typeLabel이 있으면 확장 유형(예: 수주 등록)의 실행 실패 */
export function getConfirmFailureTitle(code: string | null, typeLabel?: string): string {
  if (code === 'ACT-001') return '아직 확정할 수 없어요';
  if (code === 'PUR-001') return '승인권자가 없어 구매요청을 만들지 못했어요';
  return typeLabel ? `확정했지만 ${withEulReul(typeLabel)} 실행하지 못했어요` : '확정했지만 구매요청을 만들지 못했어요';
}

// ── 입력 폼 ──────────────────────────────────────────

export interface DraftForm {
  itemId: number | null;
  requestedTon: string;
  desiredReceiptDate: string;
  requestReason: string;
}

export interface DraftPayloadLike {
  itemId: number | null;
  requestedTon: string | null;
  desiredReceiptDate: string | null;
  requestReason: string | null;
}

/** 저장된 톤('20.000')은 입력칸에서 끝자리 0을 지워 보인다 ('20') */
export function formatTonInput(value: string | null): string {
  if (!value) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export const buildDraftForm = (payload: DraftPayloadLike): DraftForm => ({
  itemId: payload.itemId,
  requestedTon: formatTonInput(payload.requestedTon),
  desiredReceiptDate: payload.desiredReceiptDate ?? '',
  requestReason: payload.requestReason ?? '',
});

export const isSameDraftForm = (a: DraftForm, b: DraftForm): boolean =>
  a.itemId === b.itemId &&
  a.requestedTon.trim() === b.requestedTon.trim() &&
  a.desiredReceiptDate.trim() === b.desiredReceiptDate.trim() &&
  a.requestReason.trim() === b.requestReason.trim();

/** 저장할 값 (빈칸은 null = 미확정) */
export const buildDraftPayload = (form: DraftForm): DraftPayloadLike => ({
  itemId: form.itemId,
  requestedTon: form.requestedTon.trim() || null,
  desiredReceiptDate: form.desiredReceiptDate.trim() || null,
  requestReason: form.requestReason.trim() || null,
});

/** 폼 칸 이름 → 초안 필드 표시명 (core 등록부의 label과 같다) */
export const DRAFT_FIELD_LABEL = {
  itemId: '원료 품목',
  requestedTon: '수량(톤)',
  desiredReceiptDate: '희망 입고일',
  requestReason: '요청 근거',
} as const satisfies Record<keyof DraftForm, string>;

/** 이 칸이 저장된 값 기준으로 아직 미확정인지 (고치는 중인 칸은 빼고 본다) */
export function isFieldUnresolved(field: keyof DraftForm, unresolvedLabels: readonly string[], form: DraftForm, saved: DraftForm): boolean {
  if (!unresolvedLabels.includes(DRAFT_FIELD_LABEL[field])) return false;
  return field === 'itemId' ? form.itemId === saved.itemId : form[field].trim() === saved[field].trim();
}

/** 목록 칩: 상태별 개수 (전체 포함) */
export function countByDraftStatus(list: readonly { draftStatus: DraftStatus }[]): Record<DraftStatus | 'ALL', number> {
  const counts: Record<DraftStatus | 'ALL', number> = { ALL: list.length, AI_GENERATED: 0, WAITING_APPROVAL: 0, APPROVED: 0, EXECUTED: 0, REJECTED: 0 };
  for (const entry of list) counts[entry.draftStatus] += 1;
  return counts;
}

/** 업무 유형 등록부 표시 (REQ-ACT-004·005) */
export interface ActionTypeCatalogEntry {
  actionType: ActionType;
  label: string;
  grade: 'P1' | 'P2';
  /** 메시지에서 만들 수 있는 유형 (생산계획 생성은 수주 등록 때 자동이라 메시지에서 만들지 않는다, BP-ACT-02) */
  active: boolean;
  /** 추출 스키마 (TRM-095 · 업무 프로세스 12.3). 메시지에서 만들지 않는 유형은 빈 목록 */
  schemaFieldLabels: string[];
  /** 추출 스키마 밖의 선택 입력 (구매요청 요청 근거) */
  optionalInputLabels: string[];
}

/** 추출 스키마 밖의 선택 입력 */
const OPTIONAL_INPUT_LABELS: Partial<Record<ActionType, string[]>> = {
  PURCHASE_REQUISITION_CREATE: [DRAFT_FIELD_LABEL.requestReason],
};

export const ACTION_TYPE_CATALOG: readonly ActionTypeCatalogEntry[] = (Object.keys(ACTION_TYPE_LABEL) as ActionType[]).map((actionType) => {
  const guide = MESSAGE_ACTION_TYPES.includes(actionType) ? ACTION_TYPE_GUIDE[actionType] : undefined;
  return {
    actionType,
    label: ACTION_TYPE_LABEL[actionType],
    grade: ACTION_TYPE_GRADE[actionType],
    active: guide !== undefined,
    schemaFieldLabels: guide?.schemaFieldLabels ?? [],
    optionalInputLabels: OPTIONAL_INPUT_LABELS[actionType] ?? [],
  };
});
