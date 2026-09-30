import { Prisma } from '../../generated/prisma/client';
import { isWithinLimits, judgeInspection, passingValue, type InspectionSpecItem } from './inspection-judge';

const D = (v: string | number) => new Prisma.Decimal(v);
const item = (code: string, min: number | null, max: number | null, isRequired = true, sortOrder = 0): InspectionSpecItem => ({
  inspectionItemCode: code, inspectionItemName: code, unit: null, minValue: min === null ? null : D(min), maxValue: max === null ? null : D(max), isRequired, sortOrder,
});

// SS275 코일 검사 기준(시드)과 같은 모양
const coilSpec = [item('TENSILE_STRENGTH', 410, 550, true, 0), item('YIELD_STRENGTH', 275, null, true, 1), item('ELONGATION', 18, null, true, 2), item('THICKNESS_DEVIATION', -0.3, 0.3, true, 3)];
const ok = { TENSILE_STRENGTH: 480, YIELD_STRENGTH: 300, ELONGATION: 20, THICKNESS_DEVIATION: 0 };
const values = (over: Record<string, number | string>) => Object.entries({ ...ok, ...over }).map(([inspectionItemCode, measuredValue]) => ({ inspectionItemCode, measuredValue }));

describe('자동 판정 (REQ-QC-003)', () => {
  it('min·max 경계값은 합격이다 (경계 포함)', () => {
    expect(isWithinLimits(D(410), D(410), D(550))).toBe(true);
    expect(isWithinLimits(D(550), D(410), D(550))).toBe(true);
    expect(isWithinLimits(D('409.9999'), D(410), D(550))).toBe(false);
    expect(isWithinLimits(D('550.0001'), D(410), D(550))).toBe(false);
    expect(isWithinLimits(D('-0.3'), D('-0.3'), D('0.3'))).toBe(true);
    // 한쪽 기준만 있는 항목
    expect(isWithinLimits(D(275), D(275), null)).toBe(true);
    expect(isWithinLimits(D('274.99'), D(275), null)).toBe(false);
    expect(isWithinLimits(D('0.25'), null, D('0.25'))).toBe(true);
    expect(isWithinLimits(D('0.2501'), null, D('0.25'))).toBe(false);
  });

  it('모든 항목이 기준 안이면 PASS, 경계값이어도 PASS', () => {
    const r = judgeInspection(coilSpec, values({ TENSILE_STRENGTH: 410, YIELD_STRENGTH: 275, ELONGATION: 18, THICKNESS_DEVIATION: '0.3' }));
    expect(r.ok && r.result).toBe('PASS');
    expect(r.ok && r.values.every((v) => v.isPassed === true)).toBe(true);
  });

  it('한 항목이라도 기준을 벗어나면 FAIL이고 어느 항목인지 남는다', () => {
    const r = judgeInspection(coilSpec, values({ TENSILE_STRENGTH: '550.0001' }));
    expect(r.ok && r.result).toBe('FAIL');
    expect(r.ok && r.values.filter((v) => v.isPassed === false).map((v) => v.inspectionItemCode)).toEqual(['TENSILE_STRENGTH']);
  });

  it('필수 측정값이 빠지면 판정하지 않는다 (합격 아님)', () => {
    const r = judgeInspection(coilSpec, values({}).filter((v) => v.inspectionItemCode !== 'ELONGATION'));
    expect(r).toEqual({ ok: false, reason: 'MISSING_REQUIRED', itemCodes: ['ELONGATION'] });
  });

  it('선택 항목은 비워도 되고, 입력하면 판정에 들어간다', () => {
    const spec = [...coilSpec, item('WIDTH_DEVIATION', 0, 20, false, 4)];
    const skipped = judgeInspection(spec, values({}));
    expect(skipped.ok && skipped.result).toBe('PASS');
    expect(skipped.ok && skipped.values.find((v) => v.inspectionItemCode === 'WIDTH_DEVIATION')?.isPassed).toBeNull();
    const failed = judgeInspection(spec, values({ WIDTH_DEVIATION: 21 }));
    expect(failed.ok && failed.result).toBe('FAIL');
  });

  it('기준에 없는 항목·중복 항목·기준 누락은 판정하지 않는다', () => {
    expect(judgeInspection(coilSpec, values({ UNKNOWN: 1 }))).toMatchObject({ ok: false, reason: 'UNKNOWN_ITEM', itemCodes: ['UNKNOWN'] });
    expect(judgeInspection(coilSpec, [...values({}), { inspectionItemCode: 'ELONGATION', measuredValue: 30 }])).toMatchObject({ ok: false, reason: 'DUPLICATE_ITEM' });
    expect(judgeInspection([item('X', null, null)], [{ inspectionItemCode: 'X', measuredValue: 1 }])).toMatchObject({ ok: false, reason: 'NO_LIMIT' });
    expect(judgeInspection([], [])).toMatchObject({ ok: false, reason: 'NO_SPEC' });
  });

  it('시뮬레이션 자동 합격값은 항상 기준 안쪽이다', () => {
    const cases: [number | null, number | null][] = [[410, 550], [275, null], [null, 0.25], [-5, 5], [0, 20], [null, 2], [null, 0], [0, null], [-3, null], [null, -1]];
    for (const [min, max] of cases) {
      const lo = min === null ? null : D(min);
      const hi = max === null ? null : D(max);
      expect(isWithinLimits(passingValue(lo, hi), lo, hi)).toBe(true);
    }
  });
});
