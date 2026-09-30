// 시연용 거래 데이터. 시드만 있는 깨끗한 DB에서, 실제 API를 사용자별로 호출해 만든다
// (직접 INSERT 하지 않으므로 예약·배정·작업 로그·알림이 실제 규칙대로 쌓인다).
//   node scripts/demo-data.mjs [baseUrl]    기본 http://localhost:8787/api/v1
const BASE = process.argv[2] ?? 'http://localhost:8787/api/v1';
const PASSWORD = 'heatline';

async function call(token, method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json?.success) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json?.error)}`);
  return json.data;
}
const login = async (no) => (await call(null, 'POST', '/auth/login', { employeeNo: no, password: PASSWORD })).accessToken;
const day = (n) => new Date(Date.now() + n * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
const log = (s) => process.stdout.write(`${s}\n`);

const T = { sales: await login('2104012'), sales2: await login('2203018'), prod: await login('1803021'), steel: await login('2001009'), prodHead: await login('1402002'), pur: await login('1907015'), purHead: await login('1604007'), qc: await login('1911030'), logi: await login('2005024') };
const existing = await call(T.sales, 'GET', '/sales-orders');
if ((existing.total ?? existing.rows?.length ?? 0) > 0) {
  log('이미 수주 데이터가 있어 시연 데이터를 만들지 않았습니다. (node scripts/reset-db.mjs fantasteel 후 다시 실행)');
  process.exit(0);
}
const lk = await call(T.sales, 'GET', '/master-data/lookups');
const spec = (code) => lk.productSpecs.find((s) => s.specCode === code) ?? (() => { throw new Error(`규격 없음 ${code}`); })();
const cust = (name) => lk.customers.find((c) => c.customerName === name);
const raw = (code) => lk.rawMaterials.find((m) => m.materialCode === code);
const dir = await call(T.sales, 'GET', '/employees/directory');
const emp = (name) => dir.find((e) => e.employeeName === name);

const fulfillment = (id) => call(T.sales, 'GET', `/sales-orders/${id}/fulfillment`);
async function ship(item, customerId, qty, issue) {
  const sr = await call(T.sales, 'POST', '/shipment-requests', { customerId, requestedShipDate: day(1), items: [{ salesOrderItemId: item.id, requestQty: qty }] });
  const target = { purpose: 'SHIPMENT', shipmentRequestItemId: sr.items[0].id };
  const rec = await call(T.sales, 'POST', '/allocations/recommend', target);
  await call(T.sales, 'POST', '/allocations', { ...target, lotIds: rec.recommendedLots.slice(0, qty).map((l) => l.lotId ?? l.id) });
  if (issue) await call(T.logi, 'POST', `/shipment-requests/${sr.id}/goods-issue`, undefined, { 'Idempotency-Key': `demo-gi-${sr.id}` });
  return sr;
}

// ── 수주 1: 슬래브 10매 (재고 6 + 생산 4) → 4매 출고, 6매는 배정 확정·출고 대기
const so1 = await call(T.sales, 'POST', '/sales-orders', { customerId: cust('한빛중공업').id, dueDate: day(14), note: '1차 4매 선출하 요청', items: [{ productSpecId: spec('SL-SS275-250x1200x10000').id, orderedQty: 10 }] }, { 'Idempotency-Key': 'demo-so-1' });
let f1 = await fulfillment(so1.id);
const plan1 = f1.items[0].productionPlans[0];
await call(T.prod, 'POST', `/production-plans/${plan1.id}/confirm`, {});
await call(T.prod, 'POST', `/production-plans/${plan1.id}/simulate-results`, { seed: 11 });
f1 = await fulfillment(so1.id);
await ship(f1.items[0], so1.customer.id, 4, true);
await ship(f1.items[0], so1.customer.id, 6, false);
const sheets = await call(T.logi, 'GET', '/mill-sheets');
await call(T.logi, 'POST', `/mill-sheets/${(sheets.rows ?? sheets)[0].id}/pdf`, {}).catch((e) => log(`  (밀시트 PDF 건너뜀: ${e.message})`));
log(`수주 ${so1.salesOrderNo}: 4매 출고 완료, 6매 출고 대기`);

// ── 구매: 원료 보충 (구매요청 → 부서장 승인 → 공급업체별 발주 → 입고, 석회석은 부분 입고)
const pr1 = await call(T.pur, 'POST', '/purchase-requisitions', {
  items: [{ rawMaterialId: raw('CL').id, requiredTon: '200' }, { rawMaterialId: raw('LS').id, requiredTon: '100' }, { rawMaterialId: raw('FM').id, requiredTon: '3' }, { rawMaterialId: raw('FS').id, requiredTon: '2' }],
  desiredReceiptDate: day(3), requestReason: '다음 히트 편성분 원료 보충', submit: true,
});
await call(T.purHead, 'POST', `/purchase-requisitions/${pr1.id}/approve`, {});
for (const g of await call(T.pur, 'GET', '/purchase-orders/orderable')) {
  const po = await call(T.pur, 'POST', '/purchase-orders', { supplierId: g.supplier.id, dueDate: day(3), items: g.items.map((i) => ({ purchaseRequisitionItemId: i.purchaseRequisitionItemId, orderedTon: i.unorderedTon })) });
  for (const it of po.items) {
    const ton = it.rawMaterial.materialCode === 'LS' ? '60' : it.outstandingTon;
    const r = await call(T.pur, 'POST', '/goods-receipts', { purchaseOrderItemId: it.id, receivedTon: ton, receiptDate: day(0) });
    await call(T.pur, 'POST', `/goods-receipts/${r.id}/confirm`, {});
  }
}
log(`구매요청 ${pr1.purchaseRequisitionNo}: 승인 → 발주 → 입고 (석회석은 60/100 t 부분 입고)`);

// ── 수주 2: SPHC 코일 12개 (재고 9 + 생산 3) → 연주까지 진행, 슬래브 검사 대기 + 1매 불합격
const so2 = await call(T.sales2, 'POST', '/sales-orders', { customerId: cust('동해조선').id, dueDate: day(9), items: [{ productSpecId: spec('CL-SPHC-3.2x1000x632000').id, orderedQty: 12 }] }, { 'Idempotency-Key': 'demo-so-2' });
const plan2 = (await fulfillment(so2.id)).items[0].productionPlans[0];
await call(T.prod, 'POST', `/production-plans/${plan2.id}/confirm`, {});
await call(T.prod, 'POST', `/production-plans/${plan2.id}/simulate-results`, { seed: 5, untilProcess: 'STEELMAKING' });
await call(T.prod, 'POST', `/production-plans/${plan2.id}/simulate-results`, { seed: 5, untilProcess: 'CASTING', includeInspection: false });
const queue = await call(T.qc, 'GET', '/quality-inspections?status=pending&processCode=CASTING');
const pending = (queue.items ?? queue.rows ?? queue).filter((q) => (q.lot ?? q).productionPlanId === plan2.id);
if (pending.length) {
  const q = pending[0];
  const values = q.items.map((it) => ({ inspectionItemCode: it.inspectionItemCode, measuredValue: it.inspectionItemCode === 'SURFACE_DEFECT_COUNT' ? 5 : 1 }));
  await call(T.qc, 'POST', '/quality-inspections', { lotId: (q.lot ?? q).id, values, memo: '표면 결함 다수 (스카핑 자국)' });
}
log(`수주 ${so2.salesOrderNo}: 연주 완료, 슬래브 ${Math.max(0, pending.length - 1)}매 검사 대기 · 1매 불합격`);

// ── 수주 3: 코일·슬래브 혼합 (SM355 코일 7개: 재고 4 + 부족 3 / 슬래브 2매: 재고) → 코일 계획은 히트 편성 대기
const so3 = await call(T.sales, 'POST', '/sales-orders', { customerId: cust('대성건설').id, dueDate: day(2), note: '납기 촉박', items: [{ productSpecId: spec('CL-SM355-6x1500x407000').id, orderedQty: 7 }, { productSpecId: spec('SL-SM355-250x1500x10000').id, orderedQty: 2 }] }, { 'Idempotency-Key': 'demo-so-3' });
log(`수주 ${so3.salesOrderNo}: 코일 부족 3개 → 생산계획(히트 편성 대기), 납기 위험`);

// ── MRP 실행 + 철광석 구매요청(부서장 승인 대기)
await call(T.pur, 'POST', '/mrp-runs', {});
const pr2 = await call(T.pur, 'POST', '/purchase-requisitions', { items: [{ rawMaterialId: raw('IO').id, requiredTon: '400' }], desiredReceiptDate: day(2), requestReason: 'MRP 순소요 — SM355 코일 히트 편성용', sourceType: 'MRP', submit: true });
log(`구매요청 ${pr2.purchaseRequisitionNo}: 부서장(남구매) 승인 대기`);

// ── 메신저: 그룹방 대화 + 메시지 → 구매요청 초안(요청자 확인 대기), 업무방 대화, 업무
const room = await call(T.pur, 'POST', '/chat-rooms', { chatRoomType: 'GROUP', chatRoomName: '원료-생산 협의', memberIds: [emp('최생산').id, emp('박생산').id, emp('남구매').id] });
await call(T.prod, 'POST', `/chat-rooms/${room.id}/messages`, { content: `${so3.salesOrderNo} SM355 코일 3개 부족분 히트 편성하려고 해요. 원료 상황 어떤가요?` });
await call(T.pur, 'POST', `/chat-rooms/${room.id}/messages`, { content: `철광석이 부족해서 ${pr2.purchaseRequisitionNo} 올렸어요. @남구매 부장님 승인 부탁드립니다.` });
const msg = await call(T.steel, 'POST', `/chat-rooms/${room.id}/messages`, { content: 'SM355는 FeMn이 많이 들어가요. FeMn 4톤, 다음 주 월요일까지 필요합니다.' });
await call(T.pur, 'POST', `/messages/${msg.id}/action-drafts`, { actionType: 'PURCHASE_REQUISITION_CREATE' });
const work = await call(T.sales, 'GET', `/chat-rooms/work-room?salesOrderId=${so1.id}`);
await call(T.sales, 'POST', `/chat-rooms/${work.id}/messages`, { content: `1차 4매 출고 확인했습니다. 나머지 6매도 배정 확정했어요. @배물류 부장님 내일 출고 가능할까요?` });
await call(T.prod, 'POST', '/tasks', { title: `${so3.salesOrderNo} 코일 부족분 히트 편성`, description: '원료 입고 일정 확인 후 편성 확정', assigneeId: emp('최생산').id, dueDate: day(1), linkPath: '/production/plans' });
await call(T.qc, 'POST', '/tasks', { title: 'SPHC 슬래브 검사 대기분 처리', assigneeId: emp('한품질').id, dueDate: day(0), linkPath: '/quality/inspections' });
log('메신저·업무: 그룹방 대화, 구매요청 초안(최생산 확인 대기), 업무 2건');
log('시연 데이터 준비 완료');
