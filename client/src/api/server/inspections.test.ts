// 검사 입력 서버 어댑터: 서버 응답 → 화면 모양, LOT id로 폼 만들기(검사 행 없으면 기준에서), 등록(POST)·수정(PATCH) 고르기.
import type { InspectionStandardDetail, QualityInspectionDetail, QualityInspectionListItem } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectionApi } from '@/api/inspections';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const coilRow: QualityInspectionListItem = {
  lotId: 501,
  lotNo: 'CL-HSM1-261005-001',
  lotType: 'COIL',
  lotStatus: 'AVAILABLE',
  processType: 'HOT_ROLLING',
  itemId: 61,
  itemCode: 'CL-SS275-8x1500',
  itemName: '열연코일 SS275 8x1500',
  producedDate: '2026-10-05',
  productionPlanId: 300,
  productionPlanNo: 'PP-2610-0001',
  steelGradeId: 3,
  steelGradeCode: 'SS275',
  thicknessMm: '8.00',
  heatLotId: 401,
  heatLotNo: 'HT-BOF1-261005-001',
  heatInspectionResult: null,
  qualityInspectionId: null,
  inspectionStandardId: 31,
  inspectionStandardCode: 'QS-HR-SS275',
  versionNo: 2,
  inspectionResult: null,
  inspectedAt: null,
  isLocked: false,
};

const standardItem = (id: number, code: string, over: string | null, upto: string | null) => ({
  inspectionStandardItemId: id,
  inspectionItemCode: code,
  inspectionItemName: `${code} 항목`,
  unit: 'MPa',
  minValue: '275.0000',
  maxValue: null,
  thicknessOverMm: over,
  thicknessUptoMm: upto,
  isRequired: true,
});

const standard31: InspectionStandardDetail = {
  inspectionStandardId: 31,
  inspectionStandardCode: 'QS-HR-SS275',
  versionNo: 2,
  processType: 'HOT_ROLLING',
  steelGradeId: 3,
  steelGradeCode: 'SS275',
  createdAt: '2026-10-01T00:00:00.000Z',
  items: [standardItem(1, 'YIELD', null, null), standardItem(2, 'CHARPY', '6.00', null), standardItem(3, 'THIN_ONLY', null, '6.00')],
  inspectionCount: 0,
  versions: [
    { inspectionStandardId: 30, versionNo: 1, createdAt: '2026-09-01T00:00:00.000Z', itemCount: 1, inspectionCount: 1 },
    { inspectionStandardId: 31, versionNo: 2, createdAt: '2026-10-01T00:00:00.000Z', itemCount: 3, inspectionCount: 0 },
  ],
};

const inspectedCoilRow: QualityInspectionListItem = { ...coilRow, isLocked: true, qualityInspectionId: 90, inspectionStandardId: 30, versionNo: 1, inspectionResult: 'FAIL', inspectedAt: '2026-10-05T03:00:00.000Z' };

const coilDetail: QualityInspectionDetail = {
  ...coilRow,
  qualityInspectionId: 90,
  inspectionStandardId: 30,
  inspectionStandardCode: 'QS-HR-SS275',
  versionNo: 1,
  inspectionResult: 'FAIL',
  inspectorEmployeeId: 13,
  inspectorEmployeeName: '서민지',
  inspectedAt: '2026-10-05T03:00:00.000Z',
  updatedAt: '2026-10-05T03:00:00.123Z',
  lockedMillSheetNos: [],
  items: [{ ...standardItem(11, 'YIELD', null, null), measuredValue: '250.0000', isPassed: false }],
};

/** GET /quality-inspections?lotId=를 status별로 답한다 */
function listByLot(call: ServerCall, rows: readonly QualityInspectionListItem[]) {
  const lotId = Number(call.query.lotId);
  const wantDone = call.query.status === 'done';
  return ok(page(rows.filter((r) => r.lotId === lotId && (r.inspectionResult === 'PASS' || r.inspectionResult === 'FAIL') === wantDone)));
}

const writes = (calls: ServerCall[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

/** LOT 작업 로그(GET /business-events)는 따로 시험하므로(businessEvents.test.ts) 여기서는 빈 목록으로 답한다 */
const fakeServer = (employeeNo: string, respond: (call: ServerCall) => Response | undefined) =>
  useFakeServer(employeeNo, (c) => (c.path === '/business-events' ? ok(page([])) : respond(c)));

afterEach(() => stopFakeServer());

describe('검사 입력 서버 어댑터 (api/server/inspections.ts)', () => {
  it('검사 대상 목록: 판정 대기를 끝까지 읽고(100건 넘으면 다음 페이지) 판정 끝을 뒤에 붙인다', async () => {
    const pendingRows = Array.from({ length: 101 }, (_, i) => ({ ...coilRow, lotId: 1000 + i, lotNo: `CL-${1000 + i}` }));
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path !== '/quality-inspections') return undefined;
      if (c.query.status === 'done') return ok(page([inspectedCoilRow]));
      return ok(page(c.query.page === '1' ? pendingRows.slice(0, 100) : pendingRows.slice(100), 101));
    });
    const rows = await inspectionApi.queue();
    expect(rows).toHaveLength(102);
    expect(rows[0]).toMatchObject({ lotId: 1000, inspectionResult: 'PENDING', heatNo: 'HT-BOF1-261005-001', heatResult: 'PENDING', inspectionStandardVersion: 2, locked: false });
    expect(rows[0]).toMatchObject({ lotStatus: 'AVAILABLE', itemId: 61, itemCode: 'CL-SS275-8x1500', itemName: '열연코일 SS275 8x1500', producedDate: '2026-10-05', productionPlanNo: 'PP-2610-0001' });
    expect(rows[101]).toMatchObject({ lotId: 501, qualityInspectionId: 90, inspectionResult: 'FAIL', locked: true });
    expect(rows[0].locked).toBe(false);
    expect(calls.filter((c) => c.query.status === 'pending').map((c) => [c.query.page, c.query.size])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });

  it('검사 행이 없는 LOT의 폼은 최신 기준 버전 항목을 두께 구간(초과~이하)으로 거른다', async () => {
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [coilRow]);
      if (c.path === '/inspection-standards/31') return ok(standard31);
      return undefined;
    });
    const detail = await inspectionApi.detail(501);
    expect(detail.qualityInspectionId).toBeNull();
    expect(detail.updatedAt).toBeNull();
    expect(detail.standard).toEqual({ id: 31, inspectionStandardCode: 'QS-HR-SS275', version: 2, isCurrent: true });
    expect(detail.items.map((i) => [i.inspectionItemCode, i.minThicknessMm, i.maxThicknessMm, i.measuredValue])).toEqual([
      ['YIELD', null, null, null],
      ['CHARPY', '6.00', null, null],
    ]);
    // 생산계획 300을 못 읽으면(이 테스트 서버에 없음) 연결 수주만 비운다
    expect(detail).toMatchObject({ heatLotId: 401, salesOrderItem: null, history: [], productionPlanId: 300 });
  });

  it('히트는 두께가 없어 구간 없는 항목만 적용한다', async () => {
    const heatRow: QualityInspectionListItem = { ...coilRow, lotId: 401, lotType: 'HEAT', processType: 'STEELMAKING', thicknessMm: null, heatLotId: null, heatLotNo: null };
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [heatRow]);
      if (c.path === '/inspection-standards/31') return ok(standard31);
      return undefined;
    });
    const detail = await inspectionApi.detail(401);
    expect(detail.items.map((i) => i.inspectionItemCode)).toEqual(['YIELD']);
    expect(detail.lot.heatResult).toBeNull();
  });

  it('검사 행이 있으면 검사 상세를 읽고, 최신 버전이 다르면 옛 버전으로 표시한다', async () => {
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.path === '/quality-inspections/90') return ok(coilDetail);
      if (c.path === '/inspection-standards') return ok(page([{ ...standard31 }]));
      return undefined;
    });
    const detail = await inspectionApi.detail(501);
    expect(detail).toMatchObject({ qualityInspectionId: 90, updatedAt: '2026-10-05T03:00:00.123Z', inspectionResult: 'FAIL' });
    expect(detail.standard).toEqual({ id: 30, inspectionStandardCode: 'QS-HR-SS275', version: 1, isCurrent: false });
    expect(detail.currentStandard).toEqual({ id: 31, inspectionStandardCode: 'QS-HR-SS275', version: 2 });
    expect(detail.lot.inspectorName).toBe('서민지');
    expect(detail.items[0]).toMatchObject({ inspectionStandardItemId: 11, measuredValue: '250.0000', isPassed: false });
    expect(detail).toMatchObject({ locked: false, lockedMillSheetNos: [] });
  });

  it('밀시트가 발행된 LOT이면 상세를 열 때부터 잠금으로 보인다 (저장 전에 막음)', async () => {
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.path === '/quality-inspections/90') return ok({ ...coilDetail, lockedMillSheetNos: ['MS-2610-0001-1'] });
      if (c.path === '/inspection-standards') return ok(page([{ ...standard31 }]));
      return undefined;
    });
    const detail = await inspectionApi.detail(501);
    expect(detail).toMatchObject({ locked: true, lockedMillSheetNos: ['MS-2610-0001-1'] });
    expect(detail.lot.locked).toBe(true);
  });

  it('LOT이 검사 목록에 없으면 COM-003', async () => {
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.path === '/quality-inspections' ? ok(page([])) : undefined));
    await expect(inspectionApi.detail(999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  /** 판정이 그대로라 재고를 다시 맞추지 않은 응답 */
  const noStock = { eligibleAddedQty: 0, autoReservedQty: 0, eligibleRemovedQty: 0, releasedReservationQty: 0, releasedAllocationCount: 0 };

  it('처음 저장은 POST, 빈 값 없이 입력한 값만 보낸다', async () => {
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [coilRow]);
      if (c.method === 'POST' && c.path === '/quality-inspections') return ok({ ...coilDetail, inspectionResult: 'PENDING', stockSync: noStock });
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 1, measuredValue: ' 300.5 ' }], expectedUpdatedAt: null });
    expect(writes(calls)).toEqual(['POST /quality-inspections']);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ lotId: 501, values: [{ inspectionStandardItemId: 1, measuredValue: '300.5' }] });
    expect(outcome).toEqual({ lotId: 501, lotNo: 'CL-HSM1-261005-001', inspectionResult: 'PENDING', autoReservedQty: 0, surplusLotNos: [], surplusQty: 0, excludedLotQty: 0, releasedAllocationCount: 0, releasedReservationQty: 0, salesOrderItem: null });
  });

  it('저장 뒤 LOT 생산계획의 연결 수주 품목과 부족(판정 반영 뒤 값)을 안내에 싣는다', async () => {
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [coilRow]);
      if (c.method === 'POST' && c.path === '/quality-inspections') return ok({ ...coilDetail, inspectionResult: 'PASS', stockSync: { ...noStock, eligibleAddedQty: 1, autoReservedQty: 1 } });
      if (c.path === '/production-plans/300') {
        return ok({
          id: 300,
          itemCode: 'CL-SS275-8x1500',
          customerName: '한빛건설',
          dueDate: '2026-10-30',
          reproduction: {
            salesOrderItemId: 41, salesOrderId: 4, salesOrderNo: 'SO-2610-001', lineNo: 1, salesOrderItemStatus: 'OPEN',
            unshippedQty: 5, openPlans: [], orderedQty: 5, shippedQty: 0, activeReservedQty: 4, unsecuredQty: 1,
            openPlanRemainingQty: 1, additionalPlanQty: 0, reservationAvailableQty: 0, reproductionNeedQty: 0,
          },
        });
      }
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 1, measuredValue: '300' }], expectedUpdatedAt: null });
    // 계획은 저장 뒤에 읽는다 (자동 예약이 반영된 부족)
    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf('GET /production-plans/300')).toBeGreaterThan(paths.indexOf('POST /quality-inspections'));
    expect(outcome.salesOrderItem).toMatchObject({ salesOrderNo: 'SO-2610-001', lineNo: 1, shortage: { unsecuredQty: 1, openPlanRemainingQty: 1 } });
  });

  it('검사 행이 있으면 PATCH로 고치고 화면을 연 시각을 expectedUpdatedAt으로 보낸다', async () => {
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'PATCH' && c.path === '/quality-inspections/90') return ok({ ...coilDetail, inspectionResult: 'PASS', stockSync: { ...noStock, eligibleAddedQty: 3, autoReservedQty: 2 } });
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '280' }], expectedUpdatedAt: coilDetail.updatedAt });
    expect(writes(calls)).toEqual(['PATCH /quality-inspections/90']);
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expectedUpdatedAt: coilDetail.updatedAt, values: [{ inspectionStandardItemId: 11, measuredValue: '280' }] });
    expect(outcome.inspectionResult).toBe('PASS');
    // 판정 뒤 재고 반영: 적격 3매 중 2매 자동 예약, 1매는 여재
    expect(outcome).toMatchObject({ autoReservedQty: 2, surplusQty: 1, excludedLotQty: 0 });
  });

  it('불합격으로 바뀌면 적격에서 빠진 매수를 excludedLotQty로 준다', async () => {
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'PATCH') return ok({ ...coilDetail, inspectionResult: 'FAIL', stockSync: { ...noStock, eligibleRemovedQty: 1, releasedReservationQty: 1, releasedAllocationCount: 1 } });
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '999' }], expectedUpdatedAt: coilDetail.updatedAt });
    expect(outcome).toMatchObject({ inspectionResult: 'FAIL', autoReservedQty: 0, surplusQty: 0, excludedLotQty: 1, releasedAllocationCount: 1, releasedReservationQty: 1 });
  });

  it('화면을 연 시각이 없으면 지금 검사 상세의 updatedAt으로 고친다', async () => {
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'GET' && c.path === '/quality-inspections/90') return ok(coilDetail);
      if (c.method === 'PATCH') return ok({ ...coilDetail, stockSync: noStock });
      return undefined;
    });
    await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '280' }] });
    expect((calls.find((c) => c.method === 'PATCH')?.body as { expectedUpdatedAt: string }).expectedUpdatedAt).toBe(coilDetail.updatedAt);
  });

  it('검사 행이 있으면 비운 칸은 null로 보내 저장한 값을 지운다', async () => {
    const calls = fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'PATCH') return ok({ ...coilDetail, inspectionResult: 'PENDING', stockSync: { eligibleAddedQty: 0, autoReservedQty: 0, eligibleRemovedQty: 0, releasedReservationQty: 0, releasedAllocationCount: 0 } });
      return undefined;
    });
    const saved = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: ' ' }], expectedUpdatedAt: coilDetail.updatedAt });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expectedUpdatedAt: coilDetail.updatedAt, values: [{ inspectionStandardItemId: 11, measuredValue: null }] });
    expect(saved.inspectionResult).toBe('PENDING');
  });

  it('밀시트 발행 뒤 수정 거부(COM-004)는 입력 오류, 동시 수정(COM-001)은 업무 오류로 받는다', async () => {
    let code = 'COM-004';
    fakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'PATCH') return code === 'COM-004' ? fail(400, 'COM-004', '밀시트가 발행된 LOT이라 측정값을 고칠 수 없어요 (밀시트 MS-1)') : fail(409, 'COM-001', '그 사이 다른 사람이 검사를 고쳤어요');
      return undefined;
    });
    const input = { lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '280' }], expectedUpdatedAt: coilDetail.updatedAt };
    await expect(inspectionApi.register(input)).rejects.toThrow('밀시트가 발행된 LOT이라');
    code = 'COM-001';
    await expect(inspectionApi.register(input)).rejects.toMatchObject({ code: 'COM-001' });
  });
});
