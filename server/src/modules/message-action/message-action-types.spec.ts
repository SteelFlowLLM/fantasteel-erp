// Message → ERP 확장 유형(REQ-ACT-005, 모듈 문서 10장)의 생성·수정·확정·실행·반려를 실제 DB(fs_pur)로 확인한다.
// 수주·예약·합격 LOT은 데이터로 직접 넣고, LLM은 가짜로 바꿔 답을 정한다.
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, INSPECTION_RESULT, LOT_RELATION_EVIDENCE, LOT_TYPE, PROCESS_TYPE, type ActionType, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmClient, type ChatMessage } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { ActionTypeRegistry } from './action-types/action-type.registry';
import { MessageActionService } from './message-action.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: MessageActionService;
/** 영업 사원 박서영 — 확장 유형 초안을 만들고 확정한다 */
let sales: AuthUser;
/** 영업부장 김도윤 — 같은 방의 다른 영업 사원 */
let salesHead: AuthUser;
/** 구매 사원 정다은 — 수주·출하 권한 없음 */
let purchaser: AuthUser;
/** 생산부장 강민석 — 재생산 계획(생산계획 확정 권한) */
let productionHead: AuthUser;
let roomId: number;
let customerId: number;
let seq = 0;
/** 같은 DB로 다시 돌려도 번호가 겹치지 않게 */
const RUN = Date.now().toString(36).toUpperCase();

const SLAB_SS275 = 'SL-SS275-250x1200x10000';
const SLAB_SM355A = 'SL-SM355A-250x1500x10000';

const llm = { model: null as string | null, reply: async (): Promise<string> => '{}', calls: [] as ChatMessage[][] };
const useLlm = (reply: object) => Object.assign(llm, { model: 'test-model', reply: async () => JSON.stringify(reply) });

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
const itemIdOf = async (itemCode: string) => (await prisma.item.findUniqueOrThrow({ where: { itemCode } })).id;
const eventsOf = (actionDraftId: number) => prisma.businessEvent.findMany({ where: { actionDraftId }, orderBy: { id: 'asc' } });
const createDraft = async (user: AuthUser, content: string, actionType: ActionType) => service.create(user, (await send(purchaser, content)).id, actionType);

/** 수주 1건(품목 1개) + ACTIVE 예약 reservedQty매 (재고 행도 맞춘다) */
async function salesOrderWithReservation(itemCode: string, orderedQty: number, reservedQty: number) {
  seq += 1;
  const itemId = await itemIdOf(itemCode);
  const created = await prisma.salesOrder.create({
    data: {
      salesOrderNo: `SO-MA${RUN}-${String(seq).padStart(3, '0')}`,
      customerId,
      ownerEmployeeId: sales.employeeId,
      salesOrderItems: { create: { itemId, orderedQty, dueDate: new Date('2026-12-31T00:00:00.000Z') } },
    },
    select: { id: true, salesOrderNo: true, salesOrderItems: { select: { id: true } } },
  });
  const salesOrderItemId = created.salesOrderItems[0].id;
  if (reservedQty > 0) {
    await prisma.reservation.create({ data: { salesOrderItemId, itemId, reservedQty } });
    await prisma.inventory.upsert({
      where: { itemId },
      create: { itemId, onHandQty: reservedQty, reservedQty },
      update: { onHandQty: { increment: reservedQty }, reservedQty: { increment: reservedQty } },
    });
  }
  return { salesOrderNo: created.salesOrderNo, salesOrderItemId };
}

/** 배정할 수 있는 슬래브 LOT: 슬래브 검사 PASS + 상위 히트 PASS */
async function passedSlabLot(itemCode: string, producedDate: string) {
  seq += 1;
  const item = await prisma.item.findUniqueOrThrow({ where: { itemCode } });
  const grade = itemCode.split('-')[1];
  const standardOf = (code: string) => prisma.inspectionStandard.findFirstOrThrow({ where: { inspectionStandardCode: code }, orderBy: { versionNo: 'desc' } });
  const steelmaking = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.STEELMAKING, converterCode: 'BOF1', startedAt: new Date(), completedAt: new Date() } });
  const casting = await prisma.productionResult.create({ data: { processType: PROCESS_TYPE.CONTINUOUS_CASTING, startedAt: new Date(), completedAt: new Date() } });
  const heat = await prisma.lot.create({ data: { lotNo: `HT-MA${RUN}-${seq}`, lotType: LOT_TYPE.HEAT, steelGradeId: item.steelGradeId, productionResultId: steelmaking.id } });
  const slab = await prisma.lot.create({ data: { lotNo: `SL-MA${RUN}-${seq}`, lotType: LOT_TYPE.SLAB, itemId: item.id, productionResultId: casting.id, producedDate: new Date(`${producedDate}T00:00:00.000Z`) } });
  await prisma.lotRelation.create({ data: { parentLotId: heat.id, childLotId: slab.id, lotRelationEvidence: LOT_RELATION_EVIDENCE.ACTUAL_INPUT } });
  for (const [lotId, code] of [[heat.id, `QS-${grade}-ST`], [slab.id, `QS-${grade}-CC`]] as const) {
    await prisma.qualityInspection.create({
      data: { lotId, inspectionStandardId: (await standardOf(code)).id, inspectionResult: INSPECTION_RESULT.PASS, inspectorEmployeeId: productionHead.employeeId, inspectedAt: new Date() },
    });
  }
  return slab;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmSettingsStore)
    .useValue({ read: async () => ({ baseUrl: 'http://llm.test/v1', model: llm.model, apiKey: null }) })
    .overrideProvider(LlmClient)
    .useValue({
      chat: async (_endpoint: unknown, _model: string, messages: ChatMessage[]) => {
        llm.calls.push(messages);
        return llm.reply();
      },
    })
    .compile();
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
  sales = await load('2103003');
  salesHead = await load('1608002');
  purchaser = await load('2207005');
  productionHead = await load('1401006');
  const room = await prisma.chatRoom.create({
    data: { chatRoomType: 'GROUP', chatRoomName: '10월 수주·출하 협의', chatRoomMembers: { create: [sales, salesHead, purchaser, productionHead].map((u) => ({ employeeId: u.employeeId })) } },
  });
  roomId = room.id;
  customerId = (await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-01' } })).id;
}, 60_000);

afterEach(() => {
  Object.assign(llm, { model: null, reply: async () => '{}', calls: [] });
});

afterAll(async () => {
  await moduleRef?.close();
});

describe('수주 등록 초안 (SALES_ORDER_CREATE)', () => {
  it('AI가 고객사·규격·매수·납기를 채우고, 만든 사원이 확정하면 수주·생산계획이 생기며 작업 로그가 초안·AI 경유로 이어진다', async () => {
    useLlm({ customerName: '가람중공업', items: [{ itemCode: SLAB_SS275, orderedQty: 20, dueDate: '2026-11-06' }] });
    const created = await createDraft(sales, '가람중공업 SS275 슬래브 250×1200 20매 다음주 금요일 납기로 수주 넣어줘', 'SALES_ORDER_CREATE');
    expect(created).toMatchObject({ created: true, requesterId: sales.employeeId, requesterName: sales.employeeName });
    const [system] = llm.calls[0];
    expect(system.content).toContain('CUS-01 | 가람중공업');
    expect(system.content).toContain(`${SLAB_SS275} |`);

    const view = await service.get(sales, created.id);
    expect(view).toMatchObject({
      actionType: 'SALES_ORDER_CREATE',
      draftStatus: DRAFT_STATUS.WAITING_APPROVAL,
      requesterId: sales.employeeId,
      payload: { customerId, items: [{ itemId: await itemIdOf(SLAB_SS275), orderedQty: 20, dueDate: '2026-11-06' }], aiFilledFields: ['customerId', 'items'] },
      unresolvedFields: [],
      payloadLabels: { customerId: '가람중공업' },
    });
    expect(view.payloadLabels['items.0.itemId']).toContain(SLAB_SS275);

    const result = await service.confirm(sales, created.id, {});
    expect(result).toMatchObject({ executed: true, errorCode: null, draft: { draftStatus: DRAFT_STATUS.EXECUTED, result: { table: 'sales_order' } } });
    const salesOrder = await prisma.salesOrder.findUniqueOrThrow({ where: { id: result.draft.result?.id }, include: { salesOrderItems: true } });
    expect(salesOrder).toMatchObject({ salesOrderNo: result.draft.result?.no, customerId, ownerEmployeeId: sales.employeeId });
    expect(salesOrder.salesOrderItems).toMatchObject([{ orderedQty: 20 }]);

    const events = await eventsOf(created.id);
    expect(events.map((e) => [e.businessEventType, e.isAiAssisted])).toEqual([
      [BUSINESS_EVENT_TYPE.DRAFT_CREATED, true],
      [BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED, true],
      [BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED, true],
      [BUSINESS_EVENT_TYPE.DRAFT_EXECUTED, true],
    ]);
    expect(events[2]).toMatchObject({ targetType: 'sales_order', targetId: salesOrder.id, messageId: events[0].messageId });
    expect(events[3].afterData).toMatchObject({ resultTable: 'sales_order', resultId: salesOrder.id, resultNo: salesOrder.salesOrderNo });
    // 수주 등록 안에서 이어 생긴 생산계획 로그도 AI 경유다
    const planEvents = await prisma.businessEvent.findMany({ where: { salesOrderId: salesOrder.id, businessEventType: BUSINESS_EVENT_TYPE.PRODUCTION_PLAN_CREATED } });
    expect(planEvents.length).toBeGreaterThan(0);
    expect(planEvents.every((e) => e.isAiAssisted)).toBe(true);
  });

  it('확정을 동시에 두 번 보내도(더블클릭) 확정 작업 로그와 수주는 한 건씩이다 (#531)', async () => {
    useLlm({ customerName: '나래조선', items: [{ itemCode: SLAB_SS275, orderedQty: 3, dueDate: '2026-11-20' }] });
    const { id } = await createDraft(sales, '나래조선 SS275 슬래브 3매 11월 20일 납기', 'SALES_ORDER_CREATE');
    const { updatedAt } = await service.get(sales, id);
    const settled = await Promise.allSettled([service.confirm(sales, id, { expectedUpdatedAt: updatedAt }), service.confirm(sales, id, { expectedUpdatedAt: updatedAt })]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((s) => s.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(AppException);
    const events = await eventsOf(id);
    expect(events.filter((e) => e.businessEventType === BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED)).toHaveLength(1);
    expect(events.filter((e) => e.businessEventType === BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED)).toHaveLength(1);
  });

  it('권한이 없으면 만들 수 없고, 다른 사원이 만든 미처리 초안이 있으면 그 초안과 만든 사람을 돌려준다. 고치고 확정하는 것은 만든 사원만', async () => {
    expect(await codeOf(createDraft(purchaser, '나래조선 수주 넣어줘', 'SALES_ORDER_CREATE'))).toBe('COM-002');
    const message = await send(purchaser, '나래조선 SM355A 슬래브 수주');
    const first = await service.create(sales, message.id, 'SALES_ORDER_CREATE');
    expect(await service.create(salesHead, message.id, 'SALES_ORDER_CREATE')).toEqual({ id: first.id, created: false, requesterId: sales.employeeId, requesterName: sales.employeeName });
    // 같은 메시지라도 유형이 다르면 따로 만든다
    expect((await service.create(salesHead, message.id, 'SHIPMENT_REQUEST_CREATE')).created).toBe(true);
    expect((await service.get(salesHead, first.id)).id).toBe(first.id);
    expect(await codeOf(service.update(salesHead, first.id, { payload: { customerId } }))).toBe('COM-002');
    expect(await codeOf(service.confirm(salesHead, first.id, {}))).toBe('COM-002');
  });

  it('수정은 칸을 검증하고, 빈 칸이 남으면 확정이 ACT-001로 막힌다', async () => {
    const { id } = await createDraft(sales, '수주 하나 넣어 주세요', 'SALES_ORDER_CREATE');
    expect((await service.get(sales, id)).unresolvedFields).toEqual(['고객사', '품목']);
    const itemId = await itemIdOf(SLAB_SS275);
    expect(await codeOf(service.update(sales, id, { payload: { items: [{ itemId, orderedQty: 10.5, dueDate: '2026-11-30' }] } }))).toBe('COM-004');
    // 수주 등록과 같은 한 줄 상한·같은 코드·같은 문구 (#496, #509)
    const over = await service.update(sales, id, { payload: { items: [{ itemId, orderedQty: 10_000, dueDate: '2026-11-30' }] } }).then(() => null, (e: unknown) => e);
    expect(over).toMatchObject({ code: 'SO-002', message: '수량은 품목 한 줄에 9,999까지 입력할 수 있어요' });
    expect(await codeOf(service.update(sales, id, { payload: { items: [{ itemId: await itemIdOf('ORE01'), orderedQty: 1, dueDate: '2026-11-30' }] } }))).toBe('SO-001');
    expect(await codeOf(service.update(sales, id, { payload: { itemId } }))).toBe('COM-004');
    const edited = await service.update(sales, id, { payload: { items: [{ itemId, orderedQty: 3, dueDate: null }] } });
    expect(edited.unresolvedFields).toEqual(['고객사', '품목 1 납기']);
    expect(await codeOf(service.confirm(sales, id, {}))).toBe('ACT-001');
    expect(await prisma.actionDraft.findUniqueOrThrow({ where: { id } })).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
  });

  it('반려하면 REJECTED로 끝나고, 같은 메시지로 다시 만들 수 있다', async () => {
    const message = await send(purchaser, '보람강관 수주 건');
    const first = await service.create(sales, message.id, 'SALES_ORDER_CREATE');
    const rejected = await service.reject(sales, first.id, { rejectReason: '고객사 확인 전' });
    expect(rejected).toMatchObject({ draftStatus: DRAFT_STATUS.REJECTED, rejectReason: '고객사 확인 전' });
    expect((await eventsOf(first.id)).map((e) => e.businessEventType)).toEqual([BUSINESS_EVENT_TYPE.DRAFT_CREATED, BUSINESS_EVENT_TYPE.DRAFT_REJECTED]);
    expect((await service.create(sales, message.id, 'SALES_ORDER_CREATE')).created).toBe(true);
  });
});

describe('출하요청 생성 초안 (SHIPMENT_REQUEST_CREATE)', () => {
  it('수주번호로 수주 품목을 맞추고 고객사를 따라 정한다. 확정하면 배정 대기 출하요청이 생긴다', async () => {
    const so = await salesOrderWithReservation(SLAB_SM355A, 10, 10);
    useLlm({ customerName: null, shipDate: '2026-11-03', items: [{ salesOrderNo: so.salesOrderNo.toLowerCase(), lineNo: null, itemCode: null, requestQty: '4매' }] });
    const { id } = await createDraft(sales, `${so.salesOrderNo} 4매 11월 3일 출하요청 잡아줘`, 'SHIPMENT_REQUEST_CREATE');
    const view = await service.get(sales, id);
    expect(view).toMatchObject({
      payload: { customerId, shipDate: '2026-11-03', items: [{ salesOrderItemId: so.salesOrderItemId, requestQty: 4 }], aiFilledFields: ['customerId', 'shipDate', 'items'] },
      unresolvedFields: [],
    });
    expect(view.payloadLabels['items.0.salesOrderItemId']).toContain(so.salesOrderNo);

    const result = await service.confirm(sales, id, {});
    expect(result).toMatchObject({ executed: true, draft: { result: { table: 'shipment_request' } } });
    const request = await prisma.shipmentRequest.findUniqueOrThrow({ where: { id: result.draft.result?.id }, include: { shipmentRequestItems: true } });
    expect(request.shipmentRequestItems).toMatchObject([{ salesOrderItemId: so.salesOrderItemId, requestQty: 4 }]);
    const created = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.SHIPMENT_REQUEST_CREATED, targetId: request.id } });
    expect(created).toMatchObject({ actionDraftId: id, isAiAssisted: true });
  });

  it('출하 가능 매수를 넘으면 확정 전에 SHP-002로 막고, 다른 고객사의 수주 품목은 미확정 칸으로 남긴다', async () => {
    const so = await salesOrderWithReservation(SLAB_SM355A, 5, 5);
    const { id } = await createDraft(sales, '출하요청', 'SHIPMENT_REQUEST_CREATE');
    await service.update(sales, id, { payload: { customerId, items: [{ salesOrderItemId: so.salesOrderItemId, requestQty: 6 }] } });
    expect(await codeOf(service.confirm(sales, id, {}))).toBe('SHP-002');
    expect(await prisma.actionDraft.findUniqueOrThrow({ where: { id } })).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
    const other = (await prisma.customer.findUniqueOrThrow({ where: { customerCode: 'CUS-02' } })).id;
    expect((await service.update(sales, id, { payload: { customerId: other } })).unresolvedFields).toEqual(['품목 1 수주 품목']);
  });
});

describe('배정 확정 초안 (ALLOCATION_CONFIRM)', () => {
  it('AI는 출하요청 품목만 고르고 LOT은 FIFO 추천으로 채운다. 확정하면 배정이 CONFIRMED로 생긴다', async () => {
    const so = await salesOrderWithReservation(SLAB_SM355A, 2, 2);
    const requestDraft = await createDraft(sales, '출하요청 2매', 'SHIPMENT_REQUEST_CREATE');
    await service.update(sales, requestDraft.id, { payload: { customerId, items: [{ salesOrderItemId: so.salesOrderItemId, requestQty: 2 }] } });
    const request = (await service.confirm(sales, requestDraft.id, {})).draft.result;
    const newer = await passedSlabLot(SLAB_SM355A, '2026-10-10');
    const older = await passedSlabLot(SLAB_SM355A, '2026-10-01');

    useLlm({ shipmentRequestNo: request?.no, lineNo: null, itemCode: null, lotIds: [999] });
    const { id } = await createDraft(sales, `${request?.no} 배정 확정해 줘`, 'ALLOCATION_CONFIRM');
    const view = await service.get(sales, id);
    // 다른 테스트가 남긴 합격 LOT이 없으면 이 두 LOT이 오래된 순으로 추천된다
    expect(view.payload).toMatchObject({ lotIds: expect.arrayContaining([older.id]), aiFilledFields: ['shipmentRequestItemId'] });
    expect(view.unresolvedFields).toEqual([]);
    expect(view.payloadLabels.lotIds).toContain(older.lotNo);

    // LOT을 사람이 바꿀 수 있다
    await service.update(sales, id, { payload: { lotIds: [older.id, newer.id] } });
    const result = await service.confirm(sales, id, {});
    expect(result).toMatchObject({ executed: true, draft: { result: { table: 'shipment_request', id: request?.id, no: request?.no } } });
    expect(await prisma.shipmentRequest.findUniqueOrThrow({ where: { id: request?.id } })).toMatchObject({ shipmentRequestStatus: 'ALLOCATED' });
    const allocations = await prisma.allocation.findMany({ where: { lotId: { in: [older.id, newer.id] }, allocationStatus: 'CONFIRMED' } });
    expect(allocations).toHaveLength(2);
    const events = await prisma.businessEvent.findMany({ where: { businessEventType: BUSINESS_EVENT_TYPE.ALLOCATION_CONFIRMED, actionDraftId: id } });
    expect(events).toHaveLength(2);

    // 미배정 매수가 없으면 추천 LOT도 없어 확정할 수 없다
    const again = await createDraft(sales, `${request?.no} 배정 다시`, 'ALLOCATION_CONFIRM');
    expect((await service.get(sales, again.id)).unresolvedFields).toEqual(['배정 LOT']);
  });

  /** 출하요청 1건(같은 규격 품목 한 줄, requestQty매)과 그 품목 id */
  async function openRequestItem(requestQty: number) {
    const so = await salesOrderWithReservation(SLAB_SM355A, requestQty, requestQty);
    const requestDraft = await createDraft(sales, `출하요청 ${requestQty}매`, 'SHIPMENT_REQUEST_CREATE');
    await service.update(sales, requestDraft.id, { payload: { customerId, items: [{ salesOrderItemId: so.salesOrderItemId, requestQty }] } });
    const request = await prisma.shipmentRequest.findUniqueOrThrow({ where: { id: (await service.confirm(sales, requestDraft.id, {})).draft.result?.id }, include: { shipmentRequestItems: true } });
    return request.shipmentRequestItems[0].id;
  }

  it('배정할 수 없는 LOT(불합격·없는 LOT·미배정 매수 초과)은 확정 전에 막고 확인 대기로 둔다 (#471 리뷰)', async () => {
    const requestItemId = await openRequestItem(1);
    const failed = await passedSlabLot(SLAB_SM355A, '2026-10-05');
    await prisma.qualityInspection.update({ where: { lotId: failed.id }, data: { inspectionResult: INSPECTION_RESULT.FAIL } });
    const ok = await passedSlabLot(SLAB_SM355A, '2026-10-06');

    const { id } = await createDraft(sales, '배정', 'ALLOCATION_CONFIRM');
    await service.update(sales, id, { payload: { shipmentRequestItemId: requestItemId } });
    for (const [lotIds, code] of [[[failed.id], 'INV-002'], [[2_000_000_000], 'COM-003'], [[ok.id, failed.id], 'INV-001']] as const) {
      await service.update(sales, id, { payload: { lotIds: [...lotIds] } });
      expect(await codeOf(service.confirm(sales, id, {}))).toBe(code);
    }
    expect(await prisma.actionDraft.findUniqueOrThrow({ where: { id } })).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL, executionAttemptCount: 0 });
    expect(await prisma.allocation.count({ where: { lotId: failed.id } })).toBe(0);

    // 사람이 고친 LOT으로 확정하면 사유가 'FIFO 추천'이 아니다
    await service.update(sales, id, { payload: { lotIds: [ok.id] } });
    expect((await service.confirm(sales, id, {})).executed).toBe(true);
    const confirmed = await prisma.businessEvent.findFirstOrThrow({ where: { actionDraftId: id, businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED } });
    expect(confirmed.reason).toContain('사람이 고름');
  });

  it('같은 규격 출하요청 품목 두 개로 초안 두 장을 만들면 서로 다른 LOT을 추천한다 (#471 리뷰)', async () => {
    const first = await openRequestItem(1);
    const second = await openRequestItem(1);
    await passedSlabLot(SLAB_SM355A, '2026-09-01');
    await passedSlabLot(SLAB_SM355A, '2026-09-02');
    const a = await createDraft(sales, '배정 1', 'ALLOCATION_CONFIRM');
    await service.update(sales, a.id, { payload: { shipmentRequestItemId: first } });
    const b = await createDraft(sales, '배정 2', 'ALLOCATION_CONFIRM');
    await service.update(sales, b.id, { payload: { shipmentRequestItemId: second } });
    const lotsA = (await service.get(sales, a.id)).payload;
    const lotsB = (await service.get(sales, b.id)).payload;
    if (!('lotIds' in lotsA) || !('lotIds' in lotsB)) throw new Error('배정 확정 초안이 아니다');
    expect(lotsA.lotIds).toHaveLength(1);
    expect(lotsB.lotIds).toHaveLength(1);
    expect(lotsB.lotIds[0]).not.toBe(lotsA.lotIds[0]);
    // 추천 다시 받기(같은 품목)는 자기 LOT을 다시 쓸 수 있다
    await service.update(sales, a.id, { payload: { shipmentRequestItemId: first } });
    expect((await service.get(sales, a.id)).payload).toMatchObject({ lotIds: lotsA.lotIds, lotsChosenBy: 'RECOMMENDATION' });
    expect((await service.confirm(sales, a.id, {})).executed).toBe(true);
    expect((await service.confirm(sales, b.id, {})).executed).toBe(true);
  });
});

describe('실행 실패 (#471 리뷰)', () => {
  it('핸들러의 업무 오류(COM-001 포함)와 예상 못 한 오류(COM-999)는 실패로 남기고, 실행에 실패한 초안은 반려할 수 있다', async () => {
    const definition = moduleRef.get(ActionTypeRegistry).get('REPRODUCTION_PLAN_CREATE');
    const so = await salesOrderWithReservation(SLAB_SS275, 3, 0);
    const { id } = await createDraft(productionHead, '재생산', 'REPRODUCTION_PLAN_CREATE');
    await service.update(productionHead, id, { payload: { salesOrderItemId: so.salesOrderItemId } });

    const spy = jest.spyOn(definition, 'execute').mockRejectedValueOnce(new AppException('COM-001', '취소·출하완료된 수주 품목은 재생산하지 않아요'));
    const businessError = await service.confirm(productionHead, id, {});
    expect(businessError).toMatchObject({ executed: false, errorCode: 'COM-001', draft: { draftStatus: DRAFT_STATUS.APPROVED, executionErrorCode: 'COM-001', executionAttemptCount: 1 } });

    spy.mockRejectedValueOnce(new Error('connection reset'));
    const unexpected = await service.execute(productionHead, id);
    expect(unexpected).toMatchObject({ executed: false, errorCode: 'COM-999', draft: { executionErrorCode: 'COM-999', executionAttemptCount: 2 } });
    spy.mockRestore();

    const rejected = await service.reject(productionHead, id, { rejectReason: '이미 다른 계획으로 채웠어요' });
    expect(rejected).toMatchObject({ draftStatus: DRAFT_STATUS.REJECTED, rejectReason: '이미 다른 계획으로 채웠어요' });
    expect(await prisma.productionPlan.count({ where: { salesOrderItemId: so.salesOrderItemId } })).toBe(0);
  });

  it('실행에 실패하지 않은 승인 초안은 반려할 수 없다', async () => {
    const so = await salesOrderWithReservation(SLAB_SS275, 2, 0);
    const { id } = await createDraft(productionHead, '재생산 승인만', 'REPRODUCTION_PLAN_CREATE');
    await service.update(productionHead, id, { payload: { salesOrderItemId: so.salesOrderItemId } });
    await prisma.actionDraft.update({ where: { id }, data: { draftStatus: DRAFT_STATUS.APPROVED } });
    expect(await codeOf(service.reject(productionHead, id, { rejectReason: '취소' }))).toBe('COM-004');
  });
});

describe('재생산 계획 생성 초안 (REPRODUCTION_PLAN_CREATE)', () => {
  it('생산계획 확정 권한이 있는 사원이 확정하면 부족 매수만큼 재생산 계획이 생긴다', async () => {
    const so = await salesOrderWithReservation(SLAB_SS275, 4, 0);
    useLlm({ salesOrderNo: so.salesOrderNo, lineNo: 1, itemCode: null });
    expect(await codeOf(createDraft(sales, `${so.salesOrderNo} 재생산`, 'REPRODUCTION_PLAN_CREATE'))).toBe('COM-002');
    const { id } = await createDraft(productionHead, `${so.salesOrderNo} 합격 매수 모자라서 재생산 계획 잡아 주세요`, 'REPRODUCTION_PLAN_CREATE');
    expect(await service.get(productionHead, id)).toMatchObject({ payload: { salesOrderItemId: so.salesOrderItemId, aiFilledFields: ['salesOrderItemId'] }, unresolvedFields: [] });

    const result = await service.confirm(productionHead, id, {});
    expect(result).toMatchObject({ executed: true, draft: { result: { table: 'production_plan' } } });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { id: result.draft.result?.id } });
    expect(plan).toMatchObject({ salesOrderItemId: so.salesOrderItemId, isReproduction: true, shortageQty: 4 });
    const event = await prisma.businessEvent.findFirstOrThrow({ where: { businessEventType: BUSINESS_EVENT_TYPE.REPRODUCTION_PLAN_CREATED, targetId: plan.id } });
    expect(event).toMatchObject({ actionDraftId: id, isAiAssisted: true });
  });

  it('진행 계획으로 이미 채워지면 확정 전에 COM-001로 막는다', async () => {
    const so = await salesOrderWithReservation(SLAB_SS275, 2, 0);
    const first = await createDraft(productionHead, '재생산', 'REPRODUCTION_PLAN_CREATE');
    await service.update(productionHead, first.id, { payload: { salesOrderItemId: so.salesOrderItemId } });
    expect((await service.confirm(productionHead, first.id, {})).executed).toBe(true);
    const second = await createDraft(productionHead, '재생산 한 번 더', 'REPRODUCTION_PLAN_CREATE');
    await service.update(productionHead, second.id, { payload: { salesOrderItemId: so.salesOrderItemId } });
    expect(await codeOf(service.confirm(productionHead, second.id, {}))).toBe('COM-001');
    expect(await prisma.actionDraft.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ draftStatus: DRAFT_STATUS.WAITING_APPROVAL });
  });
});
