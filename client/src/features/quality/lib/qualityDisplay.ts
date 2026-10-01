// 검사 입력·불합격 관리 화면의 순수 계산: 기준 문구, 입력 중 미리보기, 게이지 위치, '기준 안 값으로 채우기', 수정 전후 비교.
// 판정 자체는 2단계 판정 함수(lib/inspectionJudgment)를 그대로 쓴다. 저장할 때의 판정은 가짜 서버(registerInspection)가 한다 (REQ-QC-003).
import type { LotType, ProcessType } from '@/codes';
import type { IconName } from '@/components/Icon';
import { decCmp, decSub } from '@/lib/decimal';
import { judgeValue, typicalPassValue } from '@/lib/inspectionJudgment';
import type { JsonValue } from '@/mock/schema';

/** 측정값 형식: 정수 8자리·소수 4자리까지, 음수 허용 (quality_inspection_value.measured_value, 가짜 서버 checkDecimal과 같은 규칙) */
export const MEASURED_VALUE_PATTERN = /^-?\d{1,8}(\.\d{1,4})?$/;

/** 공정별 검사 이름 (REQ-QC-001 문구) */
export const INSPECTION_NAME: Partial<Record<ProcessType, string>> = {
  STEELMAKING: '히트 성분 검사',
  CONTINUOUS_CASTING: '슬래브 표면·치수 검사',
  HOT_ROLLING: '코일 치수·기계적 성질 검사',
};

export const inspectionNameOf = (processType: string): string => INSPECTION_NAME[processType as ProcessType] ?? '검사';

/** 검사 대상 LOT 유형의 아이콘 */
export const lotIconOf = (lotType: LotType): IconName => (lotType === 'HEAT' ? 'flame' : lotType === 'COIL' ? 'coil' : 'slab');

/** "0.2500" → "0.25", "400.0000" → "400" (문자열 그대로 자리만 정리) */
export function trimNum(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

export interface LimitLike {
  minValue: string | null;
  maxValue: string | null;
  unit?: string | null;
}

/** "0.18 – 0.25 %" · "355 MPa 이상" · "0.045 % 이하" · "기준 없음" (경계 포함) */
export function limitText(item: LimitLike): string {
  const unit = item.unit ? ` ${item.unit}` : '';
  const lo = trimNum(item.minValue);
  const hi = trimNum(item.maxValue);
  if (lo && hi) return `${lo} – ${hi}${unit}`;
  if (lo) return `${lo}${unit} 이상`;
  if (hi) return `${hi}${unit} 이하`;
  return '기준 없음';
}

/** 적용 두께 구간 문구 (초과~이하). 구간이 없으면 null */
export function thicknessBandText(minThicknessMm: string | null, maxThicknessMm: string | null): string | null {
  const lo = trimNum(minThicknessMm);
  const hi = trimNum(maxThicknessMm);
  if (lo && hi) return `두께 ${lo} 초과 ~ ${hi} 이하 mm`;
  if (lo) return `두께 ${lo} mm 초과`;
  if (hi) return `두께 ${hi} mm 이하`;
  return null;
}

export type ValuePreview =
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'pass' }
  | { state: 'fail'; side: 'below' | 'above'; gap: string };

/** 입력 중 미리보기: 형식 확인 뒤 판정 함수(judgeValue, 경계 포함)로 본다. 벗어나면 얼마나 벗어났는지(gap)도 준다. */
export function previewOf(raw: string, item: LimitLike): ValuePreview {
  const text = raw.trim();
  if (text === '') return { state: 'empty' };
  if (!MEASURED_VALUE_PATTERN.test(text)) return { state: 'invalid' };
  const passed = judgeValue({ minValue: item.minValue, maxValue: item.maxValue }, text);
  if (passed !== false) return { state: 'pass' };
  if (item.minValue !== null && decCmp(text, item.minValue) < 0) return { state: 'fail', side: 'below', gap: trimNum(decSub(item.minValue, text, 4)) };
  return { state: 'fail', side: 'above', gap: trimNum(decSub(text, item.maxValue ?? text, 4)) };
}

/** 게이지 표시 범위 안에서 기준 구간과 측정값의 위치(%). 기준이 하나도 없으면 null */
export function gaugeGeometry(item: LimitLike, value: string | null): { from: number; to: number; mark: number | null } | null {
  const lo = item.minValue === null ? null : Number(item.minValue);
  const hi = item.maxValue === null ? null : Number(item.maxValue);
  if (lo === null && hi === null) return null;
  let start: number;
  let end: number;
  if (lo !== null && hi !== null) {
    const span = hi - lo || Math.abs(hi) || 1;
    start = lo - span * 0.5;
    end = hi + span * 0.5;
  } else if (lo !== null) {
    const pad = Math.abs(lo) * 0.25 || 1;
    start = lo - pad;
    end = lo + pad * 3;
  } else {
    const max = hi ?? 0;
    const pad = Math.abs(max) * 0.25 || 1;
    start = max - pad * 3;
    end = max + pad;
  }
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - start) / (end - start)) * 100));
  const measured = value !== null && MEASURED_VALUE_PATTERN.test(value.trim()) ? Number(value) : null;
  return { from: lo === null ? 0 : pct(lo), to: hi === null ? 100 : pct(hi), mark: measured === null ? null : pct(measured) };
}

/**
 * '기준 안 값으로 채우기' (시연 편의, PLAN 5장): 비어 있는 칸만 기준 안 대표값(typicalPassValue)으로 채운다.
 * 이미 적은 값은 그대로 둔다. 저장은 사람이 직접 누른다.
 */
export function fillTypicalValues<T extends LimitLike & { inspectionStandardItemId: number }>(
  items: readonly T[],
  raw: Readonly<Record<number, string>>,
): Record<number, string> {
  const next: Record<number, string> = { ...raw };
  for (const item of items) {
    if ((raw[item.inspectionStandardItemId] ?? '').trim() !== '') continue;
    const value = typicalPassValue(item);
    if (value !== null) next[item.inspectionStandardItemId] = trimNum(value) || '0';
  }
  return next;
}

/** 저장된 값과 입력칸 값이 같은지 (자리수만 다른 값은 같다고 본다: "0.180" = "0.18") */
export function sameMeasuredValue(saved: string | null, raw: string): boolean {
  const text = raw.trim();
  if (saved === null || saved === '') return text === '';
  if (text === '') return false;
  if (!MEASURED_VALUE_PATTERN.test(text)) return false;
  return decCmp(saved, text) === 0;
}

export interface MeasuredValueChange {
  inspectionItemCode: string;
  before: string | null;
  after: string | null;
}

const asRecord = (value: JsonValue | null | undefined): Record<string, JsonValue> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : null;

function valuesOfSnapshot(snapshot: JsonValue | null | undefined): Map<string, string | null> {
  const values = asRecord(snapshot)?.values;
  const map = new Map<string, string | null>();
  if (!Array.isArray(values)) return map;
  for (const entry of values) {
    const row = asRecord(entry);
    const code = row?.inspectionItemCode;
    const measured = row?.measuredValue;
    if (typeof code === 'string') map.set(code, typeof measured === 'string' ? measured : null);
  }
  return map;
}

/** 작업 로그 INSPECTION_REGISTERED의 전후 값에서 바뀐 측정값만 꺼낸다 (REQ-QC-003 "변경 전·후") */
export function measuredValueChanges(beforeData: JsonValue | null, afterData: JsonValue | null): MeasuredValueChange[] {
  const before = valuesOfSnapshot(beforeData);
  const after = valuesOfSnapshot(afterData);
  const codes = [...new Set([...before.keys(), ...after.keys()])];
  return codes
    .map((code) => ({ inspectionItemCode: code, before: before.get(code) ?? null, after: after.get(code) ?? null }))
    .filter((change) => (change.before === null || change.after === null ? change.before !== change.after : decCmp(change.before, change.after) !== 0));
}

/** 작업 로그 스냅샷의 판정 결과 (없으면 null) */
export function inspectionResultOfSnapshot(snapshot: JsonValue | null): 'PENDING' | 'PASS' | 'FAIL' | null {
  const result = asRecord(snapshot)?.inspectionResult;
  return result === 'PENDING' || result === 'PASS' || result === 'FAIL' ? result : null;
}
