// Message → ERP 구매요청 초안 생성·조회·수정을 실제 DB(fs_pur)로 확인한다. 채팅방·메시지는 데이터로 직접 넣는다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageActionService } from './message-action.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: MessageActionService;
/** 구매 사원 정다은 (요청자) */
let purchaser: AuthUser;
/** 구매부장 최준혁 */
let purchaseHead: AuthUser;
/** 영업 사원 박서영 — 방 멤버 */
let salesStaff: AuthUser;
/** 물류 사원 권예진 — 방 멤버가 아니다 */
let logistics: AuthUser;
let roomId: number;
let oreId: number;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

const send = (sender: AuthUser, content: string) => prisma.message.create({ data: { chatRoomId: roomId, senderId: sender.employeeId, content } });

/** 정다은이 보낸 메시지와 그 메시지의 초안 */
async function draftOf(content: string, payload: Record<string, unknown>) {
  const message = await prisma.message.create({ data: { chatRoomId: roomId, senderId: purchaser.employeeId, content } });
  const draft = await prisma.actionDraft.create({
    data: { actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus: DRAFT_STATUS.WAITING_APPROVAL, payload: { sourceText: content, ...payload }, messageId: message.id, requesterId: purchaser.employeeId },
  });
  return { message, draft };
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  service = moduleRef.get(MessageActionService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  purchaser = await load('2207005');
  purchaseHead = await load('1702004');
  salesStaff = await load('2103003');
  logistics = await load('2304015');
  const room = await prisma.chatRoom.create({
    data: { chatRoomType: 'GROUP', chatRoomName: '원료 구매 협의', chatRoomMembers: { create: [purchaser, purchaseHead, salesStaff].map((u) => ({ employeeId: u.employeeId })) } },
  });
  roomId = room.id;
  oreId = (await prisma.item.findUniqueOrThrow({ where: { itemCode: 'ORE01' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('초안 조회 (REQ-ACT-002)', () => {
  it('상세는 원본 메시지·요청자·고른 원료와 확정 전에 채울 칸을 보여 준다', async () => {
    const { message, draft } = await draftOf('철광석 120톤 다음 달 20일까지 필요해요', { itemId: oreId, requestedTon: '120.5' });
    const view = await service.get(purchaser, draft.id);
    expect(view).toMatchObject({
      actionType: 'PURCHASE_REQUISITION_CREATE',
      draftStatus: DRAFT_STATUS.WAITING_APPROVAL,
      payload: { itemId: oreId, requestedTon: '120.5', desiredReceiptDate: null, requestReason: null, sourceText: message.content },
      itemCode: 'ORE01',
      requesterId: purchaser.employeeId,
      requesterName: purchaser.employeeName,
      message: { id: message.id, chatRoomId: roomId, chatRoomName: '원료 구매 협의', chatRoomType: 'GROUP', senderName: purchaser.employeeName },
      unresolvedFields: ['희망 입고일'],
      purchaseRequisition: null,
      executionAttemptCount: 0,
    });
    expect(view.requesterDepartmentName).not.toBeNull();
    expect(await codeOf(service.get(purchaser, 2_000_000_000))).toBe('COM-003');
  });

  it('원료가 아닌 품목·0 이하 톤·없는 날짜는 확정 전에 채울 칸으로 남는다', async () => {
    const slabId = (await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } })).id;
    const { draft } = await draftOf('슬래브 주문?', { itemId: slabId, requestedTon: '0', desiredReceiptDate: '2026-02-30' });
    expect((await service.get(purchaser, draft.id)).unresolvedFields).toEqual(['원료 품목', '수량(톤)', '희망 입고일']);
  });

  it('상세는 요청자 본인과 원본 메시지 방 멤버만 본다 (다른 방 대화가 새지 않게)', async () => {
    const { draft } = await draftOf('철광석 단가 협의', {});
    expect((await service.get(salesStaff, draft.id)).id).toBe(draft.id);
    expect(await codeOf(service.get(logistics, draft.id))).toBe('COM-002');
  });

  it('목록은 내가 요청자인 초안, 채팅방 초안은 방 멤버만 본다 (최근 것 먼저)', async () => {
    const { draft: older } = await draftOf('석탄 확인', {});
    const { draft: newer } = await draftOf('석회석 확인', {});
    const mine = (await service.list(purchaser, {})).map((d) => d.id);
    expect(mine.indexOf(newer.id)).toBeLessThan(mine.indexOf(older.id));
    expect((await service.list(purchaseHead, {})).map((d) => d.id)).not.toContain(newer.id);
    expect((await service.list(salesStaff, { chatRoomId: roomId })).map((d) => d.id)).toEqual(expect.arrayContaining([older.id, newer.id]));
    expect(await codeOf(service.list(logistics, { chatRoomId: roomId }))).toBe('COM-002');
  });
});

describe('초안 생성 (REQ-ACT-001, API-251)', () => {
  it('방 멤버가 만들면 요청자는 메시지 작성자, 확인 대기로 두고 작업 로그를 남긴다. 같은 메시지로 다시 만들면 그 초안을 돌려준다', async () => {
    const message = await send(purchaser, '철광석 120톤 다음 달 20일까지 필요해요');
    const first = await service.create(purchaseHead, message.id);
    expect(first.created).toBe(true);
    expect(await service.get(purchaseHead, first.id)).toMatchObject({
      draftStatus: DRAFT_STATUS.WAITING_APPROVAL,
      requesterId: purchaser.employeeId,
      payload: { itemId: null, requestedTon: null, desiredReceiptDate: null, requestReason: null, sourceText: message.content },
      unresolvedFields: ['원료 품목', '수량(톤)', '희망 입고일'],
    });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED, actionDraftId: first.id } });
    expect(event).toMatchObject({ actorEmployeeId: purchaseHead.employeeId, messageId: message.id, targetType: 'action_draft', targetId: first.id });
    expect(await service.create(purchaser, message.id)).toEqual({ id: first.id, created: false });
  });

  it('방 멤버가 아니면 COM-002, 없는 메시지는 COM-003, 요청자(작성자)에게 구매요청 등록 권한이 없으면 COM-002', async () => {
    const message = await send(purchaser, '석회석 확인 부탁');
    expect(await codeOf(service.create(logistics, message.id))).toBe('COM-002');
    expect(await codeOf(service.create(purchaser, 2_000_000_000))).toBe('COM-003');
    const fromSales = await send(salesStaff, '원료가 모자라요');
    expect(await codeOf(service.create(purchaser, fromSales.id))).toBe('COM-002');
  });

  it('시스템 메시지·삭제된 메시지에서는 만들 수 없다 (COM-004)', async () => {
    const system = await prisma.message.create({ data: { chatRoomId: roomId, messageType: 'SYSTEM', content: '업무방을 열었어요' } });
    expect(await codeOf(service.create(purchaser, system.id))).toBe('COM-004');
    const deleted = await prisma.message.create({ data: { chatRoomId: roomId, senderId: purchaser.employeeId, content: '지운 글', deletedAt: new Date() } });
    expect(await codeOf(service.create(purchaser, deleted.id))).toBe('COM-004');
  });
});

describe('초안 수정 (REQ-ACT-002)', () => {
  it('요청자만 고친다. 형식이 틀리면 COM-004, 다 채우면 확정 전에 채울 칸이 없다', async () => {
    const slabId = (await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } })).id;
    const message = await send(purchaser, '철광석 50톤');
    const { id } = await service.create(purchaser, message.id);

    expect(await codeOf(service.update(purchaseHead, id, { requestedTon: '50' }))).toBe('COM-002');
    expect(await codeOf(service.update(purchaser, id, { itemId: slabId }))).toBe('COM-004');
    expect(await codeOf(service.update(purchaser, id, { itemId: 2_000_000_000 }))).toBe('COM-003');
    expect(await codeOf(service.update(purchaser, id, { requestedTon: '-1' }))).toBe('COM-004');
    expect(await codeOf(service.update(purchaser, id, { desiredReceiptDate: '2026-02-30' }))).toBe('COM-004');

    const partial = await service.update(purchaser, id, { itemId: oreId, requestedTon: '50.5' });
    // 톤은 소수 3자리로 맞춰 저장한다
    expect(partial).toMatchObject({ itemCode: 'ORE01', payload: { itemId: oreId, requestedTon: '50.500' }, unresolvedFields: ['희망 입고일'] });
    expect(await codeOf(service.update(purchaser, id, { desiredReceiptDate: '2026-11-20', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }))).toBe('COM-001');
    const filled = await service.update(purchaser, id, { desiredReceiptDate: '2026-11-20', expectedUpdatedAt: partial.updatedAt });
    expect(filled.unresolvedFields).toEqual([]);
    expect((await service.update(purchaser, id, { requestedTon: null })).unresolvedFields).toEqual(['수량(톤)']);

    await prisma.actionDraft.update({ where: { id }, data: { draftStatus: DRAFT_STATUS.REJECTED } });
    expect(await codeOf(service.update(purchaser, id, { requestedTon: '10' }))).toBe('COM-004');
  });
});
