// 불합격 관리 서버 어댑터: 불합격 LOT 목록(근거 검사의 불합격 항목은 서버가 같이 줌), 상세는 lotId로 하나만, 상태 지정, 재생산은 연결 전.
import type { QualityInspectionDetail, QualityInspectionListItem, RejectedLotEvidence, RejectedLotListItem } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { dispositionApi } from '@/api/dispositions';
import { ok, page, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const lotBase = {
  lotStatus: 'AVAILABLE' as const,
  itemId: null,
  itemCode: null,
  itemName: null,
  producedDate: null,
  productionPlanId: null,
  productionPlanNo: null,
  steelGradeId: 3, steelGradeCode: 'SS275', heatInspectionResult: 'FAIL' as const, dispositionStatus: null, dispositionReason: null };

type RowBase = Omit<RejectedLotListItem, 'evidence'>;

const heatBase: RowBase = {
  ...lotBase,
  lotId: 401,
  lotNo: 'HT-BOF1-261005-001',
  lotType: 'HEAT',
  processType: 'STEELMAKING',
  thicknessMm: null,
  heatLotId: null,
  heatLotNo: null,
  heatInspectionResult: null,
  qualityInspectionId: 77,
  inspectionResult: 'FAIL',
  updatedAt: '2026-10-05T01:00:00.000Z',
};

const childSlabBase: RowBase = {
  ...lotBase,
  lotId: 402,
  lotNo: 'SL-CC1-261005-001',
  lotType: 'SLAB',
  processType: 'CONTINUOUS_CASTING',
  thicknessMm: '250.00',
  heatLotId: 401,
  heatLotNo: 'HT-BOF1-261005-001',
  qualityInspectionId: null,
  inspectionResult: null,
  updatedAt: '2026-10-05T01:00:01.000Z',
};

const failedCoilBase: RowBase = {
  ...lotBase,
  lotId: 501,
  lotNo: 'CL-HSM1-261005-001',
  lotType: 'COIL',
  processType: 'HOT_ROLLING',
  lotStatus: 'SHIPPED',
  itemId: 61,
  itemCode: 'CL-SS275-8x1500',
  itemName: '열연코일 SS275 8x1500',
  producedDate: '2026-10-05',
  productionPlanId: 300,
  productionPlanNo: 'PP-2610-0001',
  thicknessMm: '8.00',
  heatLotId: 401,
  heatLotNo: 'HT-BOF1-261005-001',
  qualityInspectionId: 88,
  inspectionResult: 'FAIL',
  dispositionStatus: 'HOLD',
  dispositionReason: '재검 대기',
  updatedAt: '2026-10-05T02:00:00.000Z',
};

const detailItem = (id: number, code: string, measuredValue: string, isPassed: boolean) => ({
  inspectionStandardItemId: id,
  inspectionItemCode: code,
  inspectionItemName: `${code} 항목`,
  unit: '%',
  minValue: null,
  maxValue: '0.0500',
  thicknessOverMm: null,
  thicknessUptoMm: null,
  isRequired: true,
  measuredValue,
  isPassed,
});

const inspectionOf = (lot: RowBase, id: number, items: QualityInspectionDetail['items']): QualityInspectionDetail => ({
  ...lot,
  qualityInspectionId: id,
  inspectionStandardId: 10,
  inspectionStandardCode: 'QS',
  versionNo: 1,
  inspectionResult: 'FAIL',
  inspectorEmployeeId: 13,
  inspectorEmployeeName: '서민지',
  inspectedAt: `2026-10-05T0${id === 77 ? 1 : 2}:00:00.000Z`,
  updatedAt: lot.updatedAt,
  lockedMillSheetNos: [],
  items,
});

const heatInspection = inspectionOf(heatBase, 77, [detailItem(1, 'P', '0.0600', false), detailItem(2, 'S', '0.0100', true)]);
const coilInspection = inspectionOf(failedCoilBase, 88, [detailItem(5, 'YIELD', '250.0000', false)]);
const evidenceOf = (inspection: QualityInspectionDetail): RejectedLotEvidence => ({
  qualityInspectionId: inspection.qualityInspectionId,
  lotId: inspection.lotId,
  inspectedAt: inspection.inspectedAt,
  failedItems: inspection.items.filter((i) => i.isPassed === false),
});
// 서버가 목록 행에 근거 검사를 붙여 준다: 히트 불합격 하위 슬래브는 상위 히트의 검사
const heat: RejectedLotListItem = { ...heatBase, evidence: evidenceOf(heatInspection) };
const childSlab: RejectedLotListItem = { ...childSlabBase, evidence: evidenceOf(heatInspection) };
const failedCoil: RejectedLotListItem = { ...failedCoilBase, evidence: evidenceOf(coilInspection) };
const heatListRow: QualityInspectionListItem = { ...heatBase, isLocked: false, inspectionStandardId: 10, inspectionStandardCode: 'QS', versionNo: 1, inspectedAt: heatInspection.inspectedAt };

function respond(c: ServerCall) {
  if (c.path === '/lots/rejected') return ok(page([failedCoil, childSlab, heat].filter((r) => c.query.lotId === undefined || String(r.lotId) === c.query.lotId)));
  if (c.path === '/quality-inspections/77') return ok(heatInspection);
  if (c.path === '/quality-inspections/88') return ok(coilInspection);
  if (c.path === '/quality-inspections') return ok(page(c.query.lotId === '401' && c.query.status === 'done' ? [heatListRow] : []));
  if (c.path === '/inspection-standards') return ok(page([]));
  return undefined;
}

afterEach(() => stopFakeServer());

describe('불합격 관리 서버 어댑터 (api/server/dispositions.ts)', () => {
  it('목록: 자기 불합격과 히트 불합격 하위 LOT을 나누고, 불합격 항목은 목록 응답의 근거 검사에서 바로 쓴다 (검사 상세를 따로 부르지 않음)', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, respond);
    const rows = await dispositionApi.list();
    expect(rows.map((r) => [r.lotNo, r.reason, r.failedItems.map((f) => f.inspectionItemCode).join(','), r.inspectedAt])).toEqual([
      ['CL-HSM1-261005-001', 'FAILED', 'YIELD', coilInspection.inspectedAt],
      ['SL-CC1-261005-001', 'HEAT_FAILED', 'P', heatInspection.inspectedAt],
      ['HT-BOF1-261005-001', 'FAILED', 'P', heatInspection.inspectedAt],
    ]);
    expect(rows[0]).toMatchObject({ heatNo: 'HT-BOF1-261005-001', dispositionStatus: 'HOLD', dispositionReason: '재검 대기', updatedAt: failedCoil.updatedAt, salesOrderItem: null });
    expect(rows[0]).toMatchObject({ lotStatus: 'SHIPPED', itemCode: 'CL-SS275-8x1500', itemName: '열연코일 SS275 8x1500', producedDate: '2026-10-05', productionPlanId: 300, productionPlanNo: 'PP-2610-0001' });
    // 히트는 규격·생산완료일이 없다
    expect(rows[2]).toMatchObject({ itemCode: null, producedDate: '', productionPlanNo: null });
    expect(calls.map((c) => c.path)).toEqual(['/lots/rejected']);
  });

  it('상세: 검사 입력 조회 권한이 없으면 근거 검사 폼만 비우고, 불합격 항목은 목록 행 그대로 보인다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.path.startsWith('/quality-inspections')) return new Response(JSON.stringify({ success: false, error: { code: 'COM-002', message: '권한이 없어요' } }), { status: 403 });
      return respond(c);
    });
    const detail = await dispositionApi.detail(501);
    expect(detail?.evidence).toBeNull();
    expect(detail?.row.failedItems.map((f) => f.inspectionItemCode)).toEqual(['YIELD']);
  });

  it('상세: 히트 불합격 하위 LOT의 근거는 상위 히트의 성분 검사다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, respond);
    const detail = await dispositionApi.detail(402);
    // 불합격 목록 전체가 아니라 그 LOT 하나만 읽는다
    expect(calls.find((c) => c.path === '/lots/rejected')?.query).toMatchObject({ lotId: '402', size: '1' });
    expect(detail?.row).toMatchObject({ lotId: 402, reason: 'HEAT_FAILED', heatNo: 'HT-BOF1-261005-001' });
    expect(detail?.evidence?.lot.lotId).toBe(401);
    expect(detail?.evidence?.items.filter((i) => i.isPassed === false).map((i) => i.inspectionItemCode)).toEqual(['P']);
    expect(detail?.row.failedItems.map((f) => f.measuredValue)).toEqual(['0.0600']);
    expect(detail).toMatchObject({ plans: [], history: [] });
  });

  it('상세: 불합격 목록에 없는 LOT이면 null', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.quality, respond);
    await expect(dispositionApi.detail(999)).resolves.toBeNull();
  });

  it('상태 지정: 화면을 연 시각을 expectedUpdatedAt으로 보내고, 응답의 updatedAt을 다음 지정에 쓴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => {
      if (c.method === 'POST' && c.path === '/lots/501/disposition') return ok({ ...failedCoil, dispositionStatus: 'DOWNGRADED', dispositionReason: '격하 판매', updatedAt: '2026-10-06T00:00:00.000Z' });
      return respond(c);
    });
    const saved = await dispositionApi.set({ lotId: 501, dispositionStatus: 'DOWNGRADED', dispositionReason: '격하 판매', expectedUpdatedAt: failedCoil.updatedAt });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ dispositionStatus: 'DOWNGRADED', dispositionReason: '격하 판매', expectedUpdatedAt: failedCoil.updatedAt });
    expect(saved).toEqual({ lotNo: failedCoil.lotNo, dispositionStatus: 'DOWNGRADED', dispositionReason: '격하 판매', updatedAt: '2026-10-06T00:00:00.000Z' });
  });

  it('상태 지정: 화면을 연 시각이 없으면 지금 목록 행의 updatedAt을 쓰고, 목록에 없으면 COM-003', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, (c) => (c.method === 'POST' ? ok(childSlab) : respond(c)));
    await dispositionApi.set({ lotId: 402, dispositionStatus: 'SCRAPPED', dispositionReason: '히트 P 초과' });
    expect((calls.find((c) => c.method === 'POST')?.body as { expectedUpdatedAt: string }).expectedUpdatedAt).toBe(childSlab.updatedAt);
    await expect(dispositionApi.set({ lotId: 999, dispositionStatus: 'HOLD', dispositionReason: '확인' })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('재생산 계획은 서버 생산 모듈이 없어 서버를 부르지 않고 연결 전 오류', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.quality, respond);
    await expect(dispositionApi.createReproductionPlan({ salesOrderItemId: 1 })).rejects.toThrow('아직 서버와 연결되지 않았어요');
    expect(calls).toHaveLength(0);
  });
});
