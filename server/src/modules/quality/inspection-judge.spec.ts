import { Prisma } from '../../generated/prisma/client';
import { isItemApplicable, judgeMeasuredValue } from './inspection-judge';

const d = (value: string) => new Prisma.Decimal(value);
const range = (over: string | null, upto: string | null) => ({
  thicknessOverMm: over === null ? null : d(over),
  thicknessUptoMm: upto === null ? null : d(upto),
});

describe('적용 두께 구간 "초과~이하" (quality.md 4장, REQ-QC-002)', () => {
  it('16.00mm는 "16 이하" 구간, 16.01mm는 "16 초과 40 이하" 구간 (quality.md 7장)', () => {
    expect(isItemApplicable(range(null, '16'), d('16.00'))).toBe(true);
    expect(isItemApplicable(range('16', '40'), d('16.00'))).toBe(false);
    expect(isItemApplicable(range(null, '16'), d('16.01'))).toBe(false);
    expect(isItemApplicable(range('16', '40'), d('16.01'))).toBe(true);
  });

  it('샤르피(6 초과)는 9mm에 적용, 4.5mm·6.00mm에는 미적용', () => {
    const charpy = range('6', null);
    expect(isItemApplicable(charpy, d('9'))).toBe(true);
    expect(isItemApplicable(charpy, d('4.5'))).toBe(false);
    expect(isItemApplicable(charpy, d('6.00'))).toBe(false);
  });

  it('구간이 없으면 모든 두께에 적용, 두께가 없는 히트에는 구간 없는 항목만', () => {
    expect(isItemApplicable(range(null, null), d('250'))).toBe(true);
    expect(isItemApplicable(range(null, null), null)).toBe(true);
    expect(isItemApplicable(range(null, '50'), null)).toBe(false);
  });
});

describe('항목 판정 (REQ-QC-003)', () => {
  const limits = { minValue: d('490'), maxValue: d('630') };

  it('min·max와 같은 값은 합격 (경계 포함)', () => {
    expect(judgeMeasuredValue(limits, d('490'))).toBe(true);
    expect(judgeMeasuredValue(limits, d('630'))).toBe(true);
  });

  it('범위를 벗어나면 불합격', () => {
    expect(judgeMeasuredValue(limits, d('489.9999'))).toBe(false);
    expect(judgeMeasuredValue(limits, d('630.0001'))).toBe(false);
  });

  it('한쪽만 있는 기준은 그쪽만 본다 (음수 허용 공차 포함)', () => {
    expect(judgeMeasuredValue({ minValue: null, maxValue: d('0.2') }, d('-5'))).toBe(true);
    expect(judgeMeasuredValue({ minValue: d('-0.2'), maxValue: d('0.2') }, d('-0.2'))).toBe(true);
  });

  it('측정값이 없으면 미입력(null)', () => {
    expect(judgeMeasuredValue(limits, null)).toBeNull();
  });
});
