// 업무 프로세스 14.3 요구사항별 필수 검증 — P1 줄마다 화면 api로 확인한다.
// 14.1·14.2 흐름 안에서 이미 확인한 줄(PUR-002, 부분 입고·재시도, 합금철 소요, 부분 출고, 출고 재시도·PDF, 합격 생산분 자동 예약,
// 열연·판매 같은 슬래브)은 demo141/demo142 시험이 맡는다. 결과 표는 docs/rework/areas/scenario.md.
import { describe, expect, it } from 'vitest';
import { actionDraftApi } from '@/api/actionDrafts';
import { InputError } from '@/api/client';
import { dispositionApi } from '@/api/dispositions';
import { goodsIssueApi } from '@/api/goodsIssues';
import { inspectionApi } from '@/api/inspections';
import { inventoryApi } from '@/api/inventories';
import { masterDataApi } from '@/api/masterData';
import { messengerApi } from '@/api/messenger';
import { productionResultApi } from '@/api/productionResults';
import { salesOrderApi } from '@/api/salesOrders';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import { resetToSeed } from '@/mock/db';
import { as, at, customerIdOf, expectClean, inspectViaApi, itemIdOf, lotOf, planIdOf, readDb, salesOrderIdOf, soItemIdsOf, useScenarioClock } from '@/api/scenario/scenarioKit';

const SLAB_A = 'SL-SS275-250x1200x10000';

describe('14.3 요구사항별 필수 검증 (P1, 화면 api)', () => {
  useScenarioClock();

  it('SO-002: 23.550t 규격 10매는 허용·235.500t 계산 표시·톤 저장 안 함, 10.5·0·음수·누락은 SO-002', async () => {
    at('2026-10-01T09:00:00+09:00');
    as('sales');
    const itemId = itemIdOf(SLAB_A);
    expect((await salesOrderApi.preview([{ itemId, orderedQty: '10' }]))[0]).toMatchObject({ orderedQty: 10, weightTon: '235.500' });
    for (const bad of ['10.5', 0, -1, '', '3매'] as const) {
      await expect(salesOrderApi.preview([{ itemId, orderedQty: bad }]), String(bad)).rejects.toMatchObject({ code: 'SO-002' });
      await expect(salesOrderApi.create({ customerId: customerIdOf('CUS-01'), items: [{ itemId, orderedQty: bad, dueDate: '2026-10-20' }] }), String(bad)).rejects.toMatchObject({ code: 'SO-002' });
    }
    const created = await salesOrderApi.create({ customerId: customerIdOf('CUS-01'), items: [{ itemId, orderedQty: '10', dueDate: '2026-10-20' }] });
    expect((await salesOrderApi.detail(created.salesOrderId)).totalOrderedTon).toBe('235.500');
    const row = readDb((t) => t.salesOrderItem.find((i) => i.salesOrderId === created.salesOrderId));
    expect(row?.orderedQty).toBe(10);
    expect(Object.keys(row ?? {}).some((key) => key.toLowerCase().includes('ton'))).toBe(false);
  });

  it('MST-003: 쓰인 규격의 치수 수정은 MST-002와 새 규격 추가 안내 / MST-004: 코일이 슬래브보다 무거우면 매핑 거부', async () => {
    as('admin');
    const specs = await masterDataApi.listProductSpecs();
    const used = specs.find((s) => s.itemCode === SLAB_A);
    if (!used) throw new Error('규격 시드 없음');
    expect(used.isUsed).toBe(true);
    await expect(
      masterDataApi.updateProductSpec({ id: used.id, steelGradeId: used.steelGradeId, thicknessMm: '240', widthMm: used.widthMm, lengthMm: used.lengthMm, defaultYardId: used.defaultYardId, expectedUpdatedAt: used.updatedAt }),
    ).rejects.toMatchObject({ code: 'MST-002', detail: expect.stringContaining('새 규격') });

    const yardOf = async (yardType: 'SLAB' | 'COIL') => (await masterDataApi.listYards()).find((y) => y.yardType === yardType)?.id ?? null;
    const slabId = await masterDataApi.createProductSpec({ itemType: 'SLAB', steelGradeId: used.steelGradeId, thicknessMm: '100', widthMm: '1000', lengthMm: '1000', defaultYardId: await yardOf('SLAB') });
    const coilId = await masterDataApi.createProductSpec({ itemType: 'COIL', steelGradeId: used.steelGradeId, thicknessMm: '10', widthMm: '1500', lengthMm: '100000', defaultYardId: await yardOf('COIL') });
    await expect(masterDataApi.createSpecMapping({ slabItemId: slabId, coilItemId: coilId })).rejects.toBeInstanceOf(InputError);
    expect((await masterDataApi.listSpecMappings()).some((m) => m.slab.id === slabId)).toBe(false);
  });

  it('INV-009: 같은 규격을 동시에 수주해도 ACTIVE 예약 합계 ≤ 가용재고', async () => {
    at('2026-10-01T09:00:00+09:00');
    as('sales');
    const itemId = itemIdOf(SLAB_A);
    const createSalesOrder = () => salesOrderApi.create({ customerId: customerIdOf('CUS-02'), items: [{ itemId, orderedQty: 5, dueDate: '2026-10-25' }] });
    const results = await Promise.all([createSalesOrder(), createSalesOrder(), createSalesOrder()]);
    expect(results.reduce((sum, r) => sum + r.reservedQty, 0)).toBe(6);
    expect(results.reduce((sum, r) => sum + r.shortageQty, 0)).toBe(15 - 6);
    expect((await inventoryApi.listProducts()).find((r) => r.itemCode === SLAB_A)).toMatchObject({ reservedQty: 6, availableQty: 0 });
    expectClean();
  });

  it('INV-003·007, SHP-002: 미합격 히트 하위 제품은 예약·배정·출고가 막힌다', async () => {
    at('2026-10-01T09:00:00+09:00');
    // 예약: 시드 SPHC 히트 불합격 10매는 예약 가용에 들지 않는다
    as('sales');
    const sphc = await salesOrderApi.create({ customerId: customerIdOf('CUS-04'), items: [{ itemId: itemIdOf('SL-SPHC-220x1400x9500'), orderedQty: 2, dueDate: '2026-10-25' }] });
    expect(sphc).toMatchObject({ reservedQty: 0, shortageQty: 2 });

    // 배정 확정 뒤 히트가 불합격이 되면 배정이 풀리고, 그 히트 슬래브는 다시 배정·출고할 수 없다
    const drId = readDb((t) => t.shipmentRequest.find((r) => r.shipmentRequestNo === 'DR-2609-0002')?.id) ?? 0;
    const dr = await shipmentRequestApi.detail(drId);
    const lotIds = dr.lines[0].recommendedLots.map((l) => l.lotId);
    await shipmentRequestApi.confirmAllocations({ shipmentRequestId: drId, lines: [{ shipmentRequestItemId: dr.lines[0].shipmentRequestItemId, lotIds }] });
    as('logistics');
    expect((await goodsIssueApi.detail(drId)).ready).toBe(true);
    const heatId = readDb((t) => t.lot.find((l) => l.id === lotIds[0])?.heatLotId) ?? 0;
    at('2026-10-01T10:00:00+09:00');
    const failed = await inspectViaApi(heatId, { P: '0.050' });
    expect(failed.inspectionResult).toBe('FAIL');
    expect(failed.excludedLotQty).toBeGreaterThan(0);
    as('logistics');
    const check = await goodsIssueApi.detail(drId);
    expect(check.ready).toBe(false);
    await expect(goodsIssueApi.confirm({ shipmentRequestId: drId })).rejects.toMatchObject({ code: 'INV-001' });
    as('sales');
    const after = await shipmentRequestApi.detail(drId);
    expect(after.shipmentRequestStatus).toBe('REQUESTED');
    const failedLot = lotIds.find((id) => readDb((t) => t.lot.find((l) => l.id === id)?.heatLotId) === heatId) ?? 0;
    expect(after.lines[0].candidateLots.map((l) => l.lotId)).not.toContain(failedLot);
    await expect(shipmentRequestApi.confirmAllocations({ shipmentRequestId: drId, lines: [{ shipmentRequestItemId: after.lines[0].shipmentRequestItemId, lotIds: [failedLot] }] })).rejects.toMatchObject({ code: 'INV-002' });
    expect(readDb((t) => t.businessEvent.some((e) => e.businessEventType === 'ALLOCATION_RELEASED' && e.reasonCode === 'QUALITY_FAILURE'))).toBe(true);
    expectClean();
  });

  it('QC-004: 불합격 처리 상태는 상태·사유만 기록하고 재고 처리는 하지 않는다', async () => {
    at('2026-10-01T09:00:00+09:00');
    as('quality');
    const lot = lotOf('HT-BOF1-260914-001-03'); // 시드 표면 불합격
    const inventoryBefore = await inventoryApi.listProducts();
    await expect(dispositionApi.set({ lotId: lot.id, dispositionStatus: 'HOLD', dispositionReason: ' ' })).rejects.toBeInstanceOf(InputError);
    await expect(dispositionApi.set({ lotId: lotOf('HT-BOF1-260914-001-01').id, dispositionStatus: 'HOLD', dispositionReason: '합격 LOT' })).rejects.toBeInstanceOf(InputError);
    await dispositionApi.set({ lotId: lot.id, dispositionStatus: 'HOLD', dispositionReason: '재검사 대기', expectedUpdatedAt: lot.updatedAt });
    const row = (await dispositionApi.list()).find((r) => r.lotId === lot.id);
    expect(row).toMatchObject({ reason: 'FAILED', dispositionStatus: 'HOLD', dispositionReason: '재검사 대기', lotStatus: 'AVAILABLE' });
    expect(await inventoryApi.listProducts()).toEqual(inventoryBefore);
    expect(readDb((t) => t.businessEvent.filter((e) => e.businessEventType === 'DISPOSITION_SET' && e.targetId === lot.id))).toHaveLength(1);
    as('sales'); // 처리 상태 지정 권한 없음
    await expect(dispositionApi.set({ lotId: lot.id, dispositionStatus: 'SCRAPPED', dispositionReason: '폐기' })).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('ACT-001~003: 메시지 초안 반려는 REJECTED, 같은 메시지로 새 초안을 다시 만들 수 있다', async () => {
    at('2026-10-02T09:00:00+09:00');
    as('purchase');
    const room = (await messengerApi.listRooms()).find((r) => r.chatRoomName === 'SO-2609-003 다온건설');
    if (!room) throw new Error('업무방 시드 없음');
    const message = await messengerApi.sendMessage({ chatRoomId: room.id, content: '석회석 30톤 10월 25일까지 필요해요' });
    const draft = await actionDraftApi.createFromMessage({ messageId: message.id });
    expect(draft.created).toBe(true);
    await expect(actionDraftApi.reject({ actionDraftId: draft.id, rejectReason: '' })).rejects.toBeInstanceOf(InputError);
    expect((await actionDraftApi.reject({ actionDraftId: draft.id, rejectReason: '이번 달 재고로 충분' })).draftStatus).toBe('REJECTED');
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toBeInstanceOf(InputError);
    expect(readDb((t) => t.purchaseRequisition.some((p) => p.actionDraftId === draft.id))).toBe(false);
    const again = await actionDraftApi.createFromMessage({ messageId: message.id });
    expect(again).toMatchObject({ created: true });
    expect(again.id).not.toBe(draft.id);
    expect(readDb((t) => t.businessEvent.filter((e) => e.actionDraftId === draft.id).map((e) => e.businessEventType))).toEqual(['DRAFT_CREATED', 'DRAFT_REJECTED']);
  });

  it('PRD-007: 연주 시드 손실 — 계획 수율 고정, 손실률 0~5%, 같은 시드·같은 상태면 같은 결과', async () => {
    const run = async () => {
      at('2026-10-01T12:00:00+09:00');
      as('steelmaking');
      return productionResultApi.simulate({ productionPlanId: planIdOf('PP-2609-0004'), randomSeed: 777 });
    };
    const first = await run();
    const casting = first.steps.find((s) => s.processType === 'CONTINUOUS_CASTING');
    expect(casting?.plannedQty).toBe(10); // floor(250 × 0.98 ÷ 23.550)
    expect(Number(casting?.sampleLossRate)).toBeGreaterThanOrEqual(0);
    expect(Number(casting?.sampleLossRate)).toBeLessThanOrEqual(0.05);
    expect(casting?.lossQty).toBe(Math.floor(10 * Number(casting?.sampleLossRate)));
    const work = await productionResultApi.work(planIdOf('PP-2609-0004'));
    expect(work.plan.results.find((r) => r.processType === 'CONTINUOUS_CASTING')).toMatchObject({ isSimulated: true, randomSeed: 777, sampleLossRate: casting?.sampleLossRate });
    resetToSeed();
    const second = await run();
    expect(second.steps.map((s) => [s.processType, s.plannedQty, s.sampleLossRate, s.lossQty, s.outputQty, s.outputLotNos])).toEqual(
      first.steps.map((s) => [s.processType, s.plannedQty, s.sampleLossRate, s.lossQty, s.outputQty, s.outputLotNos]),
    );
    // 검사 입력 화면에 갓 연주한 슬래브가 판정 대기로 들어온다
    as('quality');
    expect((await inspectionApi.queue()).filter((r) => casting?.outputLotNos.includes(r.lotNo)).every((r) => r.inspectionResult === 'PENDING')).toBe(true);
    // 수주 쪽은 그대로 (자동 예약은 검사 합격 뒤)
    as('sales');
    const [, slabItemId] = soItemIdsOf(salesOrderIdOf('SO-2609-003'));
    expect((await salesOrderApi.detail(salesOrderIdOf('SO-2609-003'))).items.find((i) => i.salesOrderItemId === slabItemId)?.activeReservedQty).toBe(0);
    expectClean();
  });
});
