// 불합격 관리 API (REQ-QC-004, REQ-INV-007, REQ-PRD-006, 14.1-6): 권한(requireActor) + 핵심 서비스(setDisposition·createReproductionPlan)
import { describe, expect, it } from 'vitest';
import { ApiError, InputError } from '@/api/client';
import { dispositionApi } from '@/api/dispositions';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import { checkInvariants } from '@/mock/services';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

const read = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

function lotIdOf(lotNo: string): number {
  const lot = read((t) => t.lot.find((l) => l.lotNo === lotNo));
  if (!lot) throw new Error(`시드 LOT이 없어요: ${lotNo}`);
  return lot.id;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    if (error instanceof InputError) return `INPUT:${Object.keys(error.fieldErrors).join(',')}`;
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

const FAILED_SLAB = 'HT-BOF1-260914-001-03';
const FAILED_HEAT = 'HT-BOF1-260924-001';

describe('불합격 LOT 목록·상세', () => {
  it('검사 불합격 LOT과 불합격 히트의 하위 LOT이 나오고, 불합격 상태는 비어 있다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const rows = await dispositionApi.list();
    expect(rows.find((r) => r.lotNo === FAILED_SLAB)).toMatchObject({ reason: 'FAILED', dispositionStatus: null, lotType: 'SLAB' });
    expect(rows.find((r) => r.lotNo === FAILED_HEAT)).toMatchObject({ reason: 'FAILED', lotType: 'HEAT' });
    const children = rows.filter((r) => r.heatLotNo === FAILED_HEAT && r.reason === 'HEAT_FAILED');
    expect(children).toHaveLength(10);
    // 히트 불합격으로 SO-2609-005는 재생산 필요 8매 (14.1-6)
    expect(children[0].salesOrderItem).toMatchObject({ salesOrderNo: 'SO-2609-005' });
    expect(children[0].salesOrderItem?.shortage.reproductionNeedQty).toBe(8);
    expect(children[0].failedItems.map((f) => f.inspectionItemCode)).toContain('P');
  });

  it('상세: 하위 LOT의 근거는 상위 히트의 성분 검사, 같은 수주 품목의 계획과 작업 로그', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const child = (await dispositionApi.list()).find((r) => r.heatLotNo === FAILED_HEAT && r.reason === 'HEAT_FAILED');
    if (!child) throw new Error('하위 LOT 없음');
    const detail = await dispositionApi.detail(child.lotId);
    expect(detail?.evidence?.lot).toMatchObject({ lotNo: FAILED_HEAT, lotType: 'HEAT', inspectionResult: 'FAIL' });
    expect(detail?.evidence?.items.find((i) => i.inspectionItemCode === 'P')?.isPassed).toBe(false);
    expect(detail?.plans.map((p) => p.productionPlanNo)).toEqual(['PP-2609-0005']);
    expect(detail?.history.length).toBeGreaterThan(0);
    // 불합격이 아닌 LOT은 목록에 없다
    expect(await dispositionApi.detail(lotIdOf('HT-BOF1-260905-001-05'))).toBeNull();
  });

  it('조회 권한: 관리자(조회)는 볼 수 있고, 생산(권한 없음)은 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(dispositionApi.list()).resolves.not.toHaveLength(0);
    actAs(SEED_EMPLOYEE_NO.productionHead);
    expect(await codeOf(dispositionApi.list())).toBe('COM-002');
  });
});

describe('불합격 상태 지정 (REQ-QC-004)', () => {
  it('보류·격하·폐기와 사유를 기록하고 작업 로그 DISPOSITION_SET을 남긴다. 후속 처리는 없다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const lotId = lotIdOf(FAILED_SLAB);
    const row = (await dispositionApi.list()).find((r) => r.lotId === lotId);
    const updated = await dispositionApi.set({ lotId, dispositionStatus: 'DOWNGRADED', dispositionReason: '표면 결함 깊이 초과, 격하 판매 검토', expectedUpdatedAt: row?.updatedAt });
    expect(updated).toMatchObject({ dispositionStatus: 'DOWNGRADED', dispositionReason: '표면 결함 깊이 초과, 격하 판매 검토', lotStatus: 'AVAILABLE', isPassed: false });
    const event = read((t) => t.businessEvent.at(-1));
    expect(event).toMatchObject({ businessEventType: 'DISPOSITION_SET', actorType: 'USER', targetType: 'lot', targetNo: FAILED_SLAB });
    expect((await dispositionApi.list()).find((r) => r.lotId === lotId)?.dispositionStatus).toBe('DOWNGRADED');
    // 같은 상태를 다시 고르면 사유를 다시 기록한다
    const again = await dispositionApi.set({ lotId, dispositionStatus: 'DOWNGRADED', dispositionReason: '고객 협의 후 격하 확정', expectedUpdatedAt: updated.updatedAt });
    expect(again.dispositionReason).toBe('고객 협의 후 격하 확정');
    // 히트 불합격 하위 LOT도 지정할 수 있다
    const child = (await dispositionApi.list()).find((r) => r.reason === 'HEAT_FAILED');
    expect((await dispositionApi.set({ lotId: child?.lotId ?? 0, dispositionStatus: 'SCRAPPED', dispositionReason: '히트 P 초과' })).dispositionStatus).toBe('SCRAPPED');
    expect(read((t) => checkInvariants(t))).toEqual([]);
  });

  it('COM-002: 불합격 처리 상태 지정 사용 권한이 없으면 (관리자는 조회만)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    expect(await codeOf(dispositionApi.set({ lotId: lotIdOf(FAILED_SLAB), dispositionStatus: 'HOLD', dispositionReason: '확인' }))).toBe('COM-002');
  });

  it('COM-003 없는 LOT, COM-001 연 뒤 바뀜, 사유 필수·500자, 불합격이 아닌 LOT은 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const lotId = lotIdOf(FAILED_SLAB);
    expect(await codeOf(dispositionApi.set({ lotId: 999999, dispositionStatus: 'HOLD', dispositionReason: '확인' }))).toBe('COM-003');
    expect(await codeOf(dispositionApi.set({ lotId, dispositionStatus: 'HOLD', dispositionReason: '확인', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }))).toBe('COM-001');
    expect(await codeOf(dispositionApi.set({ lotId, dispositionStatus: 'HOLD', dispositionReason: '  ' }))).toBe('INPUT:dispositionReason');
    expect(await codeOf(dispositionApi.set({ lotId, dispositionStatus: 'HOLD', dispositionReason: '가'.repeat(501) }))).toBe('INPUT:dispositionReason');
    expect(await codeOf(dispositionApi.set({ lotId: lotIdOf('HT-BOF1-260905-001-05'), dispositionStatus: 'HOLD', dispositionReason: '확인' }))).toBe('INPUT:lotId');
    expect(read((t) => t.lot.find((l) => l.id === lotId)?.dispositionStatus)).toBeNull();
  });
});

describe('재생산 계획 만들기 (REQ-PRD-006, 14.1-6)', () => {
  it('생산계획·히트 편성 사용 권한으로 부족분만큼 재생산 계획을 만든다. 품질 담당은 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const child = (await dispositionApi.list()).find((r) => r.heatLotNo === FAILED_HEAT && r.reason === 'HEAT_FAILED');
    const salesOrderItemId = child?.salesOrderItem?.salesOrderItemId ?? 0;
    expect(await codeOf(dispositionApi.createReproductionPlan({ salesOrderItemId }))).toBe('COM-002');

    actAs(SEED_EMPLOYEE_NO.productionHead);
    const outcome = await dispositionApi.createReproductionPlan({ salesOrderItemId });
    expect(outcome).toMatchObject({ reservedFromSurplusQty: 0, shortageQty: 8 });
    expect(outcome.productionPlanNo).toMatch(/^PP-\d{4}-\d{4}$/);
    expect(read((t) => t.businessEvent.at(-1))).toMatchObject({ businessEventType: 'REPRODUCTION_PLAN_CREATED', actorType: 'USER', reasonCode: 'ORDER_SHORTAGE' });
    // 다시 누르면 남은 부족이 없어 입력 오류 (자동·중복 생성 없음)
    expect(await codeOf(dispositionApi.createReproductionPlan({ salesOrderItemId }))).toBe('INPUT:salesOrderItemId');

    actAs(SEED_EMPLOYEE_NO.quality);
    const detail = await dispositionApi.detail(child?.lotId ?? 0);
    expect(detail?.row.salesOrderItem?.shortage.reproductionNeedQty).toBe(0);
    expect(detail?.plans.find((p) => p.isReproduction)).toMatchObject({ productionPlanNo: outcome.productionPlanNo, productionPlanStatus: 'PLANNED', shortageQty: 8 });
    expect(read((t) => checkInvariants(t))).toEqual([]);
  });
});
