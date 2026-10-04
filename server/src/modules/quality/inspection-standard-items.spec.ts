import { Prisma } from '../../generated/prisma/client';
import { findStandardItemProblem, inspectionStandardCodeOf, type StandardItemLimits } from './inspection-standard-items';

const d = (value: string | null) => (value === null ? null : new Prisma.Decimal(value));
const item = (code: string, limits: { min?: string; max?: string; over?: string; upto?: string } = {}): StandardItemLimits => ({
  inspectionItemCode: code,
  minValue: d(limits.min ?? null),
  maxValue: d(limits.max ?? null),
  thicknessOverMm: d(limits.over ?? null),
  thicknessUptoMm: d(limits.upto ?? null),
});

describe('검사 기준 코드', () => {
  it('QS-{강종 코드}-{ST·CC·HR}', () => {
    expect(inspectionStandardCodeOf('SM355A', 'STEELMAKING')).toBe('QS-SM355A-ST');
    expect(inspectionStandardCodeOf('SM355A', 'CONTINUOUS_CASTING')).toBe('QS-SM355A-CC');
    expect(inspectionStandardCodeOf('SM355A', 'HOT_ROLLING')).toBe('QS-SM355A-HR');
  });
});

describe('검사 기준 항목 검증', () => {
  it('min = max, 다른 항목 코드, 이어지는 두께 구간(16 이하 / 16 초과 40 이하)은 통과', () => {
    expect(
      findStandardItemProblem([
        item('TENSILE_STRENGTH', { min: '490', max: '490' }),
        item('YIELD_STRENGTH', { min: '355', upto: '16' }),
        item('YIELD_STRENGTH', { min: '345', over: '16', upto: '40' }),
        item('YIELD_STRENGTH', { min: '335', over: '40' }),
        item('CHARPY', { min: '27', over: '6' }),
      ]),
    ).toBeNull();
  });

  it('min > max는 거부', () => {
    expect(findStandardItemProblem([item('C', { min: '0.3', max: '0.2' })])).toContain('1번째 항목(C)');
  });

  it('두께 초과 ≥ 이하는 거부', () => {
    expect(findStandardItemProblem([item('YIELD_STRENGTH', { over: '16', upto: '16' })])).toContain('적용 두께');
  });

  it('같은 항목 코드의 두께 구간이 겹치면 거부 (구간 없음끼리, 일부 겹침)', () => {
    expect(findStandardItemProblem([item('C'), item('C')])).toContain('겹쳐요');
    expect(findStandardItemProblem([item('YIELD_STRENGTH', { upto: '16' }), item('YIELD_STRENGTH', { over: '10', upto: '40' })])).toContain(
      '1번째와 2번째',
    );
    expect(findStandardItemProblem([item('YIELD_STRENGTH', { over: '40' }), item('YIELD_STRENGTH')])).toContain('겹쳐요');
  });
});
