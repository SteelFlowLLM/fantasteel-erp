// Message → ERP 초안 서버 모드: 서버 응답을 화면 모양으로 바꾸고, 수정·확정·반려 요청을 서버 칸 이름으로 보낸다.
import type { ActionDraftView, AuthUser } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { actionDraftApi } from '@/api/actionDrafts';
import { ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const me: AuthUser = { employeeId: 5, employeeNo: '2207005', employeeName: '정다은', departmentId: 2, jobGradeId: 5, roleCode: 'PURCHASE', headDepartmentIds: [], permissions: { PURCHASE_REQUISITION_CREATE: 'USE' } };

const view = (overrides: Partial<ActionDraftView> = {}): ActionDraftView => ({
  id: 31,
  actionType: 'PURCHASE_REQUISITION_CREATE',
  draftStatus: 'WAITING_APPROVAL',
  payload: { itemId: 41, requestedTon: '20.000', desiredReceiptDate: '2026-11-20', requestReason: null, sourceText: '실리코망가니즈 20톤 부탁해요', aiFilledFields: [] },
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  itemDefaultSupplierName: '한빛합금',
  requesterId: 5,
  requesterName: '정다은',
  requesterDepartmentName: '구매부',
  requesterJobGradeName: '사원',
  message: { id: 900, chatRoomId: 70, chatRoomName: null, chatRoomType: 'DIRECT', senderName: '정다은', content: '실리코망가니즈 20톤 부탁해요', createdAt: '2026-10-13T00:00:00.000Z' },
  meetingMinutes: null,
  unresolvedFields: [],
  payloadLabels: { itemId: '실리코망가니즈 · SMN01' },
  result: null,
  executionErrorCode: null,
  executionAttemptCount: 0,
  rejectReason: null,
  confirmedAt: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:05:00.000Z',
  ...overrides,
});

describe('초안 서버 모드 (api/server/actionDrafts.ts)', () => {
  it('상세: 요청자·채팅방 이름·요청자 여부를 채우고, 실행 실패는 실패 코드·시도 횟수로 보인다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me);
      if (c.path === '/action-drafts/31') return ok(view({ draftStatus: 'APPROVED', executionErrorCode: 'PUR-001', executionAttemptCount: 2 }));
      return undefined;
    });
    const detail = await actionDraftApi.get(31);
    expect(detail).toMatchObject({
      actionTypeLabel: '구매요청 생성',
      requester: { id: 5, employeeName: '정다은', jobGradeName: '사원', departmentName: '구매부' },
      chatRoomLabel: '1:1 채팅방',
      isRequester: true,
      itemDefaultSupplierName: '한빛합금',
      payload: { requestedTon: '20.000' },
      executionResult: { attempts: 2, errorCode: 'PUR-001' },
      executedAt: null,
    });
  });

  it('수정은 보낸 칸만 서버 칸 이름(requestedTon)으로 payload에 담아 보내고, 확정 결과는 만든 구매요청을 대상으로 보인다', async () => {
    const executed = view({ draftStatus: 'EXECUTED', executionAttemptCount: 1, result: { table: 'purchase_requisition', id: 77, no: 'PR-2610-0009', status: 'WAITING_APPROVAL' } });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me);
      if (c.method === 'PATCH' && c.path === '/action-drafts/31') return ok(view());
      if (c.path === '/action-drafts/31/confirm') return ok({ draft: executed, executed: true, errorCode: null, errorMessage: null });
      if (c.path === '/action-drafts') return ok([view()]);
      return undefined;
    });
    await actionDraftApi.update({ actionDraftId: 31, payload: { requestedTon: ' 20 ', desiredReceiptDate: '' }, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ payload: { requestedTon: '20', desiredReceiptDate: null }, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });

    const result = await actionDraftApi.confirm({ actionDraftId: 31 });
    expect(result).toMatchObject({ executed: true, target: { targetType: 'purchase_requisition', targetId: 77, targetNo: 'PR-2610-0009' }, draft: { executedAt: executed.updatedAt } });

    expect(await actionDraftApi.listOfRoom(70)).toEqual([{ id: 31, messageId: 900, actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus: 'WAITING_APPROVAL', requesterId: 5, requesterName: '정다은' }]);
    expect(calls.find((c) => c.path === '/action-drafts')?.query).toEqual({ chatRoomId: '70' });
  });

  it('확장 유형: 만들 때 유형을 보내고, 칸은 서버 칸 이름 그대로 고치며, 확정 결과는 만든 업무(수주)를 대상으로 보인다', async () => {
    const salesDraft = view({
      id: 32,
      actionType: 'SALES_ORDER_CREATE',
      payload: { customerId: 1, items: [{ itemId: 11, orderedQty: 20, dueDate: '2026-11-06' }], sourceText: '가람중공업 20매', aiFilledFields: ['customerId', 'items'] },
      payloadLabels: { customerId: '가람중공업', 'items.0.itemId': 'SL-SS275-250x1200x10000 SS275 슬래브' },
    });
    const executed = { ...salesDraft, draftStatus: 'EXECUTED' as const, result: { table: 'sales_order', id: 8, no: 'SO-2610-008', status: null } };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me);
      if (c.path === '/messages/900/action-drafts') return ok({ id: 32, created: false, requesterId: 3, requesterName: '박서영' });
      if (c.method === 'PATCH' && c.path === '/action-drafts/32') return ok(salesDraft);
      if (c.path === '/action-drafts/32/confirm') return ok({ draft: executed, executed: true, errorCode: null, errorMessage: null });
      return undefined;
    });
    expect(await actionDraftApi.createFromMessage({ messageId: 900, actionType: 'SALES_ORDER_CREATE' })).toEqual({ id: 32, created: false, requesterId: 3, requesterName: '박서영' });
    expect(calls.find((c) => c.path === '/messages/900/action-drafts')?.body).toEqual({ actionType: 'SALES_ORDER_CREATE' });

    const fields = { customerId: 1, items: [{ itemId: 11, orderedQty: 20, dueDate: '2026-11-06' }] };
    const updated = await actionDraftApi.updateFields({ actionDraftId: 32, fields, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ payload: fields, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });
    expect(updated).toMatchObject({ actionTypeLabel: '수주 등록', payloadLabels: { customerId: '가람중공업' }, purchaseRequisition: null });

    const result = await actionDraftApi.confirm({ actionDraftId: 32 });
    expect(result).toMatchObject({ executed: true, target: { targetType: 'sales_order', targetId: 8, targetNo: 'SO-2610-008' }, draft: { result: { table: 'sales_order', no: 'SO-2610-008' } } });
  });
});
