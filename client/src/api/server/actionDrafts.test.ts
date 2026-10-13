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
  payload: { itemId: 41, requestedTon: '20.000', desiredReceiptDate: '2026-11-20', requestReason: null, sourceText: '실리코망가니즈 20톤 부탁해요' },
  itemCode: 'SMN01',
  itemName: '실리코망가니즈',
  itemDefaultSupplierName: '한빛합금',
  requesterId: 5,
  requesterName: '정다은',
  requesterDepartmentName: '구매부',
  requesterJobGradeName: '사원',
  message: { id: 900, chatRoomId: 70, chatRoomName: null, chatRoomType: 'DIRECT', senderName: '정다은', content: '실리코망가니즈 20톤 부탁해요', createdAt: '2026-10-13T00:00:00.000Z' },
  unresolvedFields: [],
  purchaseRequisition: null,
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

  it('수정은 보낸 칸만 서버 칸 이름(requestedTon)으로 보내고, 확정 결과는 만든 구매요청을 대상으로 보인다', async () => {
    const executed = view({ draftStatus: 'EXECUTED', executionAttemptCount: 1, purchaseRequisition: { id: 77, purchaseRequisitionNo: 'PR-2610-0009', purchaseRequisitionStatus: 'WAITING_APPROVAL' } });
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => {
      if (c.path === '/auth/me') return ok(me);
      if (c.method === 'PATCH' && c.path === '/action-drafts/31') return ok(view());
      if (c.path === '/action-drafts/31/confirm') return ok({ draft: executed, executed: true, errorCode: null, errorMessage: null });
      if (c.path === '/action-drafts') return ok([view()]);
      return undefined;
    });
    await actionDraftApi.update({ actionDraftId: 31, payload: { requestedTon: ' 20 ', desiredReceiptDate: '' }, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ requestedTon: '20', desiredReceiptDate: null, expectedUpdatedAt: '2026-10-13T00:05:00.000Z' });

    const result = await actionDraftApi.confirm({ actionDraftId: 31 });
    expect(result).toMatchObject({ executed: true, target: { targetType: 'purchase_requisition', targetId: 77, targetNo: 'PR-2610-0009' }, draft: { executedAt: executed.updatedAt } });

    expect(await actionDraftApi.listOfRoom(70)).toEqual([{ id: 31, messageId: 900, draftStatus: 'WAITING_APPROVAL' }]);
    expect(calls.find((c) => c.path === '/action-drafts')?.query).toEqual({ chatRoomId: '70' });
  });
});
