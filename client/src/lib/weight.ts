// 이론중량·톤 계산. 부동소수 오차가 없도록 BigInt 십진 연산을 쓴다 (업무 프로세스 4.1 "십진수 연산").
// 1매(1개) 이론중량(t) = 두께(mm) × 폭(mm) × 길이(mm) × 7.85 ÷ 10^9 → 소수 3자리 확정값 (REQ-MST-003)
// 제품 톤 = 매수 × 1매 이론중량 (계산값, 저장하지 않음, REQ-SO-002)
// 반올림은 0.5에서 올림(절댓값 기준)이다. 문서에 반올림 방식이 없어 가정했다.

export const TON_SCALE = 3;
export const YIELD_RATE_SCALE = 4;

interface Scaled {
  units: bigint;
  scale: number;
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const DENSITY: Scaled = { units: 785n, scale: 2 }; // 7.85 t/m³
const MM3_TO_M3_SCALE = 9; // mm³ → m³ (÷ 10^9)

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

function parseDecimal(value: string | number): Scaled {
  const text = typeof value === 'number' ? String(value) : value.trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new RangeError(`숫자 형식이 아니에요: ${String(value)}`);
  const [, sign, integerPart, fractionPart = ''] = match;
  const units = BigInt(`${integerPart}${fractionPart}`);
  return { units: sign === '-' ? -units : units, scale: fractionPart.length };
}

function parsePositive(value: string | number, label: string): Scaled {
  const parsed = parseDecimal(value);
  if (parsed.units <= 0n) throw new RangeError(`${label}는 0보다 커야 해요: ${String(value)}`);
  return parsed;
}

/** 나눗셈 몫을 0.5에서 올림(절댓값 기준)한다. divisor는 양수. */
function divideRounded(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (remainder === 0n) return quotient;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < divisor) return quotient;
  return dividend < 0n ? quotient - 1n : quotient + 1n;
}

function rescale(value: Scaled, scale: number): bigint {
  if (scale >= value.scale) return value.units * pow10(scale - value.scale);
  return divideRounded(value.units, pow10(value.scale - scale));
}

function toText(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/** 소수 자리수를 맞춘 문자열 ("23.55", 3 → "23.550") */
export function formatDecimal(value: string | number, scale: number): string {
  return toText(rescale(parseDecimal(value), scale), scale);
}

/** 두 십진수 비교: a < b → -1, 같으면 0, a > b → 1 */
export function compareDecimal(a: string | number, b: string | number): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const scale = Math.max(x.scale, y.scale);
  const left = rescale(x, scale);
  const right = rescale(y, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** 1매(1개) 이론중량(t). 250 × 1200 × 10000 → "23.550" */
export function calcTheoreticalWeightTon(thicknessMm: string | number, widthMm: string | number, lengthMm: string | number): string {
  const thickness = parsePositive(thicknessMm, '두께');
  const width = parsePositive(widthMm, '폭');
  const length = parsePositive(lengthMm, '길이');
  const product: Scaled = {
    units: thickness.units * width.units * length.units * DENSITY.units,
    scale: thickness.scale + width.scale + length.scale + DENSITY.scale + MM3_TO_M3_SCALE,
  };
  return toText(rescale(product, TON_SCALE), TON_SCALE);
}

/** 매수 × 1매 이론중량(t). 10매 × 23.550 → "235.500" */
export function calcWeightTon(qty: number, theoreticalWeightTon: string): string {
  if (!Number.isInteger(qty) || qty < 0) throw new RangeError(`매수는 0 이상의 정수여야 해요: ${qty}`);
  const unitWeight = rescale(parseDecimal(theoreticalWeightTon), TON_SCALE);
  return toText(unitWeight * BigInt(qty), TON_SCALE);
}

/** 톤 합계 (소수 3자리) */
export function sumTon(values: ReadonlyArray<string | number>): string {
  let total = 0n;
  for (const value of values) total += rescale(parseDecimal(value), TON_SCALE);
  return toText(total, TON_SCALE);
}

/** 열연 계획 수율 = 코일 1개 이론중량 ÷ 슬래브 1매 이론중량 (REQ-MST-004, 저장하지 않음). 소수 4자리. */
export function calcHotRollingYieldRate(coilWeightTon: string, slabWeightTon: string): string {
  const coil = parseDecimal(coilWeightTon);
  const slab = parsePositive(slabWeightTon, '슬래브 이론중량');
  const numerator = coil.units * pow10(slab.scale + YIELD_RATE_SCALE);
  const denominator = slab.units * pow10(coil.scale);
  return toText(divideRounded(numerator, denominator), YIELD_RATE_SCALE);
}
