// 확장 유형 초안(REQ-ACT-005, 업무 프로세스 12.3 유형 표) 화면용 순수 함수: 유형별 안내·권한, 입력 폼 ↔ 저장값, 미확정 칸, 만든 업무 링크.
// 칸 검증·이름 → id 맞추기·실행은 서버 유형 정의가 한다. 칸 표시명은 서버 미확정 칸 이름과 같다('고객사', '품목 1 매수' 등).
import { ACTION_TYPE, ACTION_TYPE_LABEL, PERMISSION, type ActionType, type Permission } from '@/codes';
import type { AiExtractionStatus } from '@fantasteel/shared';
import type {
  AllocationDraftPayload,
  DraftDetailView,
  DraftResultView,
  ExtendedDraftPatch,
  PurchaseRequisitionDraftPayload,
  ReproductionPlanDraftPayload,
  SalesOrderDraftPayload,
  ShipmentRequestDraftPayload,
} from '@/api/actionDrafts';
import { withEulReul } from '@/lib/josa';

export type ExtendedActionType = Exclude<ActionType, 'PURCHASE_REQUISITION_CREATE' | 'PRODUCTION_PLAN_CREATE'>;

export interface ActionTypeGuide {
  actionType: ActionType;
  label: string;
  /** 확정 주체가 가져야 할 사용(USE) 권한 (업무 프로세스 12.3) */
  permission: Permission;
  /** 메시지 메뉴 문구 */
  menuLabel: string;
  /** 확정 버튼 문구 */
  confirmLabel: string;
  /** 확정하면 생기는 일 (오른쪽 안내 카드) */
  confirmGuide: string;
  /** 추출 스키마 칸 표시명 (오른쪽 유형 카드) */
  schemaFieldLabels: string[];
}

/** 메시지에서 만들 수 있는 유형 (생산계획 생성은 메시지에서 만들지 않는다, BP-ACT-02) */
export const MESSAGE_ACTION_TYPES: readonly ActionType[] = [
  ACTION_TYPE.PURCHASE_REQUISITION_CREATE,
  ACTION_TYPE.SALES_ORDER_CREATE,
  ACTION_TYPE.SHIPMENT_REQUEST_CREATE,
  ACTION_TYPE.ALLOCATION_CONFIRM,
  ACTION_TYPE.REPRODUCTION_PLAN_CREATE,
];

export const ACTION_TYPE_GUIDE: Partial<Record<ActionType, ActionTypeGuide>> = {
  PURCHASE_REQUISITION_CREATE: {
    actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE,
    label: ACTION_TYPE_LABEL.PURCHASE_REQUISITION_CREATE,
    permission: PERMISSION.PURCHASE_REQUISITION_CREATE,
    menuLabel: '구매요청 초안 만들기',
    confirmLabel: '확정하고 구매요청 만들기',
    confirmGuide: '입력한 값으로 구매요청이 만들어지고 부서장 승인을 기다려요',
    // 요청자는 입력 칸이 아니라 메시지 작성자다 (BP-ACT-01)
    schemaFieldLabels: ['원료 품목', '수량(톤)', '희망 입고일', '요청자'],
  },
  SALES_ORDER_CREATE: {
    actionType: ACTION_TYPE.SALES_ORDER_CREATE,
    label: ACTION_TYPE_LABEL.SALES_ORDER_CREATE,
    permission: PERMISSION.SALES_ORDER_CREATE,
    menuLabel: '수주 등록 초안 만들기',
    confirmLabel: '확정하고 수주 등록',
    confirmGuide: '수주가 등록되고 합격 재고를 먼저 예약해요. 모자란 매수만 생산계획이 생겨요',
    schemaFieldLabels: ['고객사', '품목(규격·매수·납기)'],
  },
  SHIPMENT_REQUEST_CREATE: {
    actionType: ACTION_TYPE.SHIPMENT_REQUEST_CREATE,
    label: ACTION_TYPE_LABEL.SHIPMENT_REQUEST_CREATE,
    permission: PERMISSION.SHIPMENT_REQUEST_MANAGE,
    menuLabel: '출하요청 초안 만들기',
    confirmLabel: '확정하고 출하요청 만들기',
    confirmGuide: '배정 대기 출하요청이 생겨요. 같은 고객사의 수주 품목만 묶어요',
    schemaFieldLabels: ['고객사', '출하 예정일(선택)', '품목(수주 품목·매수)'],
  },
  ALLOCATION_CONFIRM: {
    actionType: ACTION_TYPE.ALLOCATION_CONFIRM,
    label: ACTION_TYPE_LABEL.ALLOCATION_CONFIRM,
    permission: PERMISSION.SHIPMENT_REQUEST_MANAGE,
    menuLabel: '배정 확정 초안 만들기',
    confirmLabel: '확정하고 배정',
    confirmGuide: '추천한 LOT이 출하요청 품목에 배정 확정돼요. 배정할 때 LOT을 다시 검사해요',
    schemaFieldLabels: ['출하요청 품목', '배정 LOT(시스템 추천)'],
  },
  REPRODUCTION_PLAN_CREATE: {
    actionType: ACTION_TYPE.REPRODUCTION_PLAN_CREATE,
    label: ACTION_TYPE_LABEL.REPRODUCTION_PLAN_CREATE,
    permission: PERMISSION.PRODUCTION_PLAN_CONFIRM,
    menuLabel: '재생산 계획 초안 만들기',
    confirmLabel: '확정하고 재생산 계획 만들기',
    confirmGuide: '여재를 먼저 예약하고 그래도 모자란 매수만 재생산 계획을 만들어요. 매수는 실행 때 다시 계산해요',
    schemaFieldLabels: ['수주 품목'],
  },
};

export const isExtendedActionType = (actionType: ActionType): actionType is ExtendedActionType =>
  actionType !== ACTION_TYPE.PURCHASE_REQUISITION_CREATE && actionType !== ACTION_TYPE.PRODUCTION_PLAN_CREATE;

/** 구매요청 초안이면 그 값, 아니면 null (화면이 유형별 카드를 고를 때) */
export const purchaseRequisitionPayloadOf = (draft: Pick<DraftDetailView, 'actionType' | 'payload'>): PurchaseRequisitionDraftPayload | null =>
  draft.actionType === ACTION_TYPE.PURCHASE_REQUISITION_CREATE ? (draft.payload as PurchaseRequisitionDraftPayload) : null;

// ── 입력 폼 ──────────────────────────────────────────
// 입력칸은 글로 받는다(빈칸 = 미확정). 저장할 때 서버 칸 모양으로 바꾼다.

export interface SalesOrderLineForm {
  itemId: number | null;
  orderedQty: string;
  dueDate: string;
}
export interface SalesOrderForm {
  actionType: 'SALES_ORDER_CREATE';
  customerId: number | null;
  items: SalesOrderLineForm[];
}
export interface ShipmentRequestLineForm {
  salesOrderItemId: number | null;
  requestQty: string;
}
export interface ShipmentRequestForm {
  actionType: 'SHIPMENT_REQUEST_CREATE';
  customerId: number | null;
  shipDate: string;
  items: ShipmentRequestLineForm[];
}
export interface AllocationForm {
  actionType: 'ALLOCATION_CONFIRM';
  shipmentRequestItemId: number | null;
}
export interface ReproductionPlanForm {
  actionType: 'REPRODUCTION_PLAN_CREATE';
  salesOrderItemId: number | null;
}
export type TypedDraftForm = SalesOrderForm | ShipmentRequestForm | AllocationForm | ReproductionPlanForm;

const qtyText = (qty: number | null) => (qty === null ? '' : String(qty));

export function buildTypedForm(actionType: ExtendedActionType, payload: DraftDetailView['payload']): TypedDraftForm {
  switch (actionType) {
    case 'SALES_ORDER_CREATE': {
      const p = payload as SalesOrderDraftPayload;
      return { actionType, customerId: p.customerId, items: p.items.map((l) => ({ itemId: l.itemId, orderedQty: qtyText(l.orderedQty), dueDate: l.dueDate ?? '' })) };
    }
    case 'SHIPMENT_REQUEST_CREATE': {
      const p = payload as ShipmentRequestDraftPayload;
      return { actionType, customerId: p.customerId, shipDate: p.shipDate ?? '', items: p.items.map((l) => ({ salesOrderItemId: l.salesOrderItemId, requestQty: qtyText(l.requestQty) })) };
    }
    case 'ALLOCATION_CONFIRM':
      return { actionType, shipmentRequestItemId: (payload as AllocationDraftPayload).shipmentRequestItemId };
    case 'REPRODUCTION_PLAN_CREATE':
      return { actionType, salesOrderItemId: (payload as ReproductionPlanDraftPayload).salesOrderItemId };
  }
}

/** 매수 입력: 숫자만이면 수로, 비면 null. 그 밖의 글은 그대로 보내 서버가 COM-004로 알린다 */
function qtyValue(text: string): number | string | null {
  const t = text.trim().replace(/,/g, '');
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : t;
}
const textValue = (text: string) => text.trim() || null;

/** 저장할 칸 (서버 칸 이름). 품목 줄은 통째로 보낸다 */
export function buildTypedPatch(form: TypedDraftForm): ExtendedDraftPatch {
  switch (form.actionType) {
    case 'SALES_ORDER_CREATE':
      return { customerId: form.customerId, items: form.items.map((l) => ({ itemId: l.itemId, orderedQty: qtyValue(l.orderedQty), dueDate: textValue(l.dueDate) })) };
    case 'SHIPMENT_REQUEST_CREATE':
      return { customerId: form.customerId, shipDate: textValue(form.shipDate), items: form.items.map((l) => ({ salesOrderItemId: l.salesOrderItemId, requestQty: qtyValue(l.requestQty) })) };
    case 'ALLOCATION_CONFIRM':
      return { shipmentRequestItemId: form.shipmentRequestItemId };
    case 'REPRODUCTION_PLAN_CREATE':
      return { salesOrderItemId: form.salesOrderItemId };
  }
}

export const isSameTypedForm = (a: TypedDraftForm, b: TypedDraftForm): boolean => JSON.stringify(buildTypedPatch(a)) === JSON.stringify(buildTypedPatch(b));

export const emptySalesOrderLine = (): SalesOrderLineForm => ({ itemId: null, orderedQty: '', dueDate: '' });
export const emptyShipmentLine = (): ShipmentRequestLineForm => ({ salesOrderItemId: null, requestQty: '' });

// ── 미확정 칸 ────────────────────────────────────────

/** 품목 줄 칸의 표시명 (서버 미확정 칸 이름과 같다). 예: lineFieldLabel(0, '매수') → '품목 1 매수' */
export const lineFieldLabel = (index: number, field: string) => `품목 ${index + 1} ${field}`;

/**
 * 이 칸이 저장된 값 기준으로 아직 미확정인지. 고치는 중인 칸(저장값과 다름)은 빼고 본다.
 * label은 서버 미확정 칸 이름, changed는 지금 입력이 저장값과 다른지
 */
export const isTypedFieldUnresolved = (unresolvedLabels: readonly string[], label: string, changed: boolean): boolean => !changed && unresolvedLabels.includes(label);

// ── 만든 업무 ────────────────────────────────────────

const RESULT_TABLE_LABEL: Record<string, string> = {
  purchase_requisition: '구매요청',
  sales_order: '수주',
  shipment_request: '출하요청',
  production_plan: '재생산 계획',
  sales_order_item: '수주 품목',
};

/** 만든 업무 이름 (예: 수주). 모르는 테이블이면 '업무' */
export const resultLabelOf = (result: Pick<DraftResultView, 'table'>): string => RESULT_TABLE_LABEL[result.table] ?? '업무';

/** 만든 업무 화면 주소. 화면이 없으면 null (여재 예약만으로 끝난 재생산은 수주 품목이라 링크가 없다) */
export function resultHrefOf(result: Pick<DraftResultView, 'table' | 'id'>): string | null {
  switch (result.table) {
    case 'purchase_requisition':
      return `/purchase-requisitions/${result.id}`;
    case 'sales_order':
      return `/sales-orders/${result.id}`;
    case 'shipment_request':
      return `/shipment-requests/${result.id}`;
    case 'production_plan':
      return `/production/plans?plan=${result.id}`;
    default:
      return null;
  }
}

// ── 메시지 메뉴 ──────────────────────────────────────

const OPEN_DRAFT_STATUSES: readonly string[] = ['AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED'];

/** 이 메시지·유형의 미처리 초안 (서버 부분 unique와 같은 상태). 있으면 메뉴는 새로 만들지 않고 그 초안을 연다 */
export const openDraftOf = <T extends { messageId: number; actionType: ActionType; draftStatus: string }>(drafts: readonly T[], messageId: number, actionType: ActionType): T | undefined =>
  drafts.find((d) => d.messageId === messageId && d.actionType === actionType && OPEN_DRAFT_STATUSES.includes(d.draftStatus));

/** 이 메시지·유형에서 이미 ERP에 반영된 초안. 있으면 같은 업무가 두 번 등록되지 않게 서버가 새 초안을 막으므로 메뉴는 그 초안을 연다 (#496) */
export const executedDraftOf = <T extends { messageId: number; actionType: ActionType; draftStatus: string }>(drafts: readonly T[], messageId: number, actionType: ActionType): T | undefined =>
  drafts.find((d) => d.messageId === messageId && d.actionType === actionType && d.draftStatus === 'EXECUTED');

/** 실행된 초안 때문에 새 초안을 만들 수 없는 이유 (메뉴 안내) */
export const executedDraftReason = (typeLabel: string): string => `이 메시지로 만든 ${typeLabel} 초안은 이미 ERP에 반영했어요. 같은 업무가 두 번 등록되지 않게 새 초안은 만들 수 없어요`;

/**
 * 초안 만들기 결과 안내. 다른 사원이 만든 미처리 초안이 이미 있으면 "○○님이 만든 초안이 이미 있어요" (모듈 문서 10장 같은 메시지·유형)
 */
export function draftCreatedNotice(result: { id: number; created: boolean; requesterId: number | null; requesterName: string | null }, myEmployeeId: number, typeLabel: string): string {
  if (result.created) return `${withEulReul(`${typeLabel} 초안 #${result.id}`)} 만들었어요. 값을 확인하고 확정해 주세요`;
  if (result.requesterId !== null && result.requesterId !== myEmployeeId) return `${result.requesterName ?? '다른 사원'}님이 만든 초안이 이미 있어요. ${withEulReul(`초안 #${result.id}`)} 열어요`;
  return `${withEulReul(`이미 만든 초안 #${result.id}`)} 열어요`;
}

// ── AI 추출 결과 (이슈 #472) ─────────────────────────

/** 빈 초안이 된 까닭. 칸을 채웠거나(FILLED) 예전 초안(없음)이면 null */
export function aiExtractionNotice(status: AiExtractionStatus | null | undefined): string | null {
  switch (status) {
    case 'TIMEOUT':
      return 'AI가 제한 시간 안에 답하지 않아 빈 초안으로 만들었어요. 메시지를 보면서 값을 입력해 주세요';
    case 'NO_MODEL':
      return 'AI 모델이 정해지지 않아 빈 초안으로 만들었어요(관리 > AI 연결). 값을 입력해 주세요';
    case 'FAILED':
      return 'AI 서버에 연결하지 못해 빈 초안으로 만들었어요. 값을 입력해 주세요';
    case 'NOT_JSON':
      return 'AI 답을 읽지 못해 빈 초안으로 만들었어요. 값을 입력해 주세요';
    case 'NOTHING_FOUND':
      return 'AI가 메시지에서 맞는 값을 찾지 못했어요. 값을 입력해 주세요';
    default:
      return null;
  }
}
