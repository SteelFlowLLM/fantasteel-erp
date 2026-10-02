import { describe, expect, it } from 'vitest';
import { ApiError, InputError } from '@/api/client';
import { COMMON_STANDARD_GRADE, inspectionStandardApi, type InspectionStandardItemInput } from '@/api/inspectionStandards';
import { getMockDb } from '@/mock/db';
import { createInspectionStandardVersion } from '@/mock/services/inspectionStandards';
import { insertRow } from '@/mock/store';
import { actAs, SEED_EMPLOYEE_NO } from '@/test/actors';

/** 시드 검사 기준과 겹치지 않게 시험 전용 강종을 만든다 */
function createTestGrade(code = 'TEST355'): number {
  return getMockDb().transact((tx) => insertRow(tx, 'steelGrade', { steelGradeCode: code, steelGradeName: code, standardNo: 'KS D 3515:2018' }).id);
}

const buildItem = (overrides: Partial<InspectionStandardItemInput> = {}): InspectionStandardItemInput => ({
  inspectionItemCode: 'YIELD_STRENGTH',
  inspectionItemName: '항복강도',
  unit: 'N/mm²',
  minValue: '355',
  maxValue: '',
  minThicknessMm: '',
  maxThicknessMm: '16',
  isRequired: true,
  ...overrides,
});

async function catchError(promise: Promise<unknown>): Promise<ApiError | InputError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError || error instanceof InputError) return error;
    throw error;
  }
  throw new Error('오류가 나지 않았어요');
}

describe('검사 기준 만들기 (REQ-QC-002)', () => {
  it('품질 담당이 새 기준을 버전 1로 만든다. 코드는 QS-강종-공정', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.quality);
    const id = await inspectionStandardApi.create({
      processType: 'HOT_ROLLING',
      steelGradeId: gradeId,
      items: [buildItem(), buildItem({ minValue: '345', minThicknessMm: '16', maxThicknessMm: '40' }), buildItem({ inspectionItemCode: 'CHARPY_IMPACT', inspectionItemName: '샤르피 충격', unit: 'J', minValue: '27', minThicknessMm: '6', maxThicknessMm: '' })],
    });
    const detail = await inspectionStandardApi.get(id);
    expect(detail).toMatchObject({ inspectionStandardCode: 'QS-TEST355-HR', version: 1, isCurrent: true, itemCount: 3, standardNo: 'KS D 3515:2018', previousItems: null });
    expect(detail?.items.map((i) => [i.inspectionItemCode, i.minValue, i.minThicknessMm, i.maxThicknessMm, i.sortOrder])).toEqual([
      ['YIELD_STRENGTH', '355.0000', null, '16.00', 1],
      ['YIELD_STRENGTH', '345.0000', '16.00', '40.00', 2],
      ['CHARPY_IMPACT', '27.0000', '6.00', null, 3],
    ]);
    expect((await inspectionStandardApi.list({ processType: 'HOT_ROLLING', steelGradeId: gradeId })).map((s) => s.inspectionStandardCode)).toContain('QS-TEST355-HR');
  });

  it('같은 공정·강종의 기준이 이미 있으면 새 기준 대신 새 버전을 만들게 한다', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.quality);
    await inspectionStandardApi.create({ processType: 'STEELMAKING', steelGradeId: gradeId, items: [buildItem({ inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: '', maxValue: '0.18', maxThicknessMm: '' })] });
    const again = await catchError(inspectionStandardApi.create({ processType: 'STEELMAKING', steelGradeId: gradeId, items: [buildItem()] }));
    expect(again).toBeInstanceOf(InputError);
    expect((again as InputError).fieldErrors.processType).toContain('QS-TEST355-ST');
  });

  it('강종을 고르지 않으면 공통 기준으로 만들지 않고 강종 칸에 안내한다', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const before = getMockDb().read((t) => t.inspectionStandard.length);
    const error = await catchError(inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: null, items: [buildItem()] }));
    expect(error).toBeInstanceOf(InputError);
    expect((error as InputError).fieldErrors).toMatchObject({ steelGradeId: '강종을 선택해 주세요' });
    const both = await catchError(inspectionStandardApi.create({ processType: null, steelGradeId: null, items: [buildItem()] }));
    expect(Object.keys((both as InputError).fieldErrors).sort()).toEqual(['processType', 'steelGradeId']);
    expect(getMockDb().read((t) => t.inspectionStandard.length)).toBe(before);
  });

  it('공통 기준은 공통을 고른 때만 연주·열연에 만들고, 제강(성분 규격)은 강종별로만 만든다 (REQ-MST-002, TRM-020)', async () => {
    actAs(SEED_EMPLOYEE_NO.quality);
    const steelmaking = await catchError(
      inspectionStandardApi.create({ processType: 'STEELMAKING', steelGradeId: COMMON_STANDARD_GRADE, items: [buildItem({ inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: '', maxValue: '0.2', maxThicknessMm: '' })] }),
    );
    expect(steelmaking).toBeInstanceOf(InputError);
    expect((steelmaking as InputError).fieldErrors.steelGradeId).toContain('강종별로');
    expect(getMockDb().read((t) => t.inspectionStandard.some((s) => s.processType === 'STEELMAKING' && s.steelGradeId === null))).toBe(false);

    const id = await inspectionStandardApi.create({ processType: 'CONTINUOUS_CASTING', steelGradeId: COMMON_STANDARD_GRADE, items: [buildItem({ inspectionItemCode: 'WIDTH', inspectionItemName: '폭', unit: 'mm', minValue: '1195', maxValue: '1210', maxThicknessMm: '' })] });
    expect(await inspectionStandardApi.get(id)).toMatchObject({ inspectionStandardCode: 'QS-COMMON-CC', steelGradeId: null, steelGradeCode: null, version: 1 });
  });

  it('검사 기준 서비스도 제강 공통 기준을 거부한다', () => {
    expect(() =>
      getMockDb().transact((tx) =>
        createInspectionStandardVersion(tx, {
          baseStandardId: null,
          processType: 'STEELMAKING',
          steelGradeId: null,
          items: [{ inspectionItemCode: 'C', inspectionItemName: '탄소', unit: '%', minValue: null, maxValue: '0.2000', minThicknessMm: null, maxThicknessMm: null, isRequired: true, sortOrder: 1 }],
        }),
      ),
    ).toThrow(InputError);
  });

  it('검사 기준 관리 사용 권한이 없으면 COM-002 (관리자는 조회만), 없는 강종은 COM-003, 제선은 거부', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.admin);
    expect(await catchError(inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: gradeId, items: [buildItem()] }))).toMatchObject({
      code: 'COM-002',
      detail: '검사 기준 관리 사용 권한이 필요해요',
    });
    actAs(SEED_EMPLOYEE_NO.qualityHead);
    expect(await catchError(inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: 9999, items: [buildItem()] }))).toMatchObject({ code: 'COM-003' });
    expect(await catchError(inspectionStandardApi.create({ processType: 'IRONMAKING', steelGradeId: gradeId, items: [buildItem()] }))).toBeInstanceOf(InputError);
  });

  it('항목 입력을 확인한다: 최소·최대 중 하나, 최소 ≤ 최대, 두께 구간(초과 < 이하), 같은 항목의 구간 겹침', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.quality);
    const error = await catchError(
      inspectionStandardApi.create({
        processType: 'HOT_ROLLING',
        steelGradeId: gradeId,
        items: [
          buildItem({ minValue: '', maxValue: '' }),
          buildItem({ inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', minValue: '630', maxValue: '490', maxThicknessMm: '' }),
          buildItem({ inspectionItemCode: 'ELONGATION', inspectionItemName: '연신율', minValue: '17', minThicknessMm: '16', maxThicknessMm: '5' }),
          buildItem({ inspectionItemCode: '1C', inspectionItemName: '' }),
        ],
      }),
    );
    expect((error as InputError).fieldErrors).toMatchObject({
      'items.0.minValue': '최소·최대 중 하나는 입력해 주세요',
      'items.1.maxValue': '최소값이 최대값보다 클 수 없어요',
      'items.2.maxThicknessMm': '두께 상한(이하)은 하한(초과)보다 커야 해요',
      'items.3.inspectionItemCode': '영문으로 시작하고 영문·숫자·밑줄만 써요 (예: C, TENSILE_STRENGTH)',
      'items.3.inspectionItemName': '항목명을 입력해 주세요',
    });

    const overlap = await catchError(
      inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: gradeId, items: [buildItem(), buildItem({ minValue: '345', minThicknessMm: '10', maxThicknessMm: '40' })] }),
    );
    expect((overlap as InputError).fieldErrors['items.1.minThicknessMm']).toBe('1행과 같은 항목 코드인데 두께 구간이 겹쳐요');
  });
});

describe('검사 기준 새 버전 (TRM-110 변경 시 새 버전 생성)', () => {
  it('새 버전을 만들면 이전 버전은 지금 버전에서 내려가고 항목은 그대로 남는다', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.quality);
    const v1 = await inspectionStandardApi.create({ processType: 'HOT_ROLLING', steelGradeId: gradeId, items: [buildItem()] });
    const v2 = await inspectionStandardApi.createVersion({ baseStandardId: v1, items: [buildItem({ minValue: '360' }), buildItem({ inspectionItemCode: 'TENSILE_STRENGTH', inspectionItemName: '인장강도', minValue: '490', maxValue: '630', maxThicknessMm: '' })] });

    const old = await inspectionStandardApi.get(v1);
    const current = await inspectionStandardApi.get(v2);
    expect(old).toMatchObject({ version: 1, isCurrent: false, itemCount: 1, currentId: v2 });
    expect(old?.items[0].minValue).toBe('355.0000');
    expect(current).toMatchObject({ inspectionStandardCode: 'QS-TEST355-HR', version: 2, isCurrent: true, itemCount: 2, versionCount: 2 });
    expect(current?.previousItems?.map((i) => i.minValue)).toEqual(['355.0000']);
    expect(current?.versions.map((v) => [v.version, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const list = await inspectionStandardApi.list({ processType: 'HOT_ROLLING', steelGradeId: gradeId });
    expect(list.filter((s) => s.inspectionStandardCode === 'QS-TEST355-HR').map((s) => s.version)).toEqual([2]);
  });

  it('지금 버전이 아닌 버전을 바탕으로 만들면 COM-001, 없는 기준은 COM-003', async () => {
    const gradeId = createTestGrade();
    actAs(SEED_EMPLOYEE_NO.quality);
    const v1 = await inspectionStandardApi.create({ processType: 'CONTINUOUS_CASTING', steelGradeId: gradeId, items: [buildItem({ inspectionItemCode: 'WIDTH', inspectionItemName: '폭', unit: 'mm', minValue: '1195', maxValue: '1210', maxThicknessMm: '' })] });
    await inspectionStandardApi.createVersion({ baseStandardId: v1, items: [buildItem({ inspectionItemCode: 'WIDTH', inspectionItemName: '폭', unit: 'mm', minValue: '1195', maxValue: '1215', maxThicknessMm: '' })] });
    expect(await catchError(inspectionStandardApi.createVersion({ baseStandardId: v1, items: [buildItem()] }))).toMatchObject({ code: 'COM-001' });
    expect(await catchError(inspectionStandardApi.createVersion({ baseStandardId: 99999, items: [buildItem()] }))).toMatchObject({ code: 'COM-003' });
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await catchError(inspectionStandardApi.createVersion({ baseStandardId: v1, items: [buildItem()] }))).toMatchObject({ code: 'COM-002' });
  });
});
