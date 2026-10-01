// 십진수 계산 (톤·수율·원단위). 부동소수 오차가 없도록 BigInt로 계산한다 (업무 프로세스 4.1 "십진수 연산").
// 값은 문자열로 주고받는다 (컨벤션 5장 "Decimal은 문자열"). 반올림은 0.5에서 올림(절댓값 기준)으로 lib/weight.ts와 같다.

/** 톤: 소수 3자리 (ERD decimal(12,3)) */
export const TON_DIGITS = 3;
/** 수율·손실률: 소수 4자리 (ERD decimal(6,4)) */
export const RATE_DIGITS = 4;

export type DecimalInput = string | number;

interface Scaled {
  units: bigint;
  scale: number;
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

function parse(value: DecimalInput): Scaled {
  const text = typeof value === 'number' ? numberText(value) : value.trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new RangeError(`숫자 형식이 아니에요: ${String(value)}`);
  const [, sign, integerPart, fractionPart = ''] = match;
  const units = BigInt(`${integerPart}${fractionPart}`);
  return { units: sign === '-' ? -units : units, scale: fractionPart.length };
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`숫자 형식이 아니에요: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(12).replace(/\.?0+$/, '');
}

/** 나눗셈 몫을 0.5에서 올림(절댓값 기준)한다. divisor는 0이 아니다. */
function divideRounded(dividend: bigint, divisor: bigint): bigint {
  const negative = dividend < 0n !== divisor < 0n;
  const a = dividend < 0n ? -dividend : dividend;
  const b = divisor < 0n ? -divisor : divisor;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function rescale(value: Scaled, scale: number): bigint {
  if (scale >= value.scale) return value.units * pow10(scale - value.scale);
  return divideRounded(value.units, pow10(value.scale - scale));
}

/** scale 자리 정수 단위로 바꾼다 ("23.55", 3 → 23550n) */
export function toUnits(value: DecimalInput, scale: number): bigint {
  return rescale(parse(value), scale);
}

/** 정수 단위를 문자열로 (23550n, 3 → "23.550") */
export function fromUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/** 자리수를 맞춘다 ("2.5", 3 → "2.500") */
export const decRound = (value: DecimalInput, scale: number = TON_DIGITS): string => fromUnits(toUnits(value, scale), scale);

export const decAdd = (a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string => fromUnits(toUnits(a, scale) + toUnits(b, scale), scale);

export const decSub = (a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string => fromUnits(toUnits(a, scale) - toUnits(b, scale), scale);

export function decSum(values: readonly DecimalInput[], scale: number = TON_DIGITS): string {
  let total = 0n;
  for (const value of values) total += toUnits(value, scale);
  return fromUnits(total, scale);
}

/** a × b를 정확히 곱한 뒤 scale 자리로 반올림 */
export function decMul(a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string {
  const x = parse(a);
  const y = parse(b);
  return fromUnits(rescale({ units: x.units * y.units, scale: x.scale + y.scale }, scale), scale);
}

/** a ÷ b를 scale 자리로 반올림. b가 0이면 RangeError. */
export function decDiv(a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string {
  const x = parse(a);
  const y = parse(b);
  if (y.units === 0n) throw new RangeError('0으로 나눌 수 없어요');
  // x/y = (xu/10^xs) / (yu/10^ys) → 결과 단위(10^-scale) = xu·10^(ys+scale) / (yu·10^xs)
  return fromUnits(divideRounded(x.units * pow10(y.scale + scale), y.units * pow10(x.scale)), scale);
}

/** a < b → -1, 같으면 0, a > b → 1 */
export function decCmp(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  const left = rescale(x, scale);
  const right = rescale(y, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}

export const decMax = (a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string => decRound(decCmp(a, b) >= 0 ? a : b, scale);
export const decMin = (a: DecimalInput, b: DecimalInput, scale: number = TON_DIGITS): string => decRound(decCmp(a, b) <= 0 ? a : b, scale);
export const decIsPositive = (value: DecimalInput): boolean => decCmp(value, 0) > 0;
export const decIsZero = (value: DecimalInput): boolean => decCmp(value, 0) === 0;

/** ceil(a ÷ b). 히트 수 = ceil(필요 용강 ÷ 히트 용량) (업무 프로세스 4.4). b > 0. */
export function decCeilDiv(a: DecimalInput, b: DecimalInput): number {
  const x = parse(a);
  const y = parse(b);
  if (y.units <= 0n) throw new RangeError('나누는 값은 0보다 커야 해요');
  const numerator = x.units * pow10(y.scale);
  const denominator = y.units * pow10(x.scale);
  const quotient = numerator / denominator;
  const ceil = numerator % denominator === 0n || numerator < 0n ? quotient : quotient + 1n;
  return Number(ceil);
}

/** floor(a ÷ b). 히트 1개에서 나오는 슬래브 매수 등. b > 0, a ≥ 0. */
export function decFloorDiv(a: DecimalInput, b: DecimalInput): number {
  const x = parse(a);
  const y = parse(b);
  if (y.units <= 0n) throw new RangeError('나누는 값은 0보다 커야 해요');
  if (x.units < 0n) throw new RangeError('나뉘는 값은 0 이상이어야 해요');
  return Number((x.units * pow10(y.scale)) / (y.units * pow10(x.scale)));
}

/** floor(정수 × 비율). 손실 매수 = floor(계획 슬래브 매수 × 샘플 손실률) (업무 프로세스 8장). */
export function floorMulInt(qty: number, rate: DecimalInput): number {
  if (!Number.isInteger(qty) || qty < 0) throw new RangeError(`매수는 0 이상의 정수여야 해요: ${qty}`);
  const r = parse(rate);
  if (r.units < 0n) throw new RangeError('비율은 0 이상이어야 해요');
  return Number((BigInt(qty) * r.units) / pow10(r.scale));
}

/** 십진수 글자인지 (부호·소수점 허용, 지수 표기 불가) */
export const isDecimalText = (value: string): boolean => DECIMAL_PATTERN.test(value.trim());
