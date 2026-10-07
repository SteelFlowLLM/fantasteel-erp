// 업무 프로세스 14.2 P1 코일·혼합·취소 + 메신저를 화면 api 함수로 돌린다 (새 시드, 단계마다 맡은 사원으로 바꾼다).
import { describe, expect, it } from 'vitest';
import { InputError } from '@/api/client';
import { inventoryApi } from '@/api/inventories';
import { lotTraceApi } from '@/api/lotTrace';
import { messengerApi } from '@/api/messenger';
import { notificationApi } from '@/api/notifications';
import { productionPlanApi } from '@/api/production';
import { productionResultApi } from '@/api/productionResults';
import { rollingApi } from '@/api/rolling';
import { salesOrderApi } from '@/api/salesOrders';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import {
  as,
  at,
  customerIdOf,
  expectClean,
  idOf,
  inspectViaApi,
  itemIdOf,
  lotOf,
  lotsOfPlan,
  planIdOf,
  readDb,
  salesOrderIdOf,
  soItemIdsOf,
  stockRawMaterialsViaApi,
  useScenarioClock,
} from '@/api/scenario/scenarioKit';

const COIL = 'CL-SS275-4.5x1500x544000';
const SLAB_A = 'SL-SS275-250x1200x10000'; // 시드 합격 가용 6매
const SLAB_B = 'SL-SS275-250x1500x10000'; // 코일의 대응 슬래브 규격 (재고 없음)

const planIdByNo = async (productionPlanNo: string): Promise<number> => (await productionPlanApi.list()).find((p) => p.productionPlanNo === productionPlanNo)?.id ?? 0;

describe('14.2 P1 코일·혼합·취소 (화면 api)', () => {
  useScenarioClock();

  it('혼합 수주는 코일 부족분만 코일 라우팅으로 계획하고, 필요 슬래브만 판매 예약을 피해 열연 배정 → 슬래브 1매 = 코일 1개 → 검사 → 자동 예약', async () => {
    at('2026-10-01T08:00:00+09:00');
    await stockRawMaterialsViaApi('2026-10-01');

    // 혼합 수주: 슬래브는 재고 우선 예약으로 끝나고, 코일만 부족 3개 → 코일 계획 1건
    at('2026-10-01T09:00:00+09:00');
    as('sales');
    const mixed = await salesOrderApi.create({
      customerId: customerIdOf('CUS-04'),
      items: [
        { itemId: itemIdOf(COIL), orderedQty: 3, dueDate: '2026-10-25' },
        { itemId: itemIdOf(SLAB_A), orderedQty: 2, dueDate: '2026-10-25' },
      ],
    });
    expect(mixed).toMatchObject({ reservedQty: 2, shortageQty: 3, productionPlanNos: ['PP-2610-0001'] });
    const [coilSoItemId, slabSoItemId] = soItemIdsOf(mixed.salesOrderId);
    const mixedDetail = await salesOrderApi.detail(mixed.salesOrderId);
    expect(mixedDetail.items.map((i) => [i.itemType, i.activeReservedQty, i.plannedQty])).toEqual([
      ['COIL', 0, 3],
      ['SLAB', 2, 0],
    ]);
    expect((await salesOrderApi.productionLinks(mixed.salesOrderId)).map((l) => l.lineNo)).toEqual([1]);
    as('productionHead');
    const coilPlanId = await planIdByNo('PP-2610-0001');
    const coilPlan = await productionPlanApi.detail(coilPlanId);
    // 코일 누적 수율 = 연주 0.98 × 열연(28.825 ÷ 29.438) → 0.9596, 필요 용강 = 3 × 28.825 ÷ 0.9596
    expect(coilPlan.formation).toMatchObject({ shortageQty: 3, cumulativeYieldRate: '0.9596', requiredSteelTon: '90.116', heatCount: 1 });
    expect(coilPlan.slabSpec?.itemCode).toBe(SLAB_B);
    expect(coilPlan.reproduction?.salesOrderItemId).toBe(coilSoItemId);

    // 코일 계획 시뮬레이션: 연주까지 (갓 연주한 슬래브는 판정 대기라 열연하지 않는다)
    at('2026-10-02T18:00:00+09:00');
    as('steelmaking');
    const simulated = await productionResultApi.simulate({ productionPlanId: coilPlanId, randomSeed: 9 });
    expect(simulated.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    expect(simulated.skippedRolling).not.toBeNull();
    const slabs = lotsOfPlan(coilPlanId, 'SLAB');
    expect(slabs).toHaveLength(8); // floor(250 × 0.98 ÷ 29.438)
    expect(slabs.every((s) => s.itemId === itemIdOf(SLAB_B))).toBe(true);
    at('2026-10-03T09:00:00+09:00');
    for (const slab of slabs) await inspectViaApi(slab.id);
    const heatOutcome = await inspectViaApi(lotsOfPlan(coilPlanId, 'HEAT')[0].id);
    expect(heatOutcome.autoReservedQty).toBe(0); // 코일 계획의 슬래브는 슬래브 수주에 자동 예약하지 않는다
    as('hotRollingHead');
    expect((await rollingApi.detail(coilPlanId)).plan).toMatchObject({ neededQty: 3, recommendableQty: 3, rollable: true });

    // 다른 수주가 같은 슬래브 규격 6매를 재고 우선 예약 → 열연은 남은 2매만 (판매 예약 비침범)
    at('2026-10-03T10:00:00+09:00');
    as('sales');
    const other = await salesOrderApi.create({ customerId: customerIdOf('CUS-01'), items: [{ itemId: itemIdOf(SLAB_B), orderedQty: 6, dueDate: '2026-10-30' }] });
    expect(other).toMatchObject({ reservedQty: 6, shortageQty: 0 });
    as('hotRollingHead');
    let rolling = await rollingApi.detail(coilPlanId);
    expect(rolling.plan.slabPool.availableQty).toBe(2);
    expect(rolling.plan.recommendableQty).toBe(2);
    expect(rolling.recommendedLotIds).toHaveLength(2);
    const extra = rolling.candidates.find((c) => !c.isRecommended);
    if (!extra) throw new Error('추천 밖 슬래브 없음');
    await expect(rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: [...rolling.recommendedLotIds, extra.lotId] })).rejects.toMatchObject({ code: 'INV-001' });
    expect(await rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: rolling.recommendedLotIds })).toEqual({ allocatedQty: 2 });
    await expect(rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: [rolling.recommendedLotIds[0]] })).rejects.toMatchObject({ code: 'INV-003' });
    await expect(rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: [extra.lotId] })).rejects.toMatchObject({ code: 'INV-001' });
    rolling = await rollingApi.detail(coilPlanId);
    expect(rolling.plan.slabPool.availableQty).toBe(0);
    // 배정 변경: 사유 필수, 기존 해제 + 새 배정 한 번에
    const [firstAllocation] = rolling.plan.allocations;
    await expect(rollingApi.change({ allocationId: firstAllocation.allocationId, newLotId: extra.lotId, reasonText: ' ' })).rejects.toBeInstanceOf(InputError);
    await rollingApi.change({ allocationId: firstAllocation.allocationId, newLotId: extra.lotId, reasonText: '야드 위치' });
    rolling = await rollingApi.detail(coilPlanId);
    expect(rolling.plan.allocations.map((a) => a.lotId)).toContain(extra.lotId);
    expect(rolling.plan.allocations.map((a) => a.lotId)).not.toContain(firstAllocation.lotId);

    // 열연·판매가 같은 슬래브를 고르면 CONFIRMED 배정은 하나만 (14.3)
    as('sales');
    const dr = await shipmentRequestApi.create({ customerId: customerIdOf('CUS-01'), requestedShipDate: '2026-10-10', items: [{ salesOrderItemId: soItemIdsOf(other.salesOrderId)[0], requestQty: '6' }] });
    const drDetail = await shipmentRequestApi.detail(dr.id);
    const rollingLotIds = rolling.plan.allocations.map((a) => a.lotId);
    expect(drDetail.lines[0].recommendedLots.map((l) => l.lotId).some((id) => rollingLotIds.includes(id))).toBe(false);
    const recommended = drDetail.lines[0].recommendedLots.map((l) => l.lotId);
    await expect(
      shipmentRequestApi.confirmAllocations({ shipmentRequestId: dr.id, lines: [{ shipmentRequestItemId: drDetail.lines[0].shipmentRequestItemId, lotIds: [rollingLotIds[0], ...recommended.slice(1)] }] }),
    ).rejects.toMatchObject({ code: 'INV-003' });
    await shipmentRequestApi.confirmAllocations({ shipmentRequestId: dr.id, lines: [{ shipmentRequestItemId: drDetail.lines[0].shipmentRequestItemId, lotIds: recommended }] });
    as('hotRollingHead');
    await expect(rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: [recommended[0]] })).rejects.toMatchObject({ code: 'INV-003' });
    expectClean();

    // 열연 실적: 슬래브 1매 → 코일 1개 (C + 슬래브번호, 코일 규격 이론중량), 추가 손실 없음
    at('2026-10-04T12:00:00+09:00');
    const slabNos = rolling.plan.allocations.map((a) => lotOf(readDb((t) => t.lot.find((l) => l.id === a.lotId)?.lotNo) ?? '').lotNo);
    const rolled = await rollingApi.registerHotRolling({ productionPlanId: coilPlanId, startedAt: '2026-10-04T10:00:00+09:00', completedAt: '2026-10-04T11:30:00+09:00' });
    expect([...rolled.coilNos].sort()).toEqual(slabNos.map((no) => `C${no.replace(/^HT-/, '')}`).sort());
    const hotRollingResult = (await rollingApi.detail(coilPlanId)).results[0];
    expect(hotRollingResult).toMatchObject({ outputQty: 2, outputTon: '57.650' }); // 2 × 28.825
    expect(hotRollingResult.lossQty ?? 0).toBe(0);
    const coilDetail = await lotTraceApi.detail(lotOf(rolled.coilNos[0]).id);
    expect(coilDetail).toMatchObject({ lotType: 'COIL', item: { itemCode: COIL, theoreticalWeightTon: '28.825' }, inspectionResult: 'PENDING' });
    expect(coilDetail.parents).toHaveLength(1);
    expect(coilDetail.parents[0]).toMatchObject({ lotType: 'SLAB', lotRelationEvidence: 'ACTUAL_INPUT' });
    expect(lotOf(coilDetail.parents[0].lotNo).lotStatus).toBe('CONSUMED');
    await expect(rollingApi.confirm({ productionPlanId: coilPlanId, lotIds: [lotOf(coilDetail.parents[0].lotNo).id] })).rejects.toMatchObject({ code: 'INV-004' });

    // 코일 검사 → 원래 수주 코일 품목에 자동 예약
    at('2026-10-04T14:00:00+09:00');
    let autoReserved = 0;
    for (const coilNo of rolled.coilNos) autoReserved += (await inspectViaApi(lotOf(coilNo).id)).autoReservedQty;
    expect(autoReserved).toBe(2);
    as('sales');
    const after = await salesOrderApi.detail(mixed.salesOrderId);
    expect(after.items.find((i) => i.salesOrderItemId === coilSoItemId)).toMatchObject({ activeReservedQty: 2 });
    expect(after.items.find((i) => i.salesOrderItemId === slabSoItemId)).toMatchObject({ activeReservedQty: 2 });
    as('hotRollingHead');
    expect((await rollingApi.detail(coilPlanId)).plan).toMatchObject({ rolledQty: 2, neededQty: 1, recommendableQty: 0 });
    // 판정 대기 슬래브는 열연 배정할 수 없다 (시드 PP-2609-0003의 판정 대기 2매)
    const seedCoilPlanId = planIdOf('PP-2609-0003');
    const pending = (await productionPlanApi.detail(seedCoilPlanId)).lots.find((l) => l.lotType === 'SLAB' && l.quality === 'PENDING');
    if (!pending) throw new Error('판정 대기 슬래브 시드 없음');
    await expect(rollingApi.confirm({ productionPlanId: seedCoilPlanId, lotIds: [pending.id] })).rejects.toMatchObject({ code: 'INV-002' });
    expectClean();
  });

  it('생산 시작 전 수주 취소 → 계획 취소·예약 RELEASED, 연주 진행 중 취소 → 완료 후 여재, 출하요청 진행 중이면 SO-004', async () => {
    at('2026-10-01T08:00:00+09:00');
    await stockRawMaterialsViaApi('2026-10-01');
    const slabA = itemIdOf(SLAB_A);

    // 시작 전 취소
    at('2026-10-06T09:00:00+09:00');
    as('sales');
    const before = await salesOrderApi.create({ customerId: customerIdOf('CUS-02'), items: [{ itemId: slabA, orderedQty: 8, dueDate: '2026-10-30' }] });
    expect(before).toMatchObject({ reservedQty: 6, shortageQty: 2 });
    await expect(salesOrderApi.cancel({ salesOrderId: before.salesOrderId, cancelReason: '' })).rejects.toBeInstanceOf(InputError);
    await salesOrderApi.cancel({ salesOrderId: before.salesOrderId, cancelReason: '고객 요청' });
    const cancelled = await salesOrderApi.detail(before.salesOrderId);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelBlock: 'CANCELLED', cancelReason: '고객 요청' });
    expect(cancelled.reservations.map((r) => r.reservationStatus)).toEqual(['RELEASED']);
    as('productionHead');
    expect((await productionPlanApi.detail(await planIdByNo(before.productionPlanNos[0]))).productionPlanStatus).toBe('CANCELLED');
    expect((await inventoryApi.listProducts()).find((r) => r.itemCode === SLAB_A)).toMatchObject({ availableQty: 6 });
    as('sales');
    expect((await salesOrderApi.timeline(before.salesOrderId)).map((e) => [e.businessEventType, e.reasonCode])).toEqual(
      expect.arrayContaining([
        ['SALES_ORDER_CANCELLED', 'ORDER_CANCELLED'],
        ['RESERVATION_RELEASED', 'ORDER_CANCELLED'],
        ['PRODUCTION_PLAN_CANCELLED', 'ORDER_CANCELLED'],
      ]),
    );
    expectClean();

    // 연주 진행 중 취소: 수주 연결만 풀고 완료 후 여재
    at('2026-10-07T09:00:00+09:00');
    const during = await salesOrderApi.create({ customerId: customerIdOf('CUS-02'), items: [{ itemId: slabA, orderedQty: 8, dueDate: '2026-10-30' }] });
    as('productionHead');
    const planId = await planIdByNo(during.productionPlanNos[0]);
    at('2026-10-07T14:00:00+09:00');
    as('ironmakingHead');
    await productionResultApi.registerIronmaking({ productionPlanId: planId, blastFurnaceCode: 'bf2', startedAt: '2026-10-07T09:30:00+09:00', completedAt: '2026-10-07T13:30:00+09:00', outputTon: '277.778' });
    at('2026-10-07T16:00:00+09:00');
    as('steelmakingHead');
    const steel = await productionResultApi.registerSteelmaking({ productionPlanId: planId, converterCode: 'BOF1', startedAt: '2026-10-07T14:30:00+09:00', completedAt: '2026-10-07T15:30:00+09:00', inputHotMetalTon: '277.778' });
    const heat = lotOf(steel.outputLotNos[0]);
    at('2026-10-07T16:30:00+09:00');
    const started = await productionResultApi.startWork({ productionPlanId: planId, processType: 'CONTINUOUS_CASTING', startedAt: '2026-10-07T16:20:00+09:00', heatLotId: heat.id });
    expect((await productionResultApi.work(planId)).plan.productionPlanStatus).toBe('IN_PROGRESS');
    at('2026-10-07T17:00:00+09:00');
    as('sales');
    await salesOrderApi.cancel({ salesOrderId: during.salesOrderId, cancelReason: '사양 변경' });
    as('productionHead');
    expect(await productionPlanApi.detail(planId)).toMatchObject({ productionPlanStatus: 'IN_PROGRESS', isSurplusOnCompletion: true, salesOrder: null });
    as('sales');
    const surplusEvent = (await salesOrderApi.timeline(during.salesOrderId)).find((e) => e.businessEventType === 'SURPLUS_CONVERTED');
    expect(surplusEvent).toMatchObject({ reasonCode: 'SURPLUS_CONVERSION' });
    expect((await salesOrderApi.productionLinks(during.salesOrderId)).map((l) => [l.lineNo, l.plan.id])).toEqual([[null, planId]]);
    at('2026-10-07T20:00:00+09:00');
    as('steelmakingHead');
    const cast = await productionResultApi.registerCasting({ productionPlanId: planId, heatLotId: heat.id, outputQty: 10, startedAt: '2026-10-07T16:20:00+09:00', completedAt: '2026-10-07T19:30:00+09:00', productionResultId: started.productionResultId });
    expect(cast.outputLotNos).toHaveLength(10);
    expect(cast.outputLotNos.every((no) => lotOf(no).surplusAt === null)).toBe(true); // 판정 전에는 여재가 아니다 (검사 합격 뒤 여재)
    expect((await productionResultApi.work(planId)).plan.productionPlanStatus).toBe('COMPLETED');
    at('2026-10-08T09:00:00+09:00');
    for (const no of cast.outputLotNos) await inspectViaApi(lotOf(no).id);
    expect((await inspectViaApi(heat.id)).autoReservedQty).toBe(0); // 연결이 끊긴 계획 → 자동 예약 없음
    as('sales');
    const surplus = (await inventoryApi.listSurplus()).find((r) => r.itemCode === SLAB_A);
    expect(surplus?.lots.filter((l) => cast.outputLotNos.includes(l.lotNo))).toHaveLength(10);
    expect(surplus?.surplusQty).toBe(16); // 시드 여재 6 + 새 여재 10
    expectClean();

    // 진행 중 출하요청이 있으면 SO-004 (시드 SO-2609-002 · DR-2609-0002 배정 대기)
    await expect(salesOrderApi.cancel({ salesOrderId: salesOrderIdOf('SO-2609-002'), cancelReason: '시험' })).rejects.toMatchObject({ code: 'SO-004' });
  });

  it('메신저: 업무방 첨부·안 읽은 수·멘션 알림·ERP 화면 이동', async () => {
    at('2026-10-01T09:00:00+09:00');
    as('sales');
    const room = (await messengerApi.listRooms()).find((r) => r.chatRoomType === 'WORK' && r.chatRoomName === 'SO-2609-003 다온건설');
    if (!room) throw new Error('업무방 시드 없음');
    const salesOrderId = salesOrderIdOf('SO-2609-003');
    expect(room.salesOrder).toMatchObject({ id: salesOrderId, salesOrderNo: 'SO-2609-003' });
    const productionId = idOf('productionHead');
    as('productionHead');
    const unreadBefore = await messengerApi.countUnread(productionId);

    as('sales');
    const dataUrl = `data:text/plain;base64,${btoa('coil schedule')}`;
    const sent = await messengerApi.sendMessage({ chatRoomId: room.id, content: '@강민석 SO-2609-003 코일 일정 확인 부탁해요', file: { name: '일정.txt', size: 13, mimeType: 'text/plain', dataUrl } });
    expect(sent.file).toEqual({ name: '일정.txt', size: 13, mimeType: 'text/plain' });
    expect(sent.erpLinks).toEqual([{ text: 'SO-2609-003', href: `/sales-orders/${salesOrderId}` }]);

    // 멘션 받은 사람은 MENTION 한 번, 다른 멤버는 업무방 메시지 알림
    as('productionHead');
    expect(await messengerApi.countUnread(productionId)).toBe(unreadBefore + 1);
    const mentions = (await notificationApi.list()).items.filter((n) => n.notificationType === 'MENTION');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].linkPath).toBe(`/messenger?room=${room.id}`);
    const page = await messengerApi.listMessages({ chatRoomId: room.id });
    const mine = page.items.find((m) => m.id === sent.id);
    expect(mine).toMatchObject({ mentionsMe: true, erpLinks: [{ text: 'SO-2609-003', href: `/sales-orders/${salesOrderId}` }] });
    expect(await messengerApi.getFile({ messageId: sent.id, fileName: '' })).toEqual({ name: '일정.txt', mimeType: 'text/plain', dataUrl });
    expect(await messengerApi.markRead({ chatRoomId: room.id, lastMessageId: sent.id })).toBe(0);
    as('purchase');
    expect((await notificationApi.list()).items.filter((n) => n.notificationType === 'WORK_ROOM_MESSAGE').map((n) => n.title)).toContain('SO-2609-003 다온건설 새 메시지');
    // ERP 링크를 눌러 수주 상세를 연다 (수주 화면 권한이 있으면 상세가 열린다)
    as('productionHead');
    expect((await salesOrderApi.detail(salesOrderId)).salesOrderNo).toBe('SO-2609-003');
    // 멤버가 아니면 첨부를 받을 수 없다
    as('logistics');
    await expect(messengerApi.getFile({ messageId: sent.id, fileName: '' })).rejects.toMatchObject({ code: 'COM-002' });
  });
});
