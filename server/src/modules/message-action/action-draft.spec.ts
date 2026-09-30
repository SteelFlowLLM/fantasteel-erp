// @nestjs/common·websockets는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (purchasing/testing/nest-common.shim.ts)
jest.mock('@nestjs/common', () => require('../purchasing/testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.gateway', () => ({ employeeChannel: (id: number) => `employee:${id}`, RealtimeGateway: class {} }));

import type { AuthUser } from '@fantasteel/shared';
import {
  closeTestContext, createDepartment, createEmployee, createMessage, createRawMaterial, createTestContext, kstDate, setHead, type TestContext,
} from '../purchasing/testing/test-context';

/**
 * Message → ERP 구매요청 (REQ-ACT-001~004, BP-ACT-01, 의사코드 13.4). AI 추출 없이 요청자가 값을 직접 입력한다.
 * 메신저 모듈 없이 채팅방·메시지는 Prisma로 직접 만든다.
 */
describe('Action Draft (Message → ERP)', () => {
  let ctx: TestContext;
  let department: { id: number };
  let head: AuthUser;
  let author: AuthUser;
  let colleague: AuthUser;
  let outsider: AuthUser;
  let salesMember: AuthUser;
  let rawMaterialId: number;

  const TYPE = 'PURCHASE_REQUISITION_CREATE' as const;
  const expectCode = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });
  const filled = () => ({ rawMaterialId, requiredTon: '120.5', desiredReceiptDate: kstDate(7), requestReason: '다음 주 제선 투입분' });
  const requisitionsOf = (draftId: number) => ctx.prisma.purchaseRequisition.findMany({ where: { sourceDraftId: draftId } });

  beforeAll(async () => {
    ctx = await createTestContext();
    department = await createDepartment(ctx);
    head = await createEmployee(ctx, department.id);
    author = await createEmployee(ctx, department.id, 'PRODUCTION');
    colleague = await createEmployee(ctx, department.id);
    outsider = await createEmployee(ctx, department.id);
    salesMember = await createEmployee(ctx, department.id, 'SALES');
    await setHead(ctx, department.id, head.employeeId);
    rawMaterialId = (await createRawMaterial(ctx)).id;
  });

  afterAll(async () => {
    await closeTestContext(ctx);
  });

  async function newDraft(by: AuthUser = author) {
    const message = await createMessage(ctx, author.employeeId, [colleague.employeeId, salesMember.employeeId], '철광석 120.5톤 다음 주까지 필요합니다');
    return { message, draft: await ctx.actionDrafts.createFromMessage(message.id, TYPE, by) };
  }

  it('다른 멤버가 만들어도 요청자는 메시지 작성자이고, 값이 빈 확인 대기 초안이 원본 메시지와 연결된다', async () => {
    const { message, draft } = await newDraft(colleague);
    expect(draft.draftStatus).toBe('WAITING_APPROVAL');
    expect(draft.requester.id).toBe(author.employeeId);
    expect(draft.payload).toEqual({ rawMaterialId: null, requiredTon: null, desiredReceiptDate: null, requesterId: author.employeeId, requestReason: null });
    expect(draft.unresolvedFields).toEqual(['rawMaterialId', 'requiredTon', 'desiredReceiptDate']);
    expect(draft.confirmer).toBe('REQUESTER');
    expect(draft.message).toMatchObject({ id: message.id, content: message.content, sender: { id: author.employeeId } });
    expect(draft.message?.chatRoom.id).toBe(message.chatRoomId);

    const event = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { eventType: 'ACTION_DRAFT_CREATED', actionDraftId: draft.id } });
    expect(event).toMatchObject({ messageId: message.id, actorEmployeeId: colleague.employeeId, targetType: 'ACTION_DRAFT', isAiAssisted: false });
    const notice = await ctx.prisma.notification.findFirst({ where: { recipientId: author.employeeId, linkPath: `/action-drafts/${draft.id}` } });
    expect(notice).not.toBeNull();
  });

  it('작성자가 직접 만들면 자기에게 알림을 보내지 않는다', async () => {
    const { draft } = await newDraft(author);
    expect(await ctx.prisma.notification.count({ where: { linkPath: `/action-drafts/${draft.id}` } })).toBe(0);
  });

  it('채팅방 멤버가 아니거나 구매요청 등록 권한이 없으면 만들 수 없다', async () => {
    const message = await createMessage(ctx, author.employeeId, [colleague.employeeId, salesMember.employeeId], '석탄 50톤');
    await expectCode(ctx.actionDrafts.createFromMessage(message.id, TYPE, outsider), 'COM-002');
    await expectCode(ctx.actionDrafts.createFromMessage(message.id, TYPE, salesMember), 'COM-002');
    await expectCode(ctx.actionDrafts.createFromMessage(999_999_999, TYPE, author), 'COM-004');
    const system = await ctx.prisma.message.create({ data: { chatRoomId: message.chatRoomId, senderId: null, messageType: 'SYSTEM', content: '입장' } });
    await expectCode(ctx.actionDrafts.createFromMessage(system.id, TYPE, author), 'COM-003');
    expect(await ctx.prisma.actionDraft.count({ where: { messageId: { in: [message.id, system.id] } } })).toBe(0);
  });

  it('같은 메시지에 미처리 초안이 있으면 새로 만들지 않고 그것을 돌려준다', async () => {
    const { message, draft } = await newDraft();
    const again = await ctx.actionDrafts.createFromMessage(message.id, TYPE, colleague);
    expect(again.id).toBe(draft.id);
    expect(await ctx.prisma.actionDraft.count({ where: { messageId: message.id } })).toBe(1);
    expect(await ctx.prisma.businessEvent.count({ where: { eventType: 'ACTION_DRAFT_CREATED', messageId: message.id } })).toBe(1);

    // 반려로 끝난 뒤에는 새 초안을 만들 수 있다
    await ctx.actionDrafts.reject(draft.id, '잘못 눌렀음', author);
    const fresh = await ctx.actionDrafts.createFromMessage(message.id, TYPE, author);
    expect(fresh.id).not.toBe(draft.id);
  });

  it('요청자만 값을 고칠 수 있고, 없는 원료·0 이하 수량·지난 날짜는 거부한다', async () => {
    const { draft } = await newDraft();
    await expectCode(ctx.actionDrafts.update(draft.id, filled(), colleague), 'COM-002');
    await expectCode(ctx.actionDrafts.update(draft.id, { rawMaterialId: 999_999_999 }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { requiredTon: '0' }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { requiredTon: '-3' }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { requiredTon: '1.2345' }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { desiredReceiptDate: kstDate(-1) }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { desiredReceiptDate: '2026-02-30' }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { requesterId: colleague.employeeId }, author), 'COM-003');
    await expectCode(ctx.actionDrafts.update(draft.id, { supplierId: 1 }, author), 'COM-003');

    // 일부만 채우면 나머지가 미확정으로 남는다
    const partial = await ctx.actionDrafts.update(draft.id, { rawMaterialId, requiredTon: 120.5 }, author);
    expect(partial.payload).toMatchObject({ rawMaterialId, requiredTon: '120.500', desiredReceiptDate: null, requesterId: author.employeeId });
    expect(partial.unresolvedFields).toEqual(['desiredReceiptDate']);
    expect(partial.draftStatus).toBe('WAITING_APPROVAL');
  });

  it('필수값이 비어 있으면 확정할 수 없다 (ACT-001, 미확정 필드 안내)', async () => {
    const { draft } = await newDraft();
    await ctx.actionDrafts.update(draft.id, { rawMaterialId }, author);
    const error = await ctx.actionDrafts.confirm(draft.id, author).catch((e: unknown) => e as { code: string; message: string });
    expect(error).toMatchObject({ code: 'ACT-001' });
    expect((error as { message: string }).message).toContain('requiredTon');
    expect((error as { message: string }).message).toContain('desiredReceiptDate');
    expect((error as { message: string }).message).not.toContain('rawMaterialId');
    const row = await ctx.prisma.actionDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.draftStatus).toBe('WAITING_APPROVAL');
    expect(await requisitionsOf(draft.id)).toHaveLength(0);
  });

  it('요청자가 확정하면 구매요청이 승인 대기로 생기고, 부서장이 따로 승인한다', async () => {
    const { message, draft } = await newDraft(colleague);
    await ctx.actionDrafts.update(draft.id, filled(), author);
    // 요청자가 아니면 확정할 수 없다
    await expectCode(ctx.actionDrafts.confirm(draft.id, colleague), 'COM-002');

    const executed = await ctx.actionDrafts.confirm(draft.id, author);
    expect(executed.draftStatus).toBe('EXECUTED');
    expect(executed.confirmedAt).not.toBeNull();
    expect(executed.executedAt).not.toBeNull();
    const [requisition] = await requisitionsOf(draft.id);
    expect(executed.executionResult).toEqual({ purchaseRequisitionId: requisition.id, purchaseRequisitionNo: requisition.purchaseRequisitionNo, attemptCount: 1 });
    expect(executed.purchaseRequisition).toMatchObject({ id: requisition.id, purchaseRequisitionStatus: 'WAITING_APPROVAL' });
    expect(requisition).toMatchObject({
      purchaseRequisitionStatus: 'WAITING_APPROVAL', sourceType: 'MESSAGE', requesterId: author.employeeId, approverId: head.employeeId, departmentId: department.id,
      requestReason: '다음 주 제선 투입분',
    });

    const detail = await ctx.requisitions.detail(requisition.id, author);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].requiredTon.toFixed(3)).toBe('120.500');
    expect(detail.desiredReceiptDate?.toISOString().slice(0, 10)).toBe(kstDate(7));
    expect(detail.sourceDraft).toMatchObject({ id: draft.id, draftStatus: 'EXECUTED', message: { id: message.id, content: message.content, sender: { id: author.employeeId } } });

    const events = await ctx.prisma.businessEvent.findMany({ where: { actionDraftId: draft.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.eventType)).toEqual(['ACTION_DRAFT_CREATED', 'ACTION_DRAFT_APPROVED', 'PURCHASE_REQUISITION_CONFIRMED', 'ACTION_DRAFT_EXECUTED']);
    expect(events.every((e) => e.messageId === message.id)).toBe(true);
    // 일반 제출과 같은 승인 요청 알림이 부서장에게 간다
    expect(await ctx.prisma.notification.count({ where: { recipientId: head.employeeId, notificationType: 'APPROVAL_REQUEST', linkPath: `/purchase-requisitions/${requisition.id}` } })).toBe(1);

    // 초안 확정(요청자)과 구매요청 승인(부서장)은 별개다
    await expectCode(ctx.requisitions.approve(requisition.id, author), 'COM-002');
    const approved = await ctx.requisitions.approve(requisition.id, head);
    expect(approved.purchaseRequisitionStatus).toBe('APPROVED');

    // 실행이 끝난 초안은 고치거나 반려할 수 없다
    await expectCode(ctx.actionDrafts.update(draft.id, { requiredTon: '1' }, author), 'COM-005');
    await expectCode(ctx.actionDrafts.reject(draft.id, '늦은 반려', author), 'COM-005');
  });

  it('확정을 여러 번(연달아·동시에) 눌러도 구매요청은 1건만 생긴다', async () => {
    const { draft } = await newDraft();
    await ctx.actionDrafts.update(draft.id, filled(), author);
    const results = await Promise.all([ctx.actionDrafts.confirm(draft.id, author), ctx.actionDrafts.confirm(draft.id, author), ctx.actionDrafts.confirm(draft.id, author)]);
    expect(results.map((r) => r.draftStatus)).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED']);
    const later = await ctx.actionDrafts.confirm(draft.id, author);
    expect(later.draftStatus).toBe('EXECUTED');
    expect(await requisitionsOf(draft.id)).toHaveLength(1);
    expect(await ctx.prisma.businessEvent.count({ where: { actionDraftId: draft.id, eventType: 'ACTION_DRAFT_APPROVED' } })).toBe(1);
    expect(await ctx.prisma.businessEvent.count({ where: { actionDraftId: draft.id, eventType: 'ACTION_DRAFT_EXECUTED' } })).toBe(1);
  });

  it('반려하면 REJECTED로 끝나고 구매요청은 생기지 않는다', async () => {
    const { message, draft } = await newDraft();
    await ctx.actionDrafts.update(draft.id, filled(), author);
    await expectCode(ctx.actionDrafts.reject(draft.id, '필요 없음', colleague), 'COM-002');
    await expectCode(ctx.actionDrafts.reject(draft.id, '  ', author), 'COM-003');

    const rejected = await ctx.actionDrafts.reject(draft.id, '이미 발주한 물량', author);
    expect(rejected).toMatchObject({ draftStatus: 'REJECTED', rejectReason: '이미 발주한 물량' });
    expect(rejected.rejectedAt).not.toBeNull();
    const event = await ctx.prisma.businessEvent.findFirstOrThrow({ where: { eventType: 'ACTION_DRAFT_REJECTED', actionDraftId: draft.id } });
    expect(event).toMatchObject({ messageId: message.id, reason: '이미 발주한 물량' });
    await expectCode(ctx.actionDrafts.confirm(draft.id, author), 'COM-005');
    expect(await requisitionsOf(draft.id)).toHaveLength(0);
  });

  it('실행 핸들러가 실패하면 확정(APPROVED)은 남기고 에러 코드·시도 횟수만 기록한다. 다시 확정하면 실행만 재시도한다', async () => {
    // 부서장이 없는 부서의 요청자 → 구매요청 제출 단계에서 PUR-001
    const orphanDepartment = await createDepartment(ctx);
    const orphan = await createEmployee(ctx, orphanDepartment.id);
    const message = await createMessage(ctx, orphan.employeeId, [], '석회석 10톤');
    const draft = await ctx.actionDrafts.createFromMessage(message.id, TYPE, orphan);
    await ctx.actionDrafts.update(draft.id, filled(), orphan);

    await expectCode(ctx.actionDrafts.confirm(draft.id, orphan), 'PUR-001');
    const failed = await ctx.actionDrafts.detail(draft.id, orphan);
    expect(failed.draftStatus).toBe('APPROVED');
    expect(failed.confirmedAt).not.toBeNull();
    expect(failed.executionResult).toMatchObject({ errorCode: 'PUR-001', attemptCount: 1 });
    expect(await requisitionsOf(draft.id)).toHaveLength(0);

    await expectCode(ctx.actionDrafts.confirm(draft.id, orphan), 'PUR-001');
    expect((await ctx.actionDrafts.detail(draft.id, orphan)).executionResult).toMatchObject({ errorCode: 'PUR-001', attemptCount: 2 });

    // 부서장을 지정한 뒤 다시 확정하면 실행만 다시 한다 (확정 이력은 1건 그대로)
    await setHead(ctx, orphanDepartment.id, head.employeeId);
    const executed = await ctx.actionDrafts.confirm(draft.id, orphan);
    expect(executed.draftStatus).toBe('EXECUTED');
    expect(executed.executionResult).toMatchObject({ attemptCount: 3 });
    expect(await requisitionsOf(draft.id)).toHaveLength(1);
    expect(await ctx.prisma.businessEvent.count({ where: { actionDraftId: draft.id, eventType: 'ACTION_DRAFT_APPROVED' } })).toBe(1);
  });

  it('목록은 내가 요청자이거나 원본 메시지 방의 멤버인 초안만 보여 준다', async () => {
    const { draft } = await newDraft(colleague);
    const ids = async (user: AuthUser, mine?: boolean) => (await ctx.actionDrafts.list({ mine, status: 'WAITING_APPROVAL' }, user)).map((d) => d.id);
    expect(await ids(author, true)).toContain(draft.id);
    expect(await ids(colleague)).toContain(draft.id);
    expect(await ids(colleague, true)).not.toContain(draft.id);
    expect(await ids(outsider)).not.toContain(draft.id);
    await expectCode(ctx.actionDrafts.detail(draft.id, outsider), 'COM-002');
  });
});
