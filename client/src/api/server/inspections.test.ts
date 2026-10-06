// 검사 입력 서버 어댑터: 서버 응답 → 화면 모양, LOT id로 폼 만들기(검사 행 없으면 기준에서), 등록(POST)·수정(PATCH) 고르기.
import type { InspectionStandardDetail, QualityInspectionDetail, QualityInspectionListItem } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { inspectionApi } from '@/api/inspections';
import { fail, ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const coilRow: QualityInspectionListItem = {
  lotId: 501,
  lotNo: 'CL-HSM1-261005-001',
  lotType: 'COIL',
  processType: 'HOT_ROLLING',
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
};

const inspectedCoilRow: QualityInspectionListItem = { ...coilRow, qualityInspectionId: 90, inspectionStandardId: 30, versionNo: 1, inspectionResult: 'FAIL', inspectedAt: '2026-10-05T03:00:00.000Z' };

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
  items: [{ ...standardItem(11, 'YIELD', null, null), measuredValue: '250.0000', isPassed: false }],
};

/** GET /quality-inspections?lotId=를 status별로 답한다 */
function listByLot(call: ServerCall, rows: readonly QualityInspectionListItem[]) {
  const lotId = Number(call.query.lotId);
  const wantDone = call.query.status === 'done';
  return ok(page(rows.filter((r) => r.lotId === lotId && (r.inspectionResult === 'PASS' || r.inspectionResult === 'FAIL') === wantDone)));
}

const writes = (calls: ServerCall[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

afterEach(() => stopFakeServer());

describe('검사 입력 서버 어댑터 (api/server/inspections.ts)', () => {
  it('검사 대상 목록: 판정 대기를 끝까지 읽고(100건 넘으면 다음 페이지) 판정 끝을 뒤에 붙인다', async () => {
    const pendingRows = Array.from({ length: 101 }, (_, i) => ({ ...coilRow, lotId: 1000 + i, lotNo: `CL-${1000 + i}` }));
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path !== '/quality-inspections') return undefined;
      if (c.query.status === 'done') return ok(page([inspectedCoilRow]));
      return ok(page(c.query.page === '1' ? pendingRows.slice(0, 100) : pendingRows.slice(100), 101));
    });
    const rows = await inspectionApi.queue();
    expect(rows).toHaveLength(102);
    expect(rows[0]).toMatchObject({ lotId: 1000, inspectionResult: 'PENDING', heatNo: 'HT-BOF1-261005-001', heatResult: 'PENDING', inspectionStandardVersion: 2, locked: false });
    expect(rows[101]).toMatchObject({ lotId: 501, qualityInspectionId: 90, inspectionResult: 'FAIL' });
    expect(calls.filter((c) => c.query.status === 'pending').map((c) => [c.query.page, c.query.size])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });

  it('검사 행이 없는 LOT의 폼은 최신 기준 버전 항목을 두께 구간(초과~이하)으로 거른다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
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
    expect(detail).toMatchObject({ heatLotId: 401, salesOrderItem: null, history: [], productionPlanId: null });
  });

  it('히트는 두께가 없어 구간 없는 항목만 적용한다', async () => {
    const heatRow: QualityInspectionListItem = { ...coilRow, lotId: 401, lotType: 'HEAT', processType: 'STEELMAKING', thicknessMm: null, heatLotId: null, heatLotNo: null };
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path === '/quality-inspections') return listByLot(c, [heatRow]);
      if (c.path === '/inspection-standards/31') return ok(standard31);
      return undefined;
    });
    const detail = await inspectionApi.detail(401);
    expect(detail.items.map((i) => i.inspectionItemCode)).toEqual(['YIELD']);
    expect(detail.lot.heatResult).toBeNull();
  });

  it('검사 행이 있으면 검사 상세를 읽고, 최신 버전이 다르면 옛 버전으로 표시한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
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
  });

  it('LOT이 검사 목록에 없으면 COM-003', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.path === '/quality-inspections' ? ok(page([])) : undefined));
    await expect(inspectionApi.detail(999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  /** 판정이 그대로라 재고를 다시 맞추지 않은 응답 */
  const noStock = { eligibleAddedQty: 0, autoReservedQty: 0, eligibleRemovedQty: 0, releasedReservationQty: 0, releasedAllocationCount: 0 };

  it('처음 저장은 POST, 빈 값 없이 입력한 값만 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [coilRow]);
      if (c.method === 'POST' && c.path === '/quality-inspections') return ok({ ...coilDetail, inspectionResult: 'PENDING', stockSync: noStock });
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 1, measuredValue: ' 300.5 ' }], expectedUpdatedAt: null });
    expect(writes(calls)).toEqual(['POST /quality-inspections']);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ lotId: 501, values: [{ inspectionStandardItemId: 1, measuredValue: '300.5' }] });
    expect(outcome).toEqual({ lotId: 501, lotNo: 'CL-HSM1-261005-001', inspectionResult: 'PENDING', autoReservedQty: 0, surplusLotNos: [], surplusQty: 0, excludedLotQty: 0, salesOrderItem: null });
  });

  it('검사 행이 있으면 PATCH로 고치고 화면을 연 시각을 expectedUpdatedAt으로 보낸다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
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
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'PATCH') return ok({ ...coilDetail, inspectionResult: 'FAIL', stockSync: { ...noStock, eligibleRemovedQty: 1, releasedReservationQty: 1, releasedAllocationCount: 1 } });
      return undefined;
    });
    const outcome = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '999' }], expectedUpdatedAt: coilDetail.updatedAt });
    expect(outcome).toMatchObject({ inspectionResult: 'FAIL', autoReservedQty: 0, surplusQty: 0, excludedLotQty: 1 });
  });

  it('화면을 연 시각이 없으면 지금 검사 상세의 updatedAt으로 고친다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'GET' && c.path === '/quality-inspections') return listByLot(c, [inspectedCoilRow]);
      if (c.method === 'GET' && c.path === '/quality-inspections/90') return ok(coilDetail);
      if (c.method === 'PATCH') return ok({ ...coilDetail, stockSync: noStock });
      return undefined;
    });
    await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '280' }] });
    expect((calls.find((c) => c.method === 'PATCH')?.body as { expectedUpdatedAt: string }).expectedUpdatedAt).toBe(coilDetail.updatedAt);
  });

  it('저장한 값을 지우려 하면 서버에 보내지 않고 그 칸에 입력 오류를 보인다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, () => undefined);
    const error = await inspectionApi.register({ lotId: 501, values: [{ inspectionStandardItemId: 11, measuredValue: '' }], expectedUpdatedAt: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fieldErrors).toHaveProperty('values.11');
    expect(calls).toHaveLength(0);
  });

  it('밀시트 발행 뒤 수정 거부(COM-004)는 입력 오류, 동시 수정(COM-001)은 업무 오류로 받는다', async () => {
    let code = 'COM-004';
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
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
