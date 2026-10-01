// 검사 입력 API (REQ-QC-001·003, REQ-INV-004·007, BP-QC-01): 권한(requireActor) + 핵심 서비스 결과를 api 함수로 시험한다.
import { describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { ApiError, InputError } from '@/api/client';
import { inspectionApi } from '@/api/inspections';
import { measuredValueChanges } from '@/features/quality/lib/qualityDisplay';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { checkInvariants } from '@/mock/services';
import { updateRow } from '@/mock/store';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

function lotIdOf(lotNo: string): number {
  const lot = getMockDb().read((t) => t.lot.find((l) => l.lotNo === lotNo));
  if (!lot) throw new Error(`시드 LOT이 없어요: ${lotNo}`);
  return lot.id;
}

/** 이 계획의 히트 LOT (생산 순) */
function heatLotIdsOfPlan(productionPlanNo: string): number[] {
  return getMockDb().read((t) => {
    const plan = t.productionPlan.find((p) => p.productionPlanNo === productionPlanNo);
    return t.lot.filter((l) => l.productionPlanId === plan?.id && l.lotType === 'HEAT').sort((a, b) => a.id - b.id).map((l) => l.id);
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    if (error instanceof InputError) return 'INPUT';
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

async function inputErrorOf(promise: Promise<unknown>): Promise<InputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputError) return error;
    throw error;
  }
  throw new Error('입력 오류가 나지 않았어요');
}

const expectClean = () => expect(getMockDb().read((t) => checkInvariants(t))).toEqual([]);

describe('검사 대상 목록·입력 폼 조회', () => {
  it('판정 대기 먼저(히트 1·슬래브 2), 밀시트에 들어간 LOT은 잠겨 있다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const queue = await inspectionApi.queue();
    const pending = queue.filter((r) => r.inspectionResult === 'PENDING');
    expect(queue.slice(0, pending.length).every((r) => r.inspectionResult === 'PENDING')).toBe(true);
    expect(pending.map((r) => r.lotType).sort()).toEqual(['HEAT', 'SLAB', 'SLAB']);
    expect(queue.find((r) => r.lotNo === 'HT-BOF1-260905-001')?.locked).toBe(true);
  });

  it('조회 권한: 생산(검사 입력 조회)은 볼 수 있고, 영업(권한 없음)과 계정 선택 없음은 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.productionHead);
    await expect(inspectionApi.queue()).resolves.not.toHaveLength(0);
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await codeOf(inspectionApi.queue())).toBe('COM-002');
    setActingEmployeeForTest(null);
    expect(await codeOf(inspectionApi.detail(lotIdOf('HT-BOF1-260905-001')))).toBe('COM-002');
  });

  it('입력 폼은 판정에 쓰는 기준 버전·항목·연결 수주의 부족·작업 로그를 준다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const failedSlab = await inspectionApi.detail(lotIdOf('HT-BOF1-260914-001-03'));
    expect(failedSlab.standard).toMatchObject({ inspectionStandardCode: 'QS-SM355A-CC', version: 1, isCurrent: true });
    expect(failedSlab.inspectionResult).toBe('FAIL');
    expect(failedSlab.items.find((i) => i.inspectionItemCode === 'SURFACE_DEFECT_DEPTH')).toMatchObject({ measuredValue: expect.stringMatching(/^3\.5/), isPassed: false });
    expect(failedSlab.salesOrderItem).toMatchObject({ salesOrderNo: 'SO-2609-002', lineNo: 1 });
    expect(failedSlab.history.some((e) => e.businessEventType === 'INSPECTION_REGISTERED')).toBe(true);
    expect(failedSlab.locked).toBe(false);
    expect(await codeOf(inspectionApi.detail(999999))).toBe('COM-003');
  });
});

describe('측정값 등록·수정과 자동 판정', () => {
  it('판정 대기 슬래브에 기준 안 값을 모두 넣으면 합격 (작업 로그 INSPECTION_REGISTERED, 주체 사용자)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const target = (await inspectionApi.queue()).find((r) => r.inspectionResult === 'PENDING' && r.lotType === 'SLAB');
    if (!target) throw new Error('판정 대기 슬래브 없음');
    const form = await inspectionApi.detail(target.lotId);
    const outcome = await inspectionApi.register({
      lotId: target.lotId,
      values: form.items.map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: typicalPassValue(i) })),
      expectedUpdatedAt: form.updatedAt,
    });
    expect(outcome).toMatchObject({ lotId: target.lotId, lotNo: target.lotNo, inspectionResult: 'PASS', excludedLotQty: 0 });
    const event = read((t) => t.businessEvent.filter((e) => e.businessEventType === 'INSPECTION_REGISTERED').at(-1));
    expect(event).toMatchObject({ actorType: 'USER', targetType: 'quality_inspection', targetNo: target.lotNo });
    const after = await inspectionApi.detail(target.lotId);
    expect(after.lot.inspectorName).toBe('서민지');
    expect((await inspectionApi.queue()).filter((r) => r.inspectionResult === 'PENDING')).toHaveLength(2);
    expectClean();
  });

  it('필수 항목이 비면 판정 대기로 저장된다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const target = (await inspectionApi.queue()).find((r) => r.inspectionResult === 'PENDING' && r.lotType === 'SLAB');
    if (!target) throw new Error('판정 대기 슬래브 없음');
    const form = await inspectionApi.detail(target.lotId);
    const [first] = form.items;
    const outcome = await inspectionApi.register({ lotId: target.lotId, values: [{ inspectionStandardItemId: first.inspectionStandardItemId, measuredValue: typicalPassValue(first) }] });
    expect(outcome.inspectionResult).toBe('PENDING');
    expect(read((t) => t.lot.find((l) => l.id === target.lotId)?.isPassed)).toBeNull();
  });

  it('같은 기록을 고치고 전·후 값을 남긴다: 불합격 슬래브를 기준 안으로 고치면 합격 → 수주가 이미 채워져 여재', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const lotId = lotIdOf('HT-BOF1-260914-001-03');
    const form = await inspectionApi.detail(lotId);
    const depth = form.items.find((i) => i.inspectionItemCode === 'SURFACE_DEFECT_DEPTH');
    if (!depth || !form.qualityInspectionId) throw new Error('표면 결함 항목 없음');
    const before = read((t) => t.qualityInspectionValue.length);
    const outcome = await inspectionApi.register({ lotId, values: [{ inspectionStandardItemId: depth.inspectionStandardItemId, measuredValue: '1.00' }], expectedUpdatedAt: form.updatedAt });
    expect(outcome).toMatchObject({ inspectionResult: 'PASS', autoReservedQty: 0, surplusLotNos: ['HT-BOF1-260914-001-03'] });
    // 같은 검사 행·같은 값 행을 고친다 (새 행 없음)
    expect(read((t) => t.qualityInspection.filter((q) => q.lotId === lotId))).toHaveLength(1);
    expect(read((t) => t.qualityInspectionValue.length)).toBe(before);
    const event = read((t) => t.businessEvent.filter((e) => e.businessEventType === 'INSPECTION_REGISTERED' && e.targetNo === 'HT-BOF1-260914-001-03').at(-1));
    expect(measuredValueChanges(event?.beforeData ?? null, event?.afterData ?? null)).toEqual([
      { inspectionItemCode: 'SURFACE_DEFECT_DEPTH', before: expect.stringMatching(/^3\.5/), after: expect.stringMatching(/^1(\.0+)?$/) },
    ]);
    expect(read((t) => t.businessEvent.some((e) => e.businessEventType === 'SURPLUS_CONVERTED' && e.actorType === 'SYSTEM'))).toBe(true);
    expectClean();
  });

  it('히트 불합격 → 하위 슬래브 제외·부족(재생산 필요) 표시, 다시 합격으로 고치면 원래 수주에 자동 예약 (SYSTEM)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const heatId = heatLotIdsOfPlan('PP-2609-0002')[1];
    const form = await inspectionApi.detail(heatId);
    const p = form.items.find((i) => i.inspectionItemCode === 'P');
    if (!p) throw new Error('P 항목 없음');
    const failed = await inspectionApi.register({ lotId: heatId, values: [{ inspectionStandardItemId: p.inspectionStandardItemId, measuredValue: '0.050' }] });
    expect(failed).toMatchObject({ inspectionResult: 'FAIL', excludedLotQty: 8 });
    expect(failed.salesOrderItem?.shortage).toMatchObject({ activeReservedQty: 4, unsecuredQty: 8, reproductionNeedQty: 8 });
    expect(read((t) => t.businessEvent.filter((e) => e.businessEventType === 'RESERVATION_RELEASED' && e.reasonCode === 'QUALITY_FAILURE' && e.actorType === 'SYSTEM')).length).toBeGreaterThan(0);
    expectClean();

    const passed = await inspectionApi.register({ lotId: heatId, values: [{ inspectionStandardItemId: p.inspectionStandardItemId, measuredValue: '0.020' }] });
    expect(passed).toMatchObject({ inspectionResult: 'PASS', autoReservedQty: 8 });
    expect(passed.salesOrderItem?.shortage).toMatchObject({ activeReservedQty: 12, reproductionNeedQty: 0 });
    const auto = read((t) => t.businessEvent.filter((e) => e.businessEventType === 'RESERVATION_CREATED').at(-1));
    expect(auto?.actorType).toBe('SYSTEM');
    expectClean();
  });
});

describe('검사 입력 오류 (9.3 코드·입력 오류)', () => {
  it('COM-002: 검사 입력 사용 권한이 없으면 (생산은 조회만, 관리자도 조회만)', async () => {
    const lotId = lotIdOf('HT-BOF1-260914-001-03');
    actAs(SEED_EMPLOYEE_NO.productionHead);
    expect(await codeOf(inspectionApi.register({ lotId, values: [] }))).toBe('COM-002');
    actAs(SEED_EMPLOYEE_NO.admin);
    expect(await codeOf(inspectionApi.register({ lotId, values: [] }))).toBe('COM-002');
  });

  it('COM-003 없는 LOT, COM-001 연 뒤 다른 곳에서 바뀜', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    expect(await codeOf(inspectionApi.register({ lotId: 999999, values: [] }))).toBe('COM-003');
    const lotId = lotIdOf('HT-BOF1-260914-001-03');
    expect(await codeOf(inspectionApi.register({ lotId, values: [], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }))).toBe('COM-001');
  });

  it('MST-001: 판정할 검사 기준이 없으면', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const pendingHeat = (await inspectionApi.queue()).find((r) => r.inspectionResult === 'PENDING' && r.lotType === 'HEAT');
    if (!pendingHeat) throw new Error('판정 대기 히트 없음');
    getMockDb().transact((tx) => {
      const lot = tx.tables.lot.find((l) => l.id === pendingHeat.lotId);
      for (const s of tx.tables.inspectionStandard.filter((s) => s.processType === 'STEELMAKING' && s.steelGradeId === lot?.steelGradeId)) updateRow(tx, 'inspectionStandard', s.id, { isCurrent: false });
    });
    expect((await inspectionApi.detail(pendingHeat.lotId)).standard).toBeNull();
    expect(await codeOf(inspectionApi.register({ lotId: pendingHeat.lotId, values: [] }))).toBe('MST-001');
  });

  it('밀시트가 발행된 LOT(제품·그 히트)은 고칠 수 없다 (REQ-QC-003)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const error = await inputErrorOf(inspectionApi.register({ lotId: lotIdOf('HT-BOF1-260905-001'), values: [] }));
    expect(error.fieldErrors.lotId).toContain('밀시트');
    expect(error.fieldErrors.lotId).toContain('MS-2609-0001-1');
  });

  it('형식이 틀린 값·기준에 없는 항목은 입력칸 오류로 막고 아무것도 저장하지 않는다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const lotId = lotIdOf('HT-BOF1-260914-001-03');
    const form = await inspectionApi.detail(lotId);
    const [first] = form.items;
    const events = read((t) => t.businessEvent.length);
    const bad = await inputErrorOf(inspectionApi.register({ lotId, values: [{ inspectionStandardItemId: first.inspectionStandardItemId, measuredValue: '1.23456' }] }));
    expect(Object.keys(bad.fieldErrors)).toEqual([`values.${first.inspectionStandardItemId}`]);
    const unknown = await inputErrorOf(inspectionApi.register({ lotId, values: [{ inspectionStandardItemId: 999999, measuredValue: '1' }] }));
    expect(Object.keys(unknown.fieldErrors)).toEqual(['values.999999']);
    expect(read((t) => t.businessEvent.length)).toBe(events);
  });
});
