// 인수 시나리오 14.1 (슬래브 수주 전체 흐름)을 HTTP로 끝까지 돌려 본다.
//   node scripts/e2e-scenario.mjs [baseUrl]    기본 http://localhost:8899/api/v1
// 깨끗한 시드 DB(SS275 슬래브 250×1200×10000 합격 재고 6매)에서 실행한다.
const BASE = process.argv[2] ?? 'http://localhost:8899/api/v1';
const PASSWORD = 'heatline';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

async function call(token, method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: json?.success === true, data: json?.data, error: json?.error };
}
const login = async (no) => (await call(null, 'POST', '/auth/login', { employeeNo: no, password: PASSWORD })).data.accessToken;
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.error)}`); return r.data; };
const day = (n) => new Date(Date.now() + n * 86400000 + 9 * 3600000).toISOString().slice(0, 10);

const sales = await login('2104012'), prod = await login('1803021'), pur = await login('1907015'), purHead = await login('1604007'), qc = await login('1911030'), logi = await login('2005024');
const lookups = must(await call(sales, 'GET', '/master-data/lookups'), 'lookups');
const spec = lookups.productSpecs.find((s) => s.specCode === 'SL-SS275-250x1200x10000');
const customer = lookups.customers[0];

console.log('1. 수주 등록: SS275 슬래브 10매');
const bad = await call(sales, 'POST', '/sales-orders', { customerId: customer.id, dueDate: day(14), items: [{ productSpecId: spec.id, orderedQty: 10.5 }] });
check('10.5매는 SO-002로 거부', bad.error?.code === 'SO-002', bad.error?.message);
const so = must(await call(sales, 'POST', '/sales-orders', { customerId: customer.id, dueDate: day(14), items: [{ productSpecId: spec.id, orderedQty: 10 }] }, { 'Idempotency-Key': `e2e-${Date.now()}` }), '수주 등록');
check('톤은 계산값 235.500', so.orderedTon === '235.500', so.orderedTon);
let ful = must(await call(sales, 'GET', `/sales-orders/${so.id}/fulfillment`), 'fulfillment');
let item = ful.items[0];
check('합격 재고 6매 ACTIVE 예약', item.reservedQty === 6, `reserved ${item.reservedQty}`);
check('부족 4매 생산계획', item.productionPlans.length === 1 && item.productionPlans[0].shortageQty === 4);
const planId = item.productionPlans[0].id;

console.log('2. 히트 편성');
const preview = must(await call(prod, 'POST', `/production-plans/${planId}/heat-preview`, {}), 'heat-preview');
console.log('   ', JSON.stringify({ heatCount: preview.heatCount ?? preview.calc?.heatCount, keys: Object.keys(preview).slice(0, 12) }));
must(await call(prod, 'POST', `/production-plans/${planId}/confirm`, {}), '편성 확정');
const plan = must(await call(prod, 'GET', `/production-plans/${planId}`), 'plan');
check('히트 1개, 계획 슬래브 10매', plan.heatCount === 1 && plan.plannedSlabQty === 10, `heat ${plan.heatCount}, slab ${plan.plannedSlabQty}`);

console.log('3. MRP → 구매요청 → 부서장 승인 → 발주 → 부분 입고');
const mrp = must(await call(pur, 'POST', '/mrp-runs', {}), 'MRP');
console.log('   ', JSON.stringify((mrp.requirements ?? []).map((r) => [r.rawMaterial?.materialCode ?? r.materialCode, r.requiredTon, r.netRequiredTon])));
const coal = lookups.rawMaterials.find((m) => m.materialCode === 'CL');
const pr = must(await call(pur, 'POST', '/purchase-requisitions', { items: [{ rawMaterialId: coal.id, requiredTon: '100.000' }], desiredReceiptDate: day(5), requestReason: 'e2e', submit: true }), '구매요청');
check('구매요청 승인 대기, 승인권자 = 구매부장', pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' && pr.approver?.employeeName === '남구매', pr.approver?.employeeName);
const early = await call(pur, 'POST', '/purchase-orders', { supplierId: coal.defaultSupplierId, dueDate: day(5), items: [{ purchaseRequisitionItemId: pr.items[0].id, orderedTon: '100' }] });
check('승인 전 발주는 PUR-002', early.error?.code === 'PUR-002', early.error?.code);
const self = await call(pur, 'POST', `/purchase-requisitions/${pr.id}/approve`, {});
check('요청자 본인 승인 불가', !self.ok, self.error?.code);
must(await call(purHead, 'POST', `/purchase-requisitions/${pr.id}/approve`, {}), '승인');
const po = must(await call(pur, 'POST', '/purchase-orders', { supplierId: coal.defaultSupplierId, dueDate: day(5), items: [{ purchaseRequisitionItemId: pr.items[0].id, orderedTon: '100' }] }), '발주');
const poItem = po.items[0];
const r1 = must(await call(pur, 'POST', '/goods-receipts', { purchaseOrderItemId: poItem.id, receivedTon: '40.125', receiptDate: day(0) }), '입고 초안');
const c1 = must(await call(pur, 'POST', `/goods-receipts/${r1.id}/confirm`, {}), '입고 확정');
const c1b = must(await call(pur, 'POST', `/goods-receipts/${r1.id}/confirm`, {}), '입고 재확정');
check('부분 입고 확정 → 원료 LOT 생성, 재확정해도 같은 LOT', !!c1.lot?.lotNo && c1.lot?.lotNo === c1b.lot?.lotNo, c1.lot?.lotNo);
const over = await call(pur, 'POST', '/goods-receipts', { purchaseOrderItemId: poItem.id, receivedTon: '60', receiptDate: day(0) });
check('미입고량 초과는 PUR-003', over.error?.code === 'PUR-003', over.error?.code);

console.log('4. 실적 시뮬레이션(제선→제강→연주→검사)');
const sim = must(await call(prod, 'POST', `/production-plans/${planId}/simulate-results`, { seed: 7 }), '시뮬레이션');
console.log('   ', JSON.stringify({ loss: sim.sampledLossRate, steps: sim.steps.length }));
ful = must(await call(sales, 'GET', `/sales-orders/${so.id}/fulfillment`), 'fulfillment');
item = ful.items[0];
check('합격 생산분 4매가 원래 수주에 자동 예약', item.passedQty === 4 && item.reservedQty === 6, `reserved ${item.reservedQty}, passed ${item.passedQty}`);
const surplus = must(await call(prod, 'GET', '/inventories/surplus'), '여재');
const mine = (surplus.lots ?? surplus.items ?? surplus).filter?.((l) => (l.productSpecId ?? l.productSpec?.id) === spec.id) ?? [];
check('남은 슬래브는 여재', mine.length >= 1, `${mine.length}매`);

console.log('5. 출하요청 4매 → FIFO 배정 → 출고 → 밀시트');
const ship = async (qty) => {
  const sr = must(await call(sales, 'POST', '/shipment-requests', { customerId: customer.id, requestedShipDate: day(1), items: [{ salesOrderItemId: item.id, requestQty: qty }] }), '출하요청');
  const target = { purpose: 'SHIPMENT', shipmentRequestItemId: sr.items[0].id };
  const rec = must(await call(sales, 'POST', '/allocations/recommend', target), '추천');
  const lots = (rec.recommendedLots ?? rec.lots ?? rec.candidates).slice(0, qty);
  must(await call(sales, 'POST', '/allocations', { ...target, lotIds: lots.map((l) => l.lotId ?? l.id) }), '배정 확정');
  const key = `gi-${sr.id}-${Date.now()}`;
  const gi = must(await call(logi, 'POST', `/shipment-requests/${sr.id}/goods-issue`, undefined, { 'Idempotency-Key': key }), '출고 확정');
  const again = await call(logi, 'POST', `/shipment-requests/${sr.id}/goods-issue`, undefined);
  check(`출고 ${qty}매, 다시 눌러도 두 번 출고되지 않음`, again.status === 409, `${gi.goodsIssueNo}, 재호출 ${again.status}`);
  return { gi, lots };
};
const first = await ship(4);
let res = must(await call(sales, 'GET', `/sales-orders/${so.id}/reservations`), '예약');
const sum = (st) => (res.reservations ?? res).filter((r) => r.status === st).reduce((s, r) => s + r.reservedQty, 0);
check('부분 출고: CONVERTED 4 · ACTIVE 6', sum('CONVERTED') === 4 && sum('ACTIVE') === 6, `CONVERTED ${sum('CONVERTED')}, ACTIVE ${sum('ACTIVE')}`);
let head = must(await call(sales, 'GET', `/sales-orders/${so.id}`), '수주');
check('수주 상태 부분출하', head.salesOrderStatus === 'PARTIALLY_SHIPPED', head.salesOrderStatus);
const sheets = must(await call(logi, 'GET', '/mill-sheets'), '밀시트 목록');
const ms = (sheets.rows ?? sheets)[0];
const pdf = await call(logi, 'POST', `/mill-sheets/${ms.id}/pdf`, {});
check('밀시트 PDF 생성', pdf.ok && (pdf.data.pdfStatus === 'READY'), pdf.data?.pdfStatus ?? pdf.error?.message);
await ship(6);
head = must(await call(sales, 'GET', `/sales-orders/${so.id}`), '수주');
check('나머지 6매 출고 → 출하완료', head.salesOrderStatus === 'SHIPPED' && head.shippedQty === 10, `${head.salesOrderStatus} ${head.shippedQty}`);

console.log('6. LOT 역추적 · 이력 재현');
const lotId = first.lots[0].lotId ?? first.lots[0].id;
const trace = must(await call(qc, 'GET', `/lots/${lotId}/trace`, undefined), '역추적') ?? {};
const types = new Set(trace.nodes.map((n) => n.lotType));
check('슬래브 → 히트 → 용선 → 원료까지 역추적', ['SLAB', 'HEAT', 'HOT_METAL', 'RAW_MATERIAL'].every((t) => types.has(t)), [...types].join(','));
const ev = must(await call(sales, 'GET', `/business-events?salesOrderId=${so.id}&limit=200`), '작업 로그');
const evTypes = new Set(ev.items.map((e) => e.eventType));
const need = ['SALES_ORDER_REGISTERED', 'RESERVATION_CREATED', 'PRODUCTION_PLAN_CREATED', 'PRODUCTION_PLAN_CONFIRMED', 'AUTO_RESERVED', 'ALLOCATION_CONFIRMED', 'RESERVATION_CONVERTED', 'GOODS_ISSUE_CONFIRMED', 'MILL_SHEET_ISSUED'];
check(`수주 타임라인 ${ev.items.length}건에 주요 이벤트가 모두 있음`, need.every((t) => evTypes.has(t)), need.filter((t) => !evTypes.has(t)).join(',') || 'ok');
const inv = must(await call(sales, 'GET', '/inventories'), '재고');
console.log(`\n${failed ? `실패 ${failed}건` : '모든 확인 통과'}`);
process.exit(failed ? 1 : 0);
