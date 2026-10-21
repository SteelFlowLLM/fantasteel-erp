import { describe, expect, it } from 'vitest';
import type { DraftDetailView } from '@/api/actionDrafts';
import {
  ACTION_TYPE_GUIDE,
  MESSAGE_ACTION_TYPES,
  buildTypedForm,
  buildTypedPatch,
  draftCreatedNotice,
  isExtendedActionType,
  isSameTypedForm,
  isTypedFieldUnresolved,
  lineFieldLabel,
  executedDraftOf,
  executedDraftReason,
  openDraftOf,
  purchaseRequisitionPayloadOf,
  resultHrefOf,
  resultLabelOf,
  aiExtractionNotice,
} from '@/features/actionDrafts/lib/typedDrafts';

const base = { sourceText: '원본', aiFilledFields: [] };

describe('확장 유형 초안 화면 (REQ-ACT-005)', () => {
  it('메시지에서 만드는 유형은 생산계획 생성을 뺀 5종이고, 유형마다 확정 권한이 있다 (업무 프로세스 12.3)', () => {
    expect(MESSAGE_ACTION_TYPES).not.toContain('PRODUCTION_PLAN_CREATE');
    expect(MESSAGE_ACTION_TYPES.map((t) => ACTION_TYPE_GUIDE[t]?.permission)).toEqual([
      'PURCHASE_REQUISITION_CREATE',
      'SALES_ORDER_CREATE',
      'SHIPMENT_REQUEST_MANAGE',
      'SHIPMENT_REQUEST_MANAGE',
      'PRODUCTION_PLAN_CONFIRM',
    ]);
    expect(isExtendedActionType('PURCHASE_REQUISITION_CREATE')).toBe(false);
    expect(isExtendedActionType('ALLOCATION_CONFIRM')).toBe(true);
  });

  it('구매요청 초안만 구매요청 카드로 보낸다', () => {
    const pr = { actionType: 'PURCHASE_REQUISITION_CREATE', payload: { itemId: 1, requestedTon: null, desiredReceiptDate: null, requestReason: null, ...base } } as Pick<DraftDetailView, 'actionType' | 'payload'>;
    expect(purchaseRequisitionPayloadOf(pr)).toBe(pr.payload);
    expect(purchaseRequisitionPayloadOf({ actionType: 'SALES_ORDER_CREATE', payload: { customerId: null, items: [], ...base } })).toBeNull();
  });

  it('수주 등록: 저장값 → 입력 폼(매수는 글) → 저장할 칸. 숫자만 수로, 빈칸은 null, 그 밖의 글은 그대로 보내 서버가 알린다', () => {
    const form = buildTypedForm('SALES_ORDER_CREATE', { customerId: 1, items: [{ itemId: 11, orderedQty: 20, dueDate: '2026-11-06' }, { itemId: null, orderedQty: null, dueDate: null }], ...base });
    expect(form).toEqual({ actionType: 'SALES_ORDER_CREATE', customerId: 1, items: [{ itemId: 11, orderedQty: '20', dueDate: '2026-11-06' }, { itemId: null, orderedQty: '', dueDate: '' }] });
    if (form.actionType !== 'SALES_ORDER_CREATE') throw new Error();
    const edited = { ...form, items: [{ ...form.items[0], orderedQty: ' 1,200 ' }, { itemId: 12, orderedQty: '10.5', dueDate: ' ' }] };
    expect(buildTypedPatch(edited)).toEqual({ customerId: 1, items: [{ itemId: 11, orderedQty: 1200, dueDate: '2026-11-06' }, { itemId: 12, orderedQty: '10.5', dueDate: null }] });
    expect(isSameTypedForm(form, edited)).toBe(false);
    expect(isSameTypedForm(form, { ...form, items: [{ ...form.items[0], orderedQty: '20 ' }, form.items[1]] })).toBe(true);
  });

  it('출하요청·배정 확정·재생산: 저장할 칸은 서버 칸 이름 그대로', () => {
    const shipment = buildTypedForm('SHIPMENT_REQUEST_CREATE', { customerId: 2, shipDate: null, items: [{ salesOrderItemId: 5, requestQty: 4 }], ...base });
    expect(buildTypedPatch(shipment)).toEqual({ customerId: 2, shipDate: null, items: [{ salesOrderItemId: 5, requestQty: 4 }] });
    expect(buildTypedPatch(buildTypedForm('ALLOCATION_CONFIRM', { shipmentRequestItemId: 9, lotIds: [1, 2], ...base }))).toEqual({ shipmentRequestItemId: 9 });
    expect(buildTypedPatch(buildTypedForm('REPRODUCTION_PLAN_CREATE', { salesOrderItemId: 3, ...base }))).toEqual({ salesOrderItemId: 3 });
  });

  it('미확정 표시는 서버 칸 이름과 맞추고, 고치는 중인 칸은 뺀다', () => {
    const unresolved = ['고객사', lineFieldLabel(0, '매수')];
    expect(lineFieldLabel(0, '매수')).toBe('품목 1 매수');
    expect(isTypedFieldUnresolved(unresolved, '품목 1 매수', false)).toBe(true);
    expect(isTypedFieldUnresolved(unresolved, '품목 1 매수', true)).toBe(false);
    expect(isTypedFieldUnresolved(unresolved, '품목 1 규격', false)).toBe(false);
  });

  it('메시지 메뉴: 같은 메시지·유형의 미처리 초안만 연다 (반려된 초안이면 새로 만든다)', () => {
    const drafts = [
      { id: 1, messageId: 7, actionType: 'SALES_ORDER_CREATE' as const, draftStatus: 'EXECUTED' },
      { id: 2, messageId: 7, actionType: 'SALES_ORDER_CREATE' as const, draftStatus: 'WAITING_APPROVAL' },
      { id: 3, messageId: 7, actionType: 'SHIPMENT_REQUEST_CREATE' as const, draftStatus: 'REJECTED' },
    ];
    expect(openDraftOf(drafts, 7, 'SALES_ORDER_CREATE')?.id).toBe(2);
    expect(openDraftOf(drafts, 7, 'SHIPMENT_REQUEST_CREATE')).toBeUndefined();
    expect(openDraftOf(drafts, 8, 'SALES_ORDER_CREATE')).toBeUndefined();
  });

  it('메시지 메뉴: 실행된 초안이 있으면 새로 만들지 않고 그 초안과 이유를 보인다 (#496)', () => {
    const drafts = [
      { id: 1, messageId: 7, actionType: 'SALES_ORDER_CREATE' as const, draftStatus: 'EXECUTED' },
      { id: 3, messageId: 7, actionType: 'SHIPMENT_REQUEST_CREATE' as const, draftStatus: 'REJECTED' },
    ];
    expect(executedDraftOf(drafts, 7, 'SALES_ORDER_CREATE')?.id).toBe(1);
    expect(executedDraftOf(drafts, 7, 'SHIPMENT_REQUEST_CREATE')).toBeUndefined();
    expect(executedDraftReason('수주 등록')).toBe('이 메시지로 만든 수주 등록 초안은 이미 ERP에 반영했어요. 같은 업무가 두 번 등록되지 않게 새 초안은 만들 수 없어요');
  });

  it('만들기 결과 안내: 다른 사원이 만든 초안이면 그 이름을 알린다', () => {
    expect(draftCreatedNotice({ id: 12, created: true, requesterId: 3, requesterName: '박서영' }, 3, '수주 등록')).toBe('수주 등록 초안 #12를 만들었어요. 값을 확인하고 확정해 주세요');
    expect(draftCreatedNotice({ id: 12, created: false, requesterId: 3, requesterName: '박서영' }, 2, '수주 등록')).toBe('박서영님이 만든 초안이 이미 있어요. 초안 #12를 열어요');
    expect(draftCreatedNotice({ id: 12, created: false, requesterId: 3, requesterName: '박서영' }, 3, '수주 등록')).toBe('이미 만든 초안 #12를 열어요');
  });

  it('만든 업무 이름과 화면 주소 (여재 예약만으로 끝난 수주 품목은 링크 없음)', () => {
    expect(resultLabelOf({ table: 'sales_order' })).toBe('수주');
    expect(resultHrefOf({ table: 'sales_order', id: 8 })).toBe('/sales-orders/8');
    expect(resultHrefOf({ table: 'shipment_request', id: 3 })).toBe('/shipment-requests/3');
    expect(resultHrefOf({ table: 'production_plan', id: 4 })).toBe('/production/plans?plan=4');
    expect(resultHrefOf({ table: 'sales_order_item', id: 5 })).toBeNull();
  });

  it('빈 초안이 된 까닭: 시간 초과·모델 없음·연결 실패·형식 오류·값 없음을 알리고, 칸을 채웠거나 예전 초안이면 알리지 않는다 (이슈 #472)', () => {
    expect(aiExtractionNotice('TIMEOUT')).toContain('제한 시간');
    expect(aiExtractionNotice('NO_MODEL')).toContain('AI 연결');
    expect(aiExtractionNotice('FAILED')).toContain('연결하지 못해');
    expect(aiExtractionNotice('NOT_JSON')).toContain('읽지 못해');
    expect(aiExtractionNotice('NOTHING_FOUND')).toContain('찾지 못했어요');
    expect(aiExtractionNotice('FILLED')).toBeNull();
    expect(aiExtractionNotice(undefined)).toBeNull();
  });
});
