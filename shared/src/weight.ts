// 이론중량 계산 (REQ-MST-003). 부동소수 오차를 피하려고 정수(BigInt)로 계산한다.
// 1매 이론중량(t) = 두께(mm) × 폭(mm) × 길이(mm) × 7.85 ÷ 10^9 → 소수 3자리 확정값.

function toScaled(v: string | number, scale: number): bigint {
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`숫자가 아닙니다: ${v}`);
  const [i, f = ''] = s.split('.');
  return BigInt(i + f.padEnd(scale, '0').slice(0, scale));
}
function fromScaled(v: bigint, scale: number): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(scale + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
}

/** 치수(mm, 소수 2자리까지)로 1매 이론중량(톤, 소수 3자리 문자열)을 계산한다. 반올림은 사사오입. */
export function calcTheoreticalWeightTon(thicknessMm: string | number, widthMm: string | number, lengthMm: string | number): string {
  // 각 치수 ×100, 7.85 ×100 → 분모 10^9 × 10^8 = 10^17, 결과는 ×1000
  const num = toScaled(thicknessMm, 2) * toScaled(widthMm, 2) * toScaled(lengthMm, 2) * 785n * 1000n;
  const den = 10n ** 17n;
  const q = (num * 2n + den) / (den * 2n);
  return fromScaled(q, 3);
}

/** 제품 톤(표시값) = 매수 × 1매 이론중량. 저장하지 않는다 (REQ-SO-002). */
export function calcWeightTon(qty: number, theoreticalWeightTon: string | number): string {
  if (!Number.isInteger(qty)) throw new Error('매수는 정수여야 합니다');
  return fromScaled(BigInt(qty) * toScaled(theoreticalWeightTon, 3), 3);
}

/** 톤 문자열 합계 (소수 3자리). */
export function sumTon(values: (string | number)[]): string {
  return fromScaled(values.reduce((a, v) => a + toScaled(v, 3), 0n), 3);
}

/** "235.500" → "235.500 t" / 자리수 지정 표시. */
export function formatTon(v: string | number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} t`;
}
