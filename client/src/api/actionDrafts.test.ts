import { describe, expect, it } from 'vitest';
import { actionDraftApi, ACTION_TYPE_CATALOG } from '@/api/actionDrafts';
import { InputError } from '@/api/client';
import { messengerApi } from '@/api/messenger';
import { executionFailureOf } from '@/features/actionDrafts/lib/draftDisplay';
import { getMockDb } from '@/mock/db';
import { updateRow } from '@/mock/store';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const DEMO_TEXT = '실리코망가니즈 20톤 10월 20일까지 필요합니다';

/** 거래 시드 업무방(SO-2609-003 다온건설)의 구매 담당 메시지 */
function demoMessage() {
  const message = getMockDb().read((t) => t.message.find((m) => m.content === DEMO_TEXT));
  if (!message) throw new Error('시드 메시지가 없어요');
  return message;
}

const itemIdOf = (itemCode: string) => {
  const item = getMockDb().read((t) => t.item.find((i) => i.itemCode === itemCode));
  if (!item) throw new Error(`품목이 없어요: ${itemCode}`);
  return item.id;
};

const eventsOf = (actionDraftId: number) => getMockDb().read((t) => t.businessEvent.filter((e) => e.actionDraftId === actionDraftId));

async function demoDraft() {
  actAs(SEED_EMPLOYEE_NO.purchase);
  const { id } = await actionDraftApi.createFromMessage({ messageId: demoMessage().id });
  return actionDraftApi.get(id);
}

async function fillDemoDraft(id: number) {
  return actionDraftApi.update({ actionDraftId: id, payload: { itemId: itemIdOf('SMN01'), requiredTon: '20', desiredReceiptDate: '2026-10-20' } });
}

describe('Message → ERP 초안 만들기 (REQ-ACT-001)', () => {
  it('메시지에서 만들면 요청자 = 메시지 작성자, 확인 대기, 원본 메시지 연결, 같은 메시지는 그 초안을 다시 연다', async () => {
    const message = demoMessage();
    const purchaseId = actAs(SEED_EMPLOYEE_NO.purchase);
    const first = await actionDraftApi.createFromMessage({ messageId: message.id });
    expect(first.created).toBe(true);
    const again = await actionDraftApi.createFromMessage({ messageId: message.id });
    expect(again).toEqual({ id: first.id, created: false });

    const draft = await actionDraftApi.get(first.id);
    expect(draft).toMatchObject({
      actionType: 'PURCHASE_REQUISITION_CREATE',
      actionTypeLabel: '구매요청 생성',
      draftStatus: 'WAITING_APPROVAL',
      requesterId: purchaseId,
      isRequester: true,
      chatRoomLabel: 'SO-2609-003 다온건설',
      purchaseRequisition: null,
    });
    expect(draft.requester).toMatchObject({ employeeName: '정다은', departmentName: '구매부' });
    expect(draft.message?.content).toBe(DEMO_TEXT);
    expect(draft.unresolvedFields).toEqual(['원료 품목', '수량(톤)', '희망 입고일']);

    const created = eventsOf(first.id);
    expect(created.map((e) => e.businessEventType)).toEqual(['DRAFT_CREATED']);
    expect(created[0]).toMatchObject({ messageId: message.id, actorEmployeeId: purchaseId });

    expect((await actionDraftApi.listMine()).map((d) => d.id)).toEqual([first.id]);
    expect(await actionDraftApi.listOfRoom(message.chatRoomId)).toEqual([{ id: first.id, messageId: message.id, draftStatus: 'WAITING_APPROVAL' }]);
  });

  it('다른 멤버가 만들어도 요청자는 메시지 작성자다 (생산 부서장은 조회만 — 만들기 COM-002)', async () => {
    const message = demoMessage();
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(actionDraftApi.createFromMessage({ messageId: message.id })).rejects.toMatchObject({ code: 'COM-002' });
    const { id } = await demoDraft();
    actAs(SEED_EMPLOYEE_NO.productionHead);
    const seenByOther = await actionDraftApi.get(id);
    expect(seenByOther.isRequester).toBe(false);
    expect(await actionDraftApi.listMine()).toEqual([]);
  });

  it('권한·방 멤버 확인: 구매요청 조회 권한이 없으면 COM-002, 방 멤버가 아니면 COM-002', async () => {
    const message = demoMessage();
    const { id } = await demoDraft();
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(actionDraftApi.get(id)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(actionDraftApi.listMine()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(actionDraftApi.createFromMessage({ messageId: message.id })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.purchaseHead); // 구매 사용 권한은 있지만 업무방 멤버가 아니다
    await expect(actionDraftApi.createFromMessage({ messageId: message.id })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(actionDraftApi.listOfRoom(message.chatRoomId)).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('없는 초안·메시지는 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    await expect(actionDraftApi.get(99999)).rejects.toMatchObject({ code: 'COM-003' });
    await expect(actionDraftApi.createFromMessage({ messageId: 99999 })).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('초안 확인·확정 (REQ-ACT-002·003, BP-ACT-01, 14.1 10단계)', () => {
  it('필수값이 비면 ACT-001 (칸 이름을 덧붙임), 형식이 틀리면 입력 오류', async () => {
    const draft = await demoDraft();
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toMatchObject({ code: 'ACT-001', detail: '원료 품목, 수량(톤), 희망 입고일' });

    const wrong = actionDraftApi.update({ actionDraftId: draft.id, payload: { requiredTon: '1.2345', desiredReceiptDate: '10월 20일' } });
    await expect(wrong).rejects.toBeInstanceOf(InputError);
    await expect(wrong).rejects.toMatchObject({ fieldErrors: { requiredTon: expect.any(String), desiredReceiptDate: expect.any(String) } });

    await actionDraftApi.update({ actionDraftId: draft.id, payload: { requiredTon: '20' } });
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toMatchObject({ code: 'ACT-001', detail: '원료 품목, 희망 입고일' });
    expect((await actionDraftApi.get(draft.id)).draftStatus).toBe('WAITING_APPROVAL');
  });

  it('요청자만 고치고 확정한다 (다른 사원 COM-002), 연 뒤 바뀌었으면 COM-001', async () => {
    const draft = await demoDraft();
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    await expect(fillDemoDraft(draft.id)).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.productionHead); // 조회만
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.purchase);
    await fillDemoDraft(draft.id);
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id, expectedUpdatedAt: draft.updatedAt })).rejects.toMatchObject({ code: 'COM-001' });
  });

  it('확정하면 등록부 핸들러가 구매요청(부서장 승인 대기)을 만들고 ERP 반영, 작업 로그·시스템 메시지·승인 요청 알림', async () => {
    const message = demoMessage();
    const draft = await demoDraft();
    const filled = await fillDemoDraft(draft.id);
    expect(filled.unresolvedFields).toEqual([]);
    expect(filled.itemName).toBe('실리코망가니즈');

    const result = await actionDraftApi.confirm({ actionDraftId: draft.id, expectedUpdatedAt: filled.updatedAt });
    expect(result.executed).toBe(true);
    expect(result.target?.targetNo).toMatch(/^PR-\d{4}-\d{4}$/);
    expect(result.draft).toMatchObject({ draftStatus: 'EXECUTED', purchaseRequisition: { purchaseRequisitionStatus: 'WAITING_APPROVAL' } });
    expect(result.draft.confirmedAt).not.toBeNull();
    expect(result.draft.executedAt).not.toBeNull();

    const pr = getMockDb().read((t) => t.purchaseRequisition.find((p) => p.actionDraftId === draft.id));
    expect(pr).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', requesterId: employeeIdOf(SEED_EMPLOYEE_NO.purchase), desiredReceiptDate: '2026-10-20' });

    const events = eventsOf(draft.id);
    expect(events.map((e) => e.businessEventType)).toEqual(['DRAFT_CREATED', 'DRAFT_CONFIRMED', 'PURCHASE_REQUISITION_CREATED', 'DRAFT_EXECUTED']);
    expect(events.find((e) => e.businessEventType === 'DRAFT_CONFIRMED')?.reasonCode).toBe('DRAFT_CONFIRMED');
    expect(events.every((e) => e.messageId === message.id)).toBe(true);

    const notices = getMockDb().read((t) => t.notification.filter((n) => n.recipientId === employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead) && n.notificationType === 'APPROVAL_REQUESTED'));
    expect(notices.some((n) => n.linkPath === `/approvals?pr=${pr?.id}`)).toBe(true);

    const lastInRoom = getMockDb().read((t) => t.message.filter((m) => m.chatRoomId === message.chatRoomId).at(-1));
    expect(lastInRoom?.content).toContain(`초안 #${draft.id}`);

    // 중복 실행 방지: 이미 ERP 반영된 초안은 다시 실행·반려할 수 없다
    await expect(actionDraftApi.execute({ actionDraftId: draft.id })).rejects.toBeInstanceOf(InputError);
    await expect(actionDraftApi.reject({ actionDraftId: draft.id, rejectReason: '취소' })).rejects.toBeInstanceOf(InputError);
    expect(getMockDb().read((t) => t.purchaseRequisition.filter((p) => p.actionDraftId === draft.id))).toHaveLength(1);
    // 같은 메시지로 다시 만들면 그 초안을 연다 (새 구매요청이 생기지 않음)
    expect(await actionDraftApi.createFromMessage({ messageId: message.id })).toEqual({ id: draft.id, created: false });
  });

  it('구매요청을 만들지 못하면(부서장 없음 PUR-001) 확정 상태로 남고 결과를 기록, 원인을 고친 뒤 다시 실행', async () => {
    const draft = await demoDraft();
    const filled = await fillDemoDraft(draft.id);
    const departmentId = getMockDb().read((t) => t.employee.find((e) => e.id === draft.requesterId)?.departmentId ?? 0);
    const headId = getMockDb().read((t) => t.department.find((d) => d.id === departmentId)?.headEmployeeId ?? null);
    getMockDb().transact((tx) => updateRow(tx, 'department', departmentId, { headEmployeeId: null }));

    const failed = await actionDraftApi.confirm({ actionDraftId: draft.id, expectedUpdatedAt: filled.updatedAt });
    expect(failed).toMatchObject({ executed: false, errorCode: 'PUR-001', draft: { draftStatus: 'APPROVED', purchaseRequisition: null } });
    expect(executionFailureOf(failed.draft.executionResult)).toMatchObject({ attempts: 1, errorCode: 'PUR-001' });
    // 확정 뒤에는 값을 고치거나 반려할 수 없다
    await expect(fillDemoDraft(draft.id)).rejects.toBeInstanceOf(InputError);

    getMockDb().transact((tx) => updateRow(tx, 'department', departmentId, { headEmployeeId: headId }));
    const retried = await actionDraftApi.execute({ actionDraftId: draft.id });
    expect(retried.executed).toBe(true);
    expect(retried.draft.draftStatus).toBe('EXECUTED');
    expect(executionFailureOf(retried.draft.executionResult)).toBeNull();
  });

  it('반려: 사유 필수, REJECTED로 끝나고 같은 메시지에서 새 초안을 만들 수 있다', async () => {
    const purchaseId = actAs(SEED_EMPLOYEE_NO.purchase);
    const message = demoMessage();
    const sent = await messengerApi.sendMessage({ chatRoomId: message.chatRoomId, content: '석회석 30톤도 10월 말까지 필요해요' });
    const { id } = await actionDraftApi.createFromMessage({ messageId: sent.id });
    await expect(actionDraftApi.reject({ actionDraftId: id, rejectReason: '  ' })).rejects.toMatchObject({ fieldErrors: { rejectReason: expect.any(String) } });

    actAs(SEED_EMPLOYEE_NO.salesHead);
    await expect(actionDraftApi.reject({ actionDraftId: id, rejectReason: '중복' })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.purchase);
    const rejected = await actionDraftApi.reject({ actionDraftId: id, rejectReason: '이미 다른 요청으로 처리했어요' });
    expect(rejected).toMatchObject({ draftStatus: 'REJECTED', rejectReason: '이미 다른 요청으로 처리했어요', purchaseRequisition: null });
    expect(eventsOf(id).map((e) => e.businessEventType)).toEqual(['DRAFT_CREATED', 'DRAFT_REJECTED']);
    expect(eventsOf(id)[1]).toMatchObject({ actorEmployeeId: purchaseId, messageId: sent.id });
    await expect(actionDraftApi.confirm({ actionDraftId: id })).rejects.toBeInstanceOf(InputError);

    const again = await actionDraftApi.createFromMessage({ messageId: sent.id });
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(id);
  });
});

describe('초안 업무 유형 등록부 (REQ-ACT-004 · ACT-005 P2)', () => {
  it('구매요청 생성만 실행 핸들러가 있고 나머지는 준비 중(P2)', () => {
    const active = ACTION_TYPE_CATALOG.filter((entry) => entry.active);
    expect(active.map((entry) => entry.actionType)).toEqual(['PURCHASE_REQUISITION_CREATE']);
    expect(active[0].fieldLabels).toEqual(['원료 품목', '수량(톤)', '희망 입고일', '요청 근거']);
    expect(ACTION_TYPE_CATALOG.filter((entry) => !entry.active).every((entry) => entry.grade === 'P2')).toBe(true);
  });

  it('원료 품목 고르기는 원료만, 기본 공급업체와 함께', async () => {
    actAs(SEED_EMPLOYEE_NO.purchase);
    const materials = await actionDraftApi.listRawMaterials();
    expect(materials.length).toBeGreaterThan(0);
    expect(materials.find((m) => m.itemCode === 'SMN01')).toMatchObject({ itemName: '실리코망가니즈' });
    expect(materials.every((m) => m.itemCode !== 'SL-SS275-250x1200')).toBe(true);
  });
});
