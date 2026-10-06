// 업무 프로세스 14.1 P1 슬래브 수주 전체 흐름 (1~10단계)을 화면 api 함수로 끝까지 돌린다.
// 사원은 단계마다 맡은 역할로 바꾼다(actAs): 영업 박서영 → 생산 강민석 → 구매 정다은·부서장 최준혁 → 제강 조은서 → 품질 서민지 → 영업 → 물류 권예진.
import { describe, expect, it } from 'vitest';
import { actionDraftApi } from '@/api/actionDrafts';
import { approvalApi } from '@/api/approvals';
import { businessEventApi } from '@/api/businessEvents';
import { InputError } from '@/api/client';
import { goodsIssueApi } from '@/api/goodsIssues';
import { goodsReceiptApi } from '@/api/goodsReceipts';
import { inspectionApi } from '@/api/inspections';
import { inventoryApi } from '@/api/inventories';
import { lotTraceApi } from '@/api/lotTrace';
import { messengerApi } from '@/api/messenger';
import { millSheetApi } from '@/api/millSheets';
import { mrpApi } from '@/api/mrp';
import { notificationApi } from '@/api/notifications';
import { productionPlanApi } from '@/api/production';
import { productionResultApi } from '@/api/productionResults';
import { purchaseOrderApi, purchaseRequisitionApi } from '@/api/purchasing';
import { salesOrderApi } from '@/api/salesOrders';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import { decDiv, decMul } from '@/lib/decimal';
import { as, at, customerIdOf, expectClean, idOf, inspectViaApi, itemIdOf, lotOf, lotsOfPlan, readDb, salesOrderIdOf, soItemIdsOf, useScenarioClock } from '@/api/scenario/scenarioKit';

const SLAB_A = 'SL-SS275-250x1200x10000';

describe('14.1 P1 슬래브 수주 전체 흐름 (화면 api)', () => {
  useScenarioClock();

  it('1~10단계를 새 시드에서 끝까지', async () => {
    const customerId = customerIdOf('CUS-01');
    const slabItemId = itemIdOf(SLAB_A);

    // ── 시작: 1매 23.550t, 합격 가용 6매 ─────────────────────────
    at('2026-10-01T09:00:00+09:00');
    as('sales');
    const [preview] = await salesOrderApi.preview([{ itemId: slabItemId, orderedQty: 10 }]);
    expect(preview).toMatchObject({ theoreticalWeightTon: '23.550', weightTon: '235.500', availableQty: 6, reserveQty: 6, shortageQty: 4 });
    expect(preview.formation).toMatchObject({ heatCount: 1 });
    expect((await inventoryApi.listProducts()).find((r) => r.itemCode === SLAB_A)).toMatchObject({ availableQty: 6 });

    // ── 1. 10매 수주 → 6매 ACTIVE 예약 + 부족 4매 생산계획 ─────────
    const created = await salesOrderApi.create({ customerId, items: [{ itemId: slabItemId, orderedQty: 10, dueDate: '2026-10-20' }] });
    expect(created).toMatchObject({ salesOrderNo: 'SO-2610-001', reservedQty: 6, shortageQty: 4, productionPlanNos: ['PP-2610-0001'] });
    const salesOrderId = created.salesOrderId;
    const [soItemId] = soItemIdsOf(salesOrderId);
    expect(Object.keys(readDb((t) => t.salesOrderItem.find((i) => i.id === soItemId)) ?? {})).not.toContain('orderedTon'); // 톤은 저장하지 않는다
    let detail = await salesOrderApi.detail(salesOrderId);
    expect(detail.items[0]).toMatchObject({ orderedQty: 10, orderedTon: '235.500', activeReservedQty: 6, plannedQty: 4 });
    expect(detail.items[0].shortage).toMatchObject({ unshippedQty: 10, unsecuredQty: 4, additionalPlanQty: 0, reproductionNeedQty: 0 });
    expect(detail.reservations.map((r) => [r.reservedQty, r.reservationStatus])).toEqual([[6, 'ACTIVE']]);
    let timeline = await salesOrderApi.timeline(salesOrderId);
    expect(timeline.find((e) => e.businessEventType === 'RESERVATION_CREATED')).toMatchObject({ actorType: 'SYSTEM', reasonCode: 'STOCK_FIRST' });
    expect(timeline.find((e) => e.businessEventType === 'PRODUCTION_PLAN_CREATED')).toMatchObject({ reasonCode: 'ORDER_SHORTAGE' });
    expectClean();

    // ── 2. 히트 편성: 히트 전체 톤과 수주 목표를 나눠 보인다 ─────────
    as('productionHead');
    const plans = await productionPlanApi.list();
    const planId = plans.find((p) => p.productionPlanNo === 'PP-2610-0001')?.id ?? 0;
    const plan = await productionPlanApi.detail(planId);
    expect(plan).toMatchObject({ productionPlanStatus: 'PLANNED', canCancel: true });
    expect(plan.formation).toMatchObject({ shortageQty: 4, heatCount: 1, cumulativeYieldRate: '0.9800', requiredSteelTon: '96.122', targetWeightTon: '94.200', heatTon: '250.000', heatCapacityTon: '250.000', slabQtyPerHeat: 10, plannedSlabQty: 10, expectedSurplusSlabQty: 6 });
    expect(plan.heats).toHaveLength(1);
    as('sales');
    expect((await salesOrderApi.productionLinks(salesOrderId)).map((l) => l.plan.productionPlanNo)).toEqual(['PP-2610-0001']);

    // ── 3. MRP 부족 원료 → 구매요청 → 부서장 승인 → 공급업체별 발주 → 부분 입고 ──
    as('purchase');
    const period = { from: '2026-10-01', to: '2026-10-31' };
    let mrp = await mrpApi.requirements(period);
    expect(mrp.plans.map((p) => [p.productionPlanNo, p.remainingHeatCount, p.heatTon, p.requiredHotMetalTon])).toEqual([['PP-2610-0001', 1, '250.000', '277.778']]);
    const byCode = Object.fromEntries(mrp.materials.map((m) => [m.itemCode, m]));
    expect(byCode.ORE01).toMatchObject({ grossTon: '444.445', netTon: '0.000' });
    expect(byCode.SMN01).toMatchObject({ consumptionUnit: 'kg/t', grossTon: '2.500', onHandTon: '1.000', scheduledReceiptTon: '3.500', netTon: '1.500' });
    // 합금철 소요 = 히트 톤 × kg/t ÷ 1,000 (14.3)
    const smnRate = readDb((t) => t.specificConsumption.find((c) => c.itemId === itemIdOf('SMN01') && c.steelGradeId === t.item.find((i) => i.id === slabItemId)?.steelGradeId)?.consumptionRate) ?? '0';
    expect(byCode.SMN01.grossTon).toBe(decDiv(decMul('250.000', smnRate, 6), 1000, 3));
    expect(mrp.requisitionLines).toEqual([expect.objectContaining({ productionPlanId: planId, itemCode: 'SMN01', netTon: '1.500', needDate: '2026-10-20', existingPurchaseRequisitionNo: null })]);
    const line = mrp.requisitionLines[0];

    at('2026-10-01T10:00:00+09:00');
    const pr = await purchaseRequisitionApi.create({ desiredReceiptDate: '2026-10-10', requestReason: 'MRP 합금철 부족', itemId: line.itemId, requestedTon: line.netTon, productionPlanId: line.productionPlanId });
    expect(pr).toMatchObject({ purchaseRequisitionNo: 'PR-2610-0001', purchaseRequisitionStatus: 'WAITING_APPROVAL', source: 'MRP' });
    await expect(purchaseRequisitionApi.create({ desiredReceiptDate: '', requestReason: '', itemId: line.itemId, requestedTon: '1.000', productionPlanId: planId })).rejects.toBeInstanceOf(InputError);
    expect((await mrpApi.requirements(period)).requisitionLines[0].existingPurchaseRequisitionNo).toBe('PR-2610-0001');
    expect((await purchaseOrderApi.candidateItems()).some((i) => i.purchaseRequisitionId === pr.id)).toBe(false);
    await expect(purchaseOrderApi.create({ purchaseRequisitionItemIds: readDb((t) => t.purchaseRequisitionItem.filter((i) => i.purchaseRequisitionId === pr.id).map((i) => i.id)), dueDate: '' })).rejects.toMatchObject({ code: 'PUR-002' });

    as('salesHead'); // 다른 부서 부서장은 승인할 수 없다
    await expect(approvalApi.approve({ purchaseRequisitionId: pr.id, expectedUpdatedAt: pr.updatedAt })).rejects.toMatchObject({ code: 'COM-002' });
    as('purchaseHead');
    expect((await approvalApi.inbox()).map((r) => r.purchaseRequisitionNo)).toContain('PR-2610-0001');
    expect((await notificationApi.list()).items.some((n) => n.notificationType === 'APPROVAL_REQUESTED' && n.title.includes('PR-2610-0001'))).toBe(true);
    at('2026-10-01T10:30:00+09:00');
    expect(await approvalApi.approve({ purchaseRequisitionId: pr.id, expectedUpdatedAt: pr.updatedAt })).toMatchObject({ purchaseRequisitionStatus: 'APPROVED' });
    as('purchase');
    expect((await notificationApi.list()).items.some((n) => n.notificationType === 'APPROVAL_RESULT' && n.title.includes('PR-2610-0001'))).toBe(true);
    const candidate = (await purchaseOrderApi.candidateItems()).find((i) => i.purchaseRequisitionId === pr.id);
    expect(candidate?.supplierName).toBe(readDb((t) => t.supplier.find((s) => s.supplierCode === 'SUP-04')?.supplierName));
    at('2026-10-01T11:00:00+09:00');
    const [po] = await purchaseOrderApi.create({ purchaseRequisitionItemIds: [candidate?.id ?? 0], dueDate: '' });
    expect(po).toMatchObject({ purchaseOrderNo: 'PO-2610-0001', purchaseOrderStatus: 'CONFIRMED', dueDate: '2026-10-10' });
    expect((await purchaseRequisitionApi.detail(pr.id)).purchaseRequisitionStatus).toBe('ORDERED');
    expect((await mrpApi.requirements(period)).materials.find((m) => m.itemCode === 'SMN01')?.netTon).toBe('0.000');

    const poLineId = po.items[0].id;
    at('2026-10-02T09:00:00+09:00');
    await expect(goodsReceiptApi.receive({ purchaseOrderItemId: poLineId, receivedTon: '1.501', receiptDate: '2026-10-02' })).rejects.toMatchObject({ code: 'PUR-003' });
    const first = await goodsReceiptApi.receive({ purchaseOrderItemId: poLineId, receivedTon: '1.000', receiptDate: '2026-10-02' });
    expect(first).toMatchObject({ lotNo: 'RM-SMN01-261002-001', purchaseOrderStatus: 'PARTIALLY_RECEIVED', lineReceivedTon: '1.000', lineScheduledReceiptTon: '0.500' });
    // 확정 재시도(같은 1t을 한 번 더): 미입고량 초과로 막히고 LOT이 늘지 않는다
    const lotCountBefore = readDb((t) => t.lot.length);
    await expect(goodsReceiptApi.receive({ purchaseOrderItemId: poLineId, receivedTon: '1.000', receiptDate: '2026-10-02' })).rejects.toMatchObject({ code: 'PUR-003' });
    expect(readDb((t) => t.lot.length)).toBe(lotCountBefore);
    at('2026-10-03T08:00:00+09:00');
    const second = await goodsReceiptApi.receive({ purchaseOrderItemId: poLineId, receivedTon: '0.500', receiptDate: '2026-10-03' });
    expect(second).toMatchObject({ lotNo: 'RM-SMN01-261003-001', purchaseOrderStatus: 'RECEIVED', lineReceivedTon: '1.500', lineScheduledReceiptTon: '0.000' });
    expect(readDb((t) => t.lot.find((l) => l.id === first.lotId))).toMatchObject({ lotType: 'RAW_MATERIAL', remainingTon: '1.000', producedDate: '2026-10-02' });
    expectClean();

    // ── 4. 실적 시뮬레이션: 제선·제강·연주 실적과 LOT 관계 ──────────
    at('2026-10-03T18:00:00+09:00');
    as('steelmaking');
    const simulated = await productionResultApi.simulate({ productionPlanId: planId, randomSeed: 42 });
    expect(simulated.randomSeed).toBe(42);
    expect(simulated.steps.map((s) => s.processType)).toEqual(['IRONMAKING', 'STEELMAKING', 'CONTINUOUS_CASTING']);
    const casting = simulated.steps[2];
    expect(casting.plannedQty).toBe(10);
    expect(Number(casting.sampleLossRate)).toBeGreaterThanOrEqual(0);
    expect(Number(casting.sampleLossRate)).toBeLessThanOrEqual(0.05);
    expect(casting.outputQty).toBe(10 - Math.floor(10 * Number(casting.sampleLossRate)));
    const heat = lotOf('HT-BOF1-261003-001');
    const slabs = lotsOfPlan(planId, 'SLAB');
    expect(slabs[0].lotNo).toBe('HT-BOF1-261003-001-01');
    const work = await productionResultApi.work(planId);
    expect(work.plan.productionPlanStatus).toBe('COMPLETED');
    expect(work.plan.results.every((r) => r.isSimulated && r.randomSeed === 42)).toBe(true);
    // 슬래브 → 히트 → 용선(실제 투입) → 원료(기간 기반) + 합금철(실제 투입)
    const backward = await lotTraceApi.trace({ lotNo: slabs[0].lotNo, direction: 'backward' });
    const nodeOf = (lotId: number) => backward.nodes.find((n) => n.id === lotId);
    const hotMetal = backward.nodes.find((n) => n.lotType === 'HOT_METAL');
    expect(hotMetal?.lotNo).toBe('HM-BF2-261003-01');
    const rawToHm = backward.edges.filter((e) => e.childLotId === hotMetal?.id);
    expect(rawToHm.length).toBeGreaterThan(0);
    expect(rawToHm.every((e) => e.lotRelationEvidence === 'PERIOD_BASED' && e.periodStartedAt !== null && e.periodEndedAt !== null)).toBe(true);
    const intoHeat = backward.edges.filter((e) => e.childLotId === heat.id);
    expect(intoHeat.every((e) => e.lotRelationEvidence === 'ACTUAL_INPUT')).toBe(true);
    expect(intoHeat.filter((e) => nodeOf(e.parentLotId)?.itemCode === 'SMN01').map((e) => e.inputTon)).toEqual(['1.000', '1.000', '0.500']); // 입고일 FIFO
    expectClean();

    // ── 5. 검사값으로 자동 판정 → 합격 생산분은 원래 수주에 자동 예약, 같은 히트 여재가 먼저 채운다 ──
    at('2026-10-04T09:00:00+09:00');
    expect((await inspectViaApi(slabs[0].id, { SURFACE_DEFECT_DEPTH: '2.10' })).inspectionResult).toBe('FAIL');
    for (const slab of slabs.slice(1)) await inspectViaApi(slab.id);
    as('sales');
    expect((await salesOrderApi.detail(salesOrderId)).items[0].activeReservedQty).toBe(6); // 히트 판정 전에는 예약하지 않는다
    at('2026-10-04T10:00:00+09:00');
    const heatOutcome = await inspectViaApi(heat.id, { C: '0.21', SI: '0.25', MN: '1.10', P: '0.025', S: '0.010' });
    expect(heatOutcome).toMatchObject({ inspectionResult: 'PASS', autoReservedQty: 4 });
    expect(heatOutcome.surplusLotNos).toHaveLength(slabs.length - 1 - 4);
    expect(heatOutcome.salesOrderItem?.shortage).toMatchObject({ activeReservedQty: 10, unsecuredQty: 0, reproductionNeedQty: 0 });
    timeline = (as('sales'), await salesOrderApi.timeline(salesOrderId));
    expect(timeline.filter((e) => e.businessEventType === 'RESERVATION_CREATED').map((e) => e.actorType)).toEqual(['SYSTEM', 'SYSTEM']);
    // 같은 히트의 합격 슬래브 하나가 뒤늦게 불합격이 돼도 그 히트 여재가 채워 예약 10매 그대로
    at('2026-10-04T11:00:00+09:00');
    await inspectViaApi(slabs[slabs.length - 1].id, { SURFACE_DEFECT_DEPTH: '2.50' });
    as('sales');
    detail = await salesOrderApi.detail(salesOrderId);
    expect(detail.items[0]).toMatchObject({ activeReservedQty: 10, securedQty: 10 });
    expectClean();

    // ── 6. 여재·진행 계획으로 충분하면 재생산 계획을 만들지 않는다 ─────
    at('2026-10-04T12:00:00+09:00');
    as('productionHead');
    expect((await productionPlanApi.detail(planId)).reproduction).toMatchObject({ reproductionNeedQty: 0, additionalPlanQty: 0, unsecuredQty: 0 }) // 화면은 additionalPlanQty > 0일 때만 버튼을 보인다;
    await expect(productionPlanApi.createReproduction({ salesOrderItemId: soItemId })).rejects.toBeInstanceOf(InputError);
    expect((await productionPlanApi.list()).filter((p) => p.isReproduction)).toHaveLength(0);
    // 대조: 시드 SO-2609-005(히트 불합격으로 8매 미확보, SPHC 여재 없음)는 재생산이 필요할 때만 만든다
    const [sphcItemId] = soItemIdsOf(salesOrderIdOf('SO-2609-005'));
    const reproduction = await productionPlanApi.createReproduction({ salesOrderItemId: sphcItemId });
    expect(reproduction).toMatchObject({ reservedFromSurplusQty: 0, plan: { productionPlanNo: 'PP-2610-0002', shortageQty: 8 } });
    await expect(productionPlanApi.createReproduction({ salesOrderItemId: sphcItemId })).rejects.toBeInstanceOf(InputError); // 진행 계획이 생겨 더 필요 없다

    // ── 7. 출하요청: LOT 10개를 FIFO(생산완료일 → LOT 번호)로 추천·확정 ──
    at('2026-10-05T09:00:00+09:00');
    as('sales');
    expect((await shipmentRequestApi.shippableItems(customerId)).find((i) => i.salesOrderItemId === soItemId)).toMatchObject({ shippableQty: 10 });
    const dr1 = await shipmentRequestApi.create({ customerId, requestedShipDate: '2026-10-06', items: [{ salesOrderItemId: soItemId, requestQty: '4' }] });
    expect(dr1.shipmentRequestNo).toBe('DR-2610-0001');
    expect(dr1.recommendation[0].recommendedLots.map((l) => l.lotNo)).toEqual(['HT-BOF1-260905-001-05', 'HT-BOF1-260905-001-06', 'HT-BOF1-260905-001-07', 'HT-BOF1-260905-001-08']);
    const dr1Detail = await shipmentRequestApi.detail(dr1.id);
    await shipmentRequestApi.confirmAllocations({ shipmentRequestId: dr1.id, lines: [{ shipmentRequestItemId: dr1Detail.lines[0].shipmentRequestItemId, lotIds: dr1Detail.lines[0].recommendedLots.map((l) => l.lotId) }] });
    await expect(shipmentRequestApi.create({ customerId, requestedShipDate: '2026-10-08', items: [{ salesOrderItemId: soItemId, requestQty: '7' }] })).rejects.toMatchObject({ code: 'SHP-002' });
    const dr2 = await shipmentRequestApi.create({ customerId, requestedShipDate: '2026-10-08', items: [{ salesOrderItemId: soItemId, requestQty: '6' }] });
    const dr2Detail = await shipmentRequestApi.detail(dr2.id);
    expect(dr2Detail.lines[0].recommendedLots.map((l) => l.lotNo)).toEqual([
      'HT-BOF1-260905-001-09',
      'HT-BOF1-260905-001-10',
      'HT-BOF1-261003-001-02',
      'HT-BOF1-261003-001-03',
      'HT-BOF1-261003-001-04',
      'HT-BOF1-261003-001-05',
    ]);
    const confirmed2 = await shipmentRequestApi.confirmAllocations({ shipmentRequestId: dr2.id, lines: [{ shipmentRequestItemId: dr2Detail.lines[0].shipmentRequestItemId, lotIds: dr2Detail.lines[0].recommendedLots.map((l) => l.lotId) }] });
    expect(confirmed2).toMatchObject({ confirmedQty: 6, shipmentRequestStatus: 'ALLOCATED' });
    expect((await shipmentRequestApi.detail(dr1.id)).shipmentRequestStatus).toBe('ALLOCATED');
    timeline = await salesOrderApi.timeline(salesOrderId);
    expect(timeline.filter((e) => e.businessEventType === 'ALLOCATION_RECOMMENDED').map((e) => e.reasonCode)).toEqual(['FIFO_RECOMMENDATION', 'FIFO_RECOMMENDATION']);
    expect(timeline.filter((e) => e.businessEventType === 'ALLOCATION_CONFIRMED')).toHaveLength(10);
    expectClean();

    // ── 8. 4매 부분 출고 → CONVERTED 4·ACTIVE 6·부분출하, 나머지 6매 → 전량 전환·출하완료 ──
    at('2026-10-06T10:00:00+09:00');
    as('logistics');
    expect((await goodsIssueApi.detail(dr1.id)).ready).toBe(true);
    const issue1 = await goodsIssueApi.confirm({ shipmentRequestId: dr1.id });
    expect(issue1.millSheets.map((m) => m.millSheetNo)).toEqual(['MS-2610-0001-1']);
    // 출고 재시도: 중복 출고·중복 밀시트 없음
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr1.id })).rejects.toMatchObject({ code: 'COM-001' });
    expect((await millSheetApi.list()).filter((m) => m.shipmentRequestId === dr1.id)).toHaveLength(1);
    as('sales');
    detail = await salesOrderApi.detail(salesOrderId);
    const sumOf = (status: string) => detail.reservations.filter((r) => r.reservationStatus === status).reduce((s, r) => s + r.reservedQty, 0);
    expect([sumOf('CONVERTED'), sumOf('ACTIVE')]).toEqual([4, 6]);
    expect(detail).toMatchObject({ status: 'PARTIALLY_SHIPPED', totalShippedQty: 4 });
    expect(detail.items[0]).toMatchObject({ shippedQty: 4, salesOrderItemStatus: 'PARTIALLY_SHIPPED' });
    expect(detail.cancelBlock).toBe('SO-003');
    at('2026-10-08T10:00:00+09:00');
    as('logistics');
    const issue2 = await goodsIssueApi.confirm({ shipmentRequestId: dr2.id });
    expect(issue2.millSheets.map((m) => m.millSheetNo)).toEqual(['MS-2610-0002-1']);
    as('sales');
    detail = await salesOrderApi.detail(salesOrderId);
    expect([sumOf('CONVERTED'), sumOf('ACTIVE')]).toEqual([10, 0]);
    expect(detail).toMatchObject({ status: 'SHIPPED', totalShippedQty: 10 });
    expect((await salesOrderApi.list()).find((s) => s.id === salesOrderId)?.status).toBe('SHIPPED');
    await expect(salesOrderApi.cancel({ salesOrderId, cancelReason: '고객 요청' })).rejects.toMatchObject({ code: 'SO-003' });
    expectClean();

    // ── 9. 출고별 밀시트 스냅샷·PDF: 기존 재고와 새 생산분의 서로 다른 히트 성분값 ──
    as('logistics');
    const sheets = (await millSheetApi.list()).filter((m) => m.shipmentRequestId === dr1.id || m.shipmentRequestId === dr2.id).sort((a, b) => a.id - b.id);
    expect(sheets.map((m) => m.millSheetNo)).toEqual(['MS-2610-0001-1', 'MS-2610-0002-1']);
    const [a, b] = await Promise.all(sheets.map((m) => millSheetApi.detail(m.id)));
    expect(a.snapshot.heats.map((h) => h.heatNo)).toEqual(['HT-BOF1-260905-001']);
    expect(b.snapshot.heats.map((h) => h.heatNo)).toEqual(['HT-BOF1-260905-001', 'HT-BOF1-261003-001']);
    const carbonOf = (heatNo: string) => b.snapshot.heats.find((h) => h.heatNo === heatNo)?.inspection?.values.find((v) => v.inspectionItemCode === 'C')?.measuredValue;
    expect([carbonOf('HT-BOF1-260905-001'), carbonOf('HT-BOF1-261003-001')]).toEqual(['0.18', '0.21']);
    expect(b.snapshot).toMatchObject({ customer: { customerCode: 'CUS-01' }, totalQty: 6, totalWeightTon: '141.300' });
    expect(b.snapshot.items[0]).toMatchObject({ standardNo: 'KS D 3503:2026', theoreticalWeightTon: '23.550' });
    expect(b.snapshot.items[0].lots.every((l) => l.productInspection?.inspectionResult === 'PASS')).toBe(true);
    expect(b.pdfPath).toBeNull();
    // PDF만 다시: 같은 경로, 밀시트·출고는 그대로
    expect((await millSheetApi.markPdfGenerated({ millSheetId: b.id })).pdfPath).toBe('mill-sheets/MS-2610-0002-1.pdf');
    expect((await millSheetApi.markPdfGenerated({ millSheetId: b.id })).pdfPath).toBe('mill-sheets/MS-2610-0002-1.pdf');
    expect((await millSheetApi.list()).length).toBe(readDb((t) => t.millSheet.length));
    // 밀시트에 들어간 히트는 측정값을 고칠 수 없다
    as('quality');
    expect((await inspectionApi.detail(heat.id)).locked).toBe(true);
    await expect(inspectionApi.register({ lotId: heat.id, values: [] })).rejects.toBeInstanceOf(InputError);

    // ── 10. LOT 정·역추적, 수주 타임라인, Message → ERP 초안 → 요청자 확정 → 부서장 승인 ──
    as('quality');
    const fromShipment = await lotTraceApi.trace({ shipmentRequestNo: dr2.shipmentRequestNo });
    expect(new Set(fromShipment.nodes.filter((n) => n.lotType === 'HEAT').map((n) => n.lotNo))).toEqual(new Set(['HT-BOF1-260905-001', 'HT-BOF1-261003-001']));
    expect(new Set(fromShipment.nodes.filter((n) => n.lotType === 'RAW_MATERIAL').map((n) => n.itemCode))).toEqual(new Set(['ORE01', 'COL01', 'LIM01', 'SMN01']));
    const forward = await lotTraceApi.trace({ lotNo: first.lotNo }); // 원료 LOT은 기본이 정추적
    expect(forward.direction).toBe('forward');
    expect(forward.shipments.map((s) => s.shipmentRequestNo)).toEqual([dr2.shipmentRequestNo]);
    expect(forward.impact?.salesOrders).toEqual([expect.objectContaining({ salesOrderNo: 'SO-2610-001', hasShipped: true })]);
    const slabDetail = await lotTraceApi.detail(lotOf('HT-BOF1-261003-001-03').id);
    expect(slabDetail).toMatchObject({ lotStatus: 'SHIPPED', heatLot: { lotNo: 'HT-BOF1-261003-001' } });
    expect(slabDetail.shipments.map((s) => s.millSheets.map((m) => m.millSheetNo))).toEqual([['MS-2610-0002-1']]);

    as('sales');
    timeline = await salesOrderApi.timeline(salesOrderId);
    const types = new Set(timeline.map((e) => e.businessEventType));
    for (const type of [
      'SALES_ORDER_CREATED',
      'RESERVATION_CREATED',
      'PRODUCTION_PLAN_CREATED',
      'PURCHASE_REQUISITION_CREATED',
      'PURCHASE_REQUISITION_APPROVED',
      'PURCHASE_ORDER_CREATED',
      'GOODS_RECEIPT_CONFIRMED',
      'PRODUCTION_STARTED',
      'PRODUCTION_RESULT_REGISTERED',
      'INSPECTION_REGISTERED',
      'SURPLUS_CONVERTED',
      'SHIPMENT_REQUEST_CREATED',
      'ALLOCATION_RECOMMENDED',
      'ALLOCATION_CONFIRMED',
      'GOODS_ISSUE_CONFIRMED',
      'RESERVATION_CONVERTED',
      'MILL_SHEET_ISSUED',
    ] as const) {
      expect(types.has(type), type).toBe(true);
    }
    expect(timeline.map((e) => e.occurredAt)).toEqual([...timeline.map((e) => e.occurredAt)].sort());
    expect((await businessEventApi.list({ salesOrderId })).items.length).toBe(timeline.length);

    // Message → ERP: 업무방(SO-2609-003 다온건설)의 구매 담당 메시지
    at('2026-10-09T09:00:00+09:00');
    as('purchase');
    const room = (await messengerApi.listRooms()).find((r) => r.chatRoomType === 'WORK' && r.chatRoomName === 'SO-2609-003 다온건설');
    if (!room) throw new Error('업무방 시드 없음');
    const message = (await messengerApi.listMessages({ chatRoomId: room.id })).items.find((m) => m.content === '실리코망가니즈 20톤 10월 20일까지 필요합니다');
    if (!message) throw new Error('시드 메시지 없음');
    as('logistics'); // 구매요청 등록 권한도, 방 멤버도 아니다
    await expect(actionDraftApi.createFromMessage({ messageId: message.id })).rejects.toMatchObject({ code: 'COM-002' });
    as('purchase');
    const draftRef = await actionDraftApi.createFromMessage({ messageId: message.id });
    expect(draftRef.created).toBe(true);
    let draft = await actionDraftApi.get(draftRef.id);
    expect(draft).toMatchObject({ draftStatus: 'WAITING_APPROVAL', actionType: 'PURCHASE_REQUISITION_CREATE', requesterId: idOf('purchase') });
    expect((await actionDraftApi.createFromMessage({ messageId: message.id })).created).toBe(false);
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toMatchObject({ code: 'ACT-001' });
    draft = await actionDraftApi.update({ actionDraftId: draft.id, payload: { itemId: itemIdOf('SMN01'), requiredTon: '20', desiredReceiptDate: '2026-10-20' } });
    as('salesHead'); // 요청자가 아니면 확정할 수 없다
    await expect(actionDraftApi.confirm({ actionDraftId: draft.id })).rejects.toMatchObject({ code: 'COM-002' });
    as('purchase');
    const outcome = await actionDraftApi.confirm({ actionDraftId: draft.id, expectedUpdatedAt: draft.updatedAt });
    expect(outcome).toMatchObject({ executed: true, draft: { draftStatus: 'EXECUTED' } });
    const draftPr = (await purchaseRequisitionApi.list()).find((p) => p.actionDraftId === draft.id);
    expect(draftPr).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', requesterId: idOf('purchase'), desiredReceiptDate: '2026-10-20', source: 'MESSAGE' });
    await expect(actionDraftApi.execute({ actionDraftId: draft.id })).rejects.toBeInstanceOf(InputError);
    as('purchaseHead');
    const draftPrDetail = await purchaseRequisitionApi.detail(draftPr?.id ?? 0);
    expect(draftPrDetail.sourceDraft).toMatchObject({ id: draft.id, draftStatus: 'EXECUTED', message: { id: message.id } });
    at('2026-10-09T10:00:00+09:00');
    await approvalApi.approve({ purchaseRequisitionId: draftPrDetail.id, expectedUpdatedAt: draftPrDetail.updatedAt });
    const draftEvents = readDb((t) => t.businessEvent.filter((e) => e.actionDraftId === draft.id).sort((x, y) => x.id - y.id));
    expect(draftEvents.map((e) => e.businessEventType)).toEqual(['DRAFT_CREATED', 'DRAFT_CONFIRMED', 'PURCHASE_REQUISITION_CREATED', 'DRAFT_EXECUTED', 'PURCHASE_REQUISITION_APPROVED']);
    expect(draftEvents[0].salesOrderId).toBe(salesOrderIdOf('SO-2609-003'));
    as('purchase');
    expect((await messengerApi.listMessages({ chatRoomId: room.id })).items.some((m) => m.content?.includes(draftPr?.purchaseRequisitionNo ?? '?'))).toBe(true);
    expectClean();
  });
});
