// 출하요청·배정·출고 확정·밀시트 api 시험 (가짜 DB 시드 + actAs). 업무 규칙 자체는 core 시험이 따로 본다.
// 시드: 나래조선(CUS-02) SO-2609-002 SM355A 슬래브 12매 예약, DR-2609-0002 6매 배정 대기 / SO-2609-004 같은 규격 3매 예약.
import { describe, expect, it } from 'vitest';
import { InputError } from '@/api/client';
import { goodsIssueApi } from '@/api/goodsIssues';
import { millSheetApi } from '@/api/millSheets';
import { shipmentRequestApi } from '@/api/shipmentRequests';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { checkInvariants, isInspectionLocked } from '@/mock/services';
import { updateRow } from '@/mock/store';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T,>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);
const requestIdOf = (no: string) => read((t) => t.shipmentRequest.find((r) => r.shipmentRequestNo === no)?.id ?? 0);
const salesOrderItemOf = (salesOrderNo: string) =>
  read((t) => {
    const so = t.salesOrder.find((s) => s.salesOrderNo === salesOrderNo);
    const item = t.salesOrderItem.find((i) => i.salesOrderId === so?.id);
    if (!item) throw new Error(`수주 품목이 없어요: ${salesOrderNo}`);
    return item;
  });
const customerIdOf = (code: string) => read((t) => t.customer.find((c) => c.customerCode === code)?.id ?? 0);
const reservationsOf = (salesOrderItemId: number) =>
  read((t) => t.reservation.filter((r) => r.salesOrderItemId === salesOrderItemId && r.reservationStatus !== 'RELEASED').map((r) => [r.reservationStatus, r.reservedQty] as const));
const sumBy = (rows: readonly (readonly [string, number])[], status: string) => rows.filter(([s]) => s === status).reduce((sum, [, qty]) => sum + qty, 0);
const setLot = (lotId: number, patch: Parameters<typeof updateRow<'lot'>>[3]) => getMockDb().transact((tx) => updateRow(tx, 'lot', lotId, patch));

async function allocateByRecommendation(shipmentRequestId: number) {
  const detail = await shipmentRequestApi.detail(shipmentRequestId);
  return shipmentRequestApi.confirmAllocations({
    shipmentRequestId,
    lines: detail.lines.map((l) => ({ shipmentRequestItemId: l.shipmentRequestItemId, lotIds: l.recommendedLots.map((lot) => lot.lotId) })),
  });
}

describe('출하요청 → FIFO 배정 → 출고 확정 → 밀시트 (14.1 7~9단계 흐름)', () => {
  it('부분 출고 6 → CONVERTED 6 / ACTIVE 6 · 부분출하, 나머지 출고 → 모두 CONVERTED · 출하완료, 밀시트는 출하요청 × 수주마다', async () => {
    const so2Item = salesOrderItemOf('SO-2609-002');
    const so4Item = salesOrderItemOf('SO-2609-004');
    const dr2 = requestIdOf('DR-2609-0002');

    // 1) 배정 대기 요청의 FIFO 추천 (생산완료일 → LOT 번호)
    actAs(SEED_EMPLOYEE_NO.sales);
    const before = await shipmentRequestApi.detail(dr2);
    expect(before.shipmentRequestStatus).toBe('REQUESTED');
    const [line] = before.lines;
    expect(line.waitingAllocationQty).toBe(6);
    expect(line.recommendedLots).toHaveLength(6);
    const fifoKeys = line.recommendedLots.map((l) => `${l.producedDate}|${l.lotNo}`);
    expect([...fifoKeys].sort()).toEqual(fifoKeys);
    expect(line.recommendedLots.every((l) => l.yardName)).toBe(true);

    // 2) 추천대로 확정 → ALLOCATED, 추천은 작업 로그(FIFO_RECOMMENDATION)로만 남는다
    const confirmed = await allocateByRecommendation(dr2);
    expect(confirmed).toEqual({ confirmedQty: 6, shipmentRequestStatus: 'ALLOCATED' });
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'ALLOCATION_RECOMMENDED' && e.reasonCode === 'FIFO_RECOMMENDATION' && e.salesOrderId === so2Item.salesOrderId))).toBe(true);

    // 3) 물류 출고 확정 → 예약 CONVERTED 6 / ACTIVE 6, 품목 부분출하, 밀시트 1장
    actAs(SEED_EMPLOYEE_NO.logistics);
    const check = await goodsIssueApi.detail(dr2);
    expect(check.ready).toBe(true);
    expect(check.lines[0].lots.every((l) => l.productInspectionResult === 'PASS' && l.heatInspectionResult === 'PASS' && l.eligibility === 'ELIGIBLE')).toBe(true);
    const issued = await goodsIssueApi.confirm({ shipmentRequestId: dr2, expectedUpdatedAt: check.updatedAt });
    expect(issued.issuedLotNos).toHaveLength(6);
    expect(issued.millSheets.map((m) => m.millSheetNo)).toEqual(['MS-2609-0002-1']);
    expect(sumBy(reservationsOf(so2Item.id), 'CONVERTED')).toBe(6);
    expect(sumBy(reservationsOf(so2Item.id), 'ACTIVE')).toBe(6);
    expect(salesOrderItemOf('SO-2609-002')).toMatchObject({ shippedQty: 6, salesOrderItemStatus: 'PARTIALLY_SHIPPED' });
    const afterIssue = await goodsIssueApi.detail(dr2);
    expect(afterIssue.shipmentRequestStatus).toBe('ISSUED');
    expect(afterIssue.lines[0].lots.every((l) => l.allocationStatus === 'CONSUMED' && l.lotStatus === 'SHIPPED')).toBe(true);
    expect(afterIssue.issuedEmployeeName).toBe('권예진');

    // 4) 같은 고객사의 두 수주를 묶어 요청 → 결과에 바로 FIFO 추천 (SHP-001)
    actAs(SEED_EMPLOYEE_NO.sales);
    const customers = await shipmentRequestApi.shippableCustomers();
    expect(customers.find((c) => c.customerCode === 'CUS-02')).toMatchObject({ itemCount: 2 });
    const shippable = await shipmentRequestApi.shippableItems(customerIdOf('CUS-02'));
    expect(shippable.map((i) => [i.salesOrderNo, i.shippableQty])).toEqual([
      ['SO-2609-004', 3],
      ['SO-2609-002', 6],
    ]);
    const created = await shipmentRequestApi.create({
      customerId: customerIdOf('CUS-02'),
      requestedShipDate: '2026-10-08',
      items: [
        { salesOrderItemId: so2Item.id, requestQty: '6' },
        { salesOrderItemId: so4Item.id, requestQty: '3' },
      ],
    });
    expect(created.shipmentRequestNo).toMatch(/^DR-\d{4}-\d{4}$/);
    expect(created.recommendation.map((r) => r.recommendedLots.length)).toEqual([6, 3]);
    const recommended = created.recommendation.flatMap((r) => r.recommendedLots.map((l) => l.lotId));
    expect(new Set(recommended).size).toBe(9);
    await allocateByRecommendation(created.id);

    // 5) 출고 → 모두 CONVERTED, 출하완료, 밀시트 2장 (수주별 순번)
    actAs(SEED_EMPLOYEE_NO.logistics);
    const second = await goodsIssueApi.confirm({ shipmentRequestId: created.id });
    const serial = created.shipmentRequestNo.slice(3);
    expect(second.millSheets.map((m) => m.millSheetNo)).toEqual([`MS-${serial}-1`, `MS-${serial}-2`]);
    expect(sumBy(reservationsOf(so2Item.id), 'CONVERTED')).toBe(12);
    expect(sumBy(reservationsOf(so2Item.id), 'ACTIVE')).toBe(0);
    expect(salesOrderItemOf('SO-2609-002')).toMatchObject({ shippedQty: 12, salesOrderItemStatus: 'SHIPPED' });
    expect(salesOrderItemOf('SO-2609-004')).toMatchObject({ shippedQty: 3, salesOrderItemStatus: 'SHIPPED' });
    const result = await goodsIssueApi.detail(created.id);
    expect(result.lines.map((l) => [l.convertedQty, l.salesOrderItemStatus])).toEqual([
      [12, 'SHIPPED'],
      [3, 'SHIPPED'],
    ]);

    // 6) 밀시트 스냅샷: 각 LOT의 히트가 성분 행으로 따로 들어가고, 검사값은 잠긴다
    const list = await millSheetApi.list();
    expect(list.filter((m) => m.shipmentRequestId === created.id)).toHaveLength(2);
    const sheet = list.find((m) => m.millSheetNo === `MS-${serial}-1`);
    const detail = await millSheetApi.detail(sheet?.id ?? 0);
    expect(detail.snapshot.salesOrder.salesOrderNo).toBe('SO-2609-002');
    const lotHeats = new Set(detail.snapshot.items.flatMap((i) => i.lots.map((l) => l.heatNo)));
    expect(new Set(detail.snapshot.heats.map((h) => h.heatNo))).toEqual(lotHeats);
    expect(detail.snapshot.heats.every((h) => (h.inspection?.values.length ?? 0) > 0 && h.inspection?.inspectionStandardCode)).toBe(true);
    expect(detail.snapshot.items[0].lots.every((l) => l.productInspection?.processType === 'CONTINUOUS_CASTING')).toBe(true);
    expect(detail.snapshot.lotIds.every((lotId) => read((t) => isInspectionLocked(t, lotId)))).toBe(true);

    // 7) 수주 타임라인에 출하요청·배정·출고·전환·밀시트 이벤트가 모두 있고 불변조건이 지켜진다
    const types = new Set(read((t) => t.businessEvent.filter((e) => e.salesOrderId === so2Item.salesOrderId).map((e) => e.businessEventType)));
    for (const type of ['SHIPMENT_REQUEST_CREATED', 'ALLOCATION_RECOMMENDED', 'ALLOCATION_CONFIRMED', 'GOODS_ISSUE_CONFIRMED', 'RESERVATION_CONVERTED', 'MILL_SHEET_ISSUED'] as const) {
      expect(types.has(type)).toBe(true);
    }
    expect(read((t) => checkInvariants(t))).toEqual([]);
  });

  it('밀시트 PDF 생성 = pdf_path 기록 (이미 있으면 그대로), 조회만 하는 사원은 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const sheet = (await millSheetApi.list()).find((m) => m.millSheetNo === 'MS-2609-0001-1');
    if (!sheet) throw new Error('시드 밀시트 MS-2609-0001-1이 없어요');
    await expect(millSheetApi.markPdfGenerated({ millSheetId: sheet.id })).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.logistics);
    const first = await millSheetApi.markPdfGenerated({ millSheetId: sheet.id });
    expect(first.pdfPath).toBe('mill-sheets/MS-2609-0001-1.pdf');
    const again = await millSheetApi.markPdfGenerated({ millSheetId: sheet.id });
    expect(again.pdfPath).toBe(first.pdfPath);
    await expect(millSheetApi.detail(99999)).rejects.toMatchObject({ code: 'COM-003' });
  });
});

describe('출하요청 등록 오류 (SO-002·SHP-002·입력 오류·COM-002)', () => {
  it('정수가 아닌 매수는 SO-002, 출하 가능 잔량 초과는 SHP-002, 다른 고객사·출하 요청일 누락은 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const requestCount = read((t) => t.shipmentRequest.length);
    const so2Item = salesOrderItemOf('SO-2609-002');
    const base = { customerId: customerIdOf('CUS-02'), requestedShipDate: '2026-10-08' };
    for (const qty of ['2.5', '0', '-1', '', '3매']) {
      await expect(shipmentRequestApi.create({ ...base, items: [{ salesOrderItemId: so2Item.id, requestQty: qty }] })).rejects.toMatchObject({ code: 'SO-002' });
    }
    // ACTIVE 12 − 진행 중 DR-2609-0002 6 = 6
    await expect(shipmentRequestApi.create({ ...base, items: [{ salesOrderItemId: so2Item.id, requestQty: '7' }] })).rejects.toMatchObject({ code: 'SHP-002' });
    await expect(shipmentRequestApi.create({ ...base, customerId: customerIdOf('CUS-01'), items: [{ salesOrderItemId: so2Item.id, requestQty: '1' }] })).rejects.toBeInstanceOf(InputError);
    const noDate = shipmentRequestApi.create({ ...base, requestedShipDate: '', items: [{ salesOrderItemId: so2Item.id, requestQty: '1' }] });
    await expect(noDate).rejects.toBeInstanceOf(InputError);
    await expect(noDate).rejects.toMatchObject({ fieldErrors: { requestedShipDate: expect.any(String) } });
    expect(read((t) => t.shipmentRequest.length)).toBe(requestCount);
  });

  it('권한: 등록·배정·취소는 영업 USE, 출고 확정은 물류 USE, 조회 권한이 없으면 목록도 COM-002', async () => {
    const so2Item = salesOrderItemOf('SO-2609-002');
    const dr2 = requestIdOf('DR-2609-0002');
    actAs(SEED_EMPLOYEE_NO.logistics);
    expect((await shipmentRequestApi.list()).length).toBe(read((t) => t.shipmentRequest.length));
    await expect(shipmentRequestApi.create({ customerId: customerIdOf('CUS-02'), requestedShipDate: '2026-10-08', items: [{ salesOrderItemId: so2Item.id, requestQty: '1' }] })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(allocateByRecommendation(dr2)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(shipmentRequestApi.cancel({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.sales);
    await allocateByRecommendation(dr2);
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'COM-002' });
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(shipmentRequestApi.list()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(goodsIssueApi.queue()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(millSheetApi.list()).rejects.toMatchObject({ code: 'COM-002' });
    expect(read((t) => t.shipmentRequest.find((r) => r.id === dr2)?.shipmentRequestStatus)).toBe('ALLOCATED');
  });
});

describe('배정 확정·변경·해제 (INV-001~004)', () => {
  it('배정 대기보다 많이 INV-001, 불합격 LOT INV-002, 이미 배정 INV-003, 출고된 LOT INV-004', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const dr2 = requestIdOf('DR-2609-0002');
    const [line] = (await shipmentRequestApi.detail(dr2)).lines;
    const confirm = (lotIds: number[]) => shipmentRequestApi.confirmAllocations({ shipmentRequestId: dr2, lines: [{ shipmentRequestItemId: line.shipmentRequestItemId, lotIds }] });
    await expect(confirm(line.candidateLots.slice(0, 7).map((l) => l.lotId))).rejects.toMatchObject({ code: 'INV-001' });
    const failed = read((t) => t.lot.find((l) => l.lotNo === 'HT-BOF1-260914-001-03'));
    await expect(confirm([failed?.id ?? 0])).rejects.toMatchObject({ code: 'INV-002' });
    await confirm([line.candidateLots[0].lotId]);
    await expect(confirm([line.candidateLots[0].lotId])).rejects.toMatchObject({ code: 'INV-003' });
    setLot(line.candidateLots[1].lotId, { lotStatus: 'SHIPPED' });
    await expect(confirm([line.candidateLots[1].lotId])).rejects.toMatchObject({ code: 'INV-004' });
    const after = await shipmentRequestApi.detail(dr2);
    expect(after.lines[0].allocatedQty).toBe(1);
    expect(after.shipmentRequestStatus).toBe('REQUESTED');
  });

  it('변경은 해제 + 새 배정 한 번에(사유 필수), LOT당 CONFIRMED 배정은 하나, 해제하면 다시 배정 대기', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const dr2 = requestIdOf('DR-2609-0002');
    await allocateByRecommendation(dr2);
    const detail = await shipmentRequestApi.detail(dr2);
    const [line] = detail.lines;
    expect(detail.shipmentRequestStatus).toBe('ALLOCATED');
    const target = line.allocations[0];
    const alternative = line.candidateLots[0];
    await expect(shipmentRequestApi.changeAllocation({ allocationId: target.allocationId, newLotId: alternative.lotId, reasonText: ' ' })).rejects.toBeInstanceOf(InputError);
    const changed = await shipmentRequestApi.changeAllocation({ allocationId: target.allocationId, newLotId: alternative.lotId, reasonText: '야드 작업 순서' });
    expect(changed.lotNo).toBe(alternative.lotNo);
    const confirmedPerLot = read((t) => {
      const counts = new Map<number, number>();
      for (const a of t.allocation.filter((x) => x.allocationStatus === 'CONFIRMED')) counts.set(a.lotId, (counts.get(a.lotId) ?? 0) + 1);
      return [...counts.values()];
    });
    expect(confirmedPerLot.every((n) => n === 1)).toBe(true);
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'ALLOCATION_CHANGED' && e.reasonCode === 'ALLOCATION_CHANGE'))).toBe(true);
    const afterChange = await shipmentRequestApi.detail(dr2);
    expect(afterChange.lines[0].allocations.map((a) => a.lotNo)).toContain(alternative.lotNo);
    expect(afterChange.lines[0].allocations.map((a) => a.lotNo)).not.toContain(target.lotNo);
    await shipmentRequestApi.releaseAllocation({ allocationId: changed.allocationId });
    const afterRelease = await shipmentRequestApi.detail(dr2);
    expect(afterRelease).toMatchObject({ shipmentRequestStatus: 'REQUESTED', waitingAllocationQty: 1 });
    expect(read((t) => checkInvariants(t))).toEqual([]);
  });
});

describe('출고 확정 재검증·취소 (INV-002·SHP-002·SHP-003·INV-001·COM-001)', () => {
  it('배정 대기면 INV-001, 미검사 LOT INV-002·잔량 초과 SHP-002(아무것도 출고 안 됨), 두 번째 확정은 COM-001', async () => {
    const dr2 = requestIdOf('DR-2609-0002');
    const millSheetCount = read((t) => t.millSheet.length);
    actAs(SEED_EMPLOYEE_NO.logistics);
    const waiting = await goodsIssueApi.detail(dr2);
    expect(waiting.ready).toBe(false);
    expect(waiting.problems.map((p) => p.code)).toContain('INV-001');
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'INV-001' });
    actAs(SEED_EMPLOYEE_NO.sales);
    await allocateByRecommendation(dr2);
    const [line] = (await shipmentRequestApi.detail(dr2)).lines;
    setLot(line.allocations[0].lotId, { isPassed: null });
    actAs(SEED_EMPLOYEE_NO.logistics);
    const blocked = await goodsIssueApi.detail(dr2);
    // 9.3: 미검사·불합격(제품·상위 히트)은 INV-002 '제품 또는 상위 히트가 미합격', SHP-002는 출하 가능 매수 초과에만 쓴다
    expect(blocked.problems).toEqual([expect.objectContaining({ code: 'INV-002', lotNo: line.allocations[0].lotNo })]);
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'INV-002' });
    expect(read((t) => t.shipmentRequest.find((r) => r.id === dr2)?.shipmentRequestStatus)).toBe('ALLOCATED');
    expect(read((t) => t.millSheet.length)).toBe(millSheetCount);
    setLot(line.allocations[0].lotId, { isPassed: true });
    // 배정 뒤 수주 잔량이 줄어든 상황을 흉내 낸다 → 요청 매수가 출하 가능 매수를 넘으면 SHP-002
    const soItem = read((t) => t.salesOrderItem.find((i) => i.id === line.salesOrderItemId));
    if (!soItem) throw new Error('수주 품목 없음');
    getMockDb().transact((tx) => updateRow(tx, 'salesOrderItem', soItem.id, { shippedQty: soItem.orderedQty - line.requestQty + 1 }));
    const overRemaining = await goodsIssueApi.detail(dr2);
    expect(overRemaining.problems).toEqual([expect.objectContaining({ code: 'SHP-002', lotNo: null })]);
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'SHP-002' });
    expect(read((t) => t.millSheet.length)).toBe(millSheetCount);
    getMockDb().transact((tx) => updateRow(tx, 'salesOrderItem', soItem.id, { shippedQty: soItem.shippedQty }));
    await goodsIssueApi.confirm({ shipmentRequestId: dr2 });
    await expect(goodsIssueApi.confirm({ shipmentRequestId: dr2 })).rejects.toMatchObject({ code: 'COM-001' });
    const queue = await goodsIssueApi.queue();
    expect(queue.find((q) => q.shipmentRequestId === dr2)?.shipmentRequestStatus).toBe('ISSUED');
  });

  it('출고 확정된 요청은 SHP-003, 취소하면 배정만 풀리고 예약은 ACTIVE 그대로, 열린 뒤 바뀌면 COM-001', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    await expect(shipmentRequestApi.cancel({ shipmentRequestId: requestIdOf('DR-2609-0001') })).rejects.toMatchObject({ code: 'SHP-003' });
    const dr2 = requestIdOf('DR-2609-0002');
    const opened = await shipmentRequestApi.detail(dr2);
    await allocateByRecommendation(dr2);
    await expect(shipmentRequestApi.cancel({ shipmentRequestId: dr2, expectedUpdatedAt: opened.updatedAt })).rejects.toMatchObject({ code: 'COM-001' });
    const current = await shipmentRequestApi.detail(dr2);
    await shipmentRequestApi.cancel({ shipmentRequestId: dr2, expectedUpdatedAt: current.updatedAt });
    const cancelled = await shipmentRequestApi.detail(dr2);
    expect(cancelled).toMatchObject({ shipmentRequestStatus: 'CANCELLED', editable: false, totalAllocatedQty: 0 });
    const so2Item = salesOrderItemOf('SO-2609-002');
    expect(sumBy(reservationsOf(so2Item.id), 'ACTIVE')).toBe(12);
    const shippable = await shipmentRequestApi.shippableItems(customerIdOf('CUS-02'));
    expect(shippable.find((i) => i.salesOrderItemId === so2Item.id)?.shippableQty).toBe(12);
    expect(read((t) => checkInvariants(t))).toEqual([]);
  });
});
