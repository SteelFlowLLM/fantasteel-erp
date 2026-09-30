// 검사 화면의 순수 계산: 기준 문구, 입력 중 미리보기 판정, 게이지 위치, 채우기 도우미.
// 미리보기는 화면에서만 보여 주는 참고값이다. 저장할 때의 판정은 서버가 한다 (REQ-QC-003).
import type { InspectionSpecItem, InspectionProcessCode } from '@/api/quality';

/** 서버가 받는 측정값 모양: 숫자, 소수 4자리까지 */
const VALUE_RE = /^-?\d{1,8}(\.\d{1,4})?$/;

/** "0.2500" → "0.25", "400.0000" → "400" (문자열 그대로 자리만 정리) */
export function trimNum(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (!v.includes('.')) return v;
  return v.replace(/0+$/, '').replace(/\.$/, '');
}

type Limits = Pick<InspectionSpecItem, 'minValue' | 'maxValue' | 'unit'>;
const num = (v: string | null): number | null => (v === null || v === '' ? null : Number(v));

/** "0.18 – 0.25 %" · "400 MPa 이상" · "3 개 이하" · "기준 없음" (API가 준 기준 그대로) */
export function limitText(it: Limits): string {
  const u = it.unit ? ` ${it.unit}` : '';
  const lo = trimNum(it.minValue);
  const hi = trimNum(it.maxValue);
  if (lo && hi) return `${lo} – ${hi}${u}`;
  if (lo) return `${lo}${u} 이상`;
  if (hi) return `${hi}${u} 이하`;
  return '기준 없음';
}

export type Preview =
  | { state: 'empty' }
  | { state: 'invalid'; typing: boolean }
  | { state: 'pass'; value: number }
  | { state: 'fail'; value: number; side: 'below' | 'above'; gap: number };

/** 입력 중 미리보기: min ≤ 값 ≤ max (경계 포함). 기준이 없는 쪽은 비교하지 않는다. */
export function previewItem(raw: string, it: Limits): Preview {
  const s = raw.trim();
  if (s === '') return { state: 'empty' };
  if (!VALUE_RE.test(s)) return { state: 'invalid', typing: s === '-' || /^-?\d+\.$/.test(s) };
  const v = Number(s);
  const lo = num(it.minValue);
  const hi = num(it.maxValue);
  if (lo !== null && v < lo) return { state: 'fail', value: v, side: 'below', gap: lo - v };
  if (hi !== null && v > hi) return { state: 'fail', value: v, side: 'above', gap: v - hi };
  return { state: 'pass', value: v };
}

/** 소수 자리 정리해서 문자열로 (부동소수 오차 제거) */
const fixed = (n: number, digits = 4) => trimNum(n.toFixed(digits));
export const fmtGap = (gap: number) => fixed(gap);

/**
 * 데모용 채우기 값: 기준 안쪽 값.
 * 양쪽 기준이면 가운데, 한쪽뿐이면 그 기준에서 여유를 둔 값. 결과는 항상 기준 안(경계 포함)이다.
 */
export function suggestValue(it: Limits): string | null {
  const lo = num(it.minValue);
  const hi = num(it.maxValue);
  if (lo === null && hi === null) return null;
  const decimals = Math.max(decimalsOf(it.minValue), decimalsOf(it.maxValue));
  const digits = Math.min(4, decimals + 1);
  let v: number;
  if (lo !== null && hi !== null) v = (lo + hi) / 2;
  else if (lo !== null) v = lo + (Math.abs(lo) * 0.1 || 1);
  else v = (hi as number) - (Math.abs(hi as number) * 0.25);
  // 개수 단위는 정수로
  if (it.unit === '개') v = Math.round(v);
  let out = Number(v.toFixed(digits));
  if (lo !== null && out < lo) out = lo;
  if (hi !== null && out > hi) out = hi;
  return fixed(out, digits);
}

function decimalsOf(v: string | null): number {
  if (!v) return 0;
  const t = trimNum(v);
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}

/** 게이지의 표시 범위와 기준 구간(%) */
export function gaugeGeometry(it: Pick<InspectionSpecItem, 'minValue' | 'maxValue'>, value: number | null) {
  const lo = num(it.minValue);
  const hi = num(it.maxValue);
  if (lo === null && hi === null) return null;
  let d0: number;
  let d1: number;
  if (lo !== null && hi !== null) {
    const span = hi - lo || Math.abs(hi) || 1;
    d0 = lo - span * 0.5;
    d1 = hi + span * 0.5;
  } else if (lo !== null) {
    const pad = Math.abs(lo) * 0.25 || 1;
    d0 = lo - pad;
    d1 = lo + pad * 3;
  } else {
    const pad = Math.abs(hi as number) * 0.25 || 1;
    d0 = (hi as number) - pad * 3;
    d1 = (hi as number) + pad;
  }
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - d0) / (d1 - d0)) * 100));
  return {
    from: lo === null ? 0 : pct(lo),
    to: hi === null ? 100 : pct(hi),
    mark: value === null ? null : pct(value),
    clamped: value !== null && (value < d0 || value > d1),
  };
}

/** 검사 대기 시간: "12분" · "3시간 20분" · "2일 4시간" */
export function waitText(since: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 ${min % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

export const PROCESS_TAB_HINT: Record<InspectionProcessCode, string> = {
  STEELMAKING: '히트 성분 검사',
  CASTING: '슬래브 표면·치수 검사',
  HOT_ROLLING: '코일 치수·기계적 성질 검사',
};

export const lotIcon = (lotType: string) => (lotType === 'HEAT' ? 'flame' : lotType === 'COIL' ? 'coil' : 'slab');
