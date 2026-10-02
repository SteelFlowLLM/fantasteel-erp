// 작업 로그의 변경 전·후(before_data · after_data)를 "항목 → 값" 줄로 펴서 비교한다 (REQ-LOG-001).
// 공통 코드 값은 공통 코드 정의서 표시명으로 보인다(PLAN 4장 "표시명 = 화면 문구").
// 컬럼 이름은 코드 그룹 ID를 camelCase로 쓰므로(05 코드 컨벤션 4장) 키 이름으로 코드 그룹을 고른다.
import {
  ACTION_TYPE_LABEL,
  ACTOR_TYPE_LABEL,
  ALLOCATION_PURPOSE_LABEL,
  ALLOCATION_STATUS_LABEL,
  DISPOSITION_STATUS_LABEL,
  DRAFT_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  ITEM_TYPE_LABEL,
  LOT_RELATION_EVIDENCE_LABEL,
  LOT_STATUS_LABEL,
  LOT_TYPE_LABEL,
  PROCESS_TYPE_LABEL,
  PRODUCTION_PLAN_STATUS_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUISITION_STATUS_LABEL,
  RAW_MATERIAL_TYPE_LABEL,
  RESERVATION_STATUS_LABEL,
  SALES_ORDER_ITEM_STATUS_LABEL,
  SHIPMENT_REQUEST_STATUS_LABEL,
} from '@/codes';
import { fmtDateTime, trimNum } from '@/lib/format';
import type { JsonValue } from '@/mock/schema';

export interface DiffRow {
  /** 점으로 이은 경로 (예: inventory.onHandQty, values.C.measuredValue) */
  key: string;
  before: string | undefined;
  after: string | undefined;
  changed: boolean;
}

/** 키(경로의 마지막 이름) → 공통 코드 표시명 */
const CODE_LABEL_BY_KEY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  actionType: ACTION_TYPE_LABEL,
  actorType: ACTOR_TYPE_LABEL,
  allocationPurpose: ALLOCATION_PURPOSE_LABEL,
  allocationStatus: ALLOCATION_STATUS_LABEL,
  dispositionStatus: DISPOSITION_STATUS_LABEL,
  draftStatus: DRAFT_STATUS_LABEL,
  inspectionResult: INSPECTION_RESULT_LABEL,
  itemType: ITEM_TYPE_LABEL,
  lotRelationEvidence: LOT_RELATION_EVIDENCE_LABEL,
  lotStatus: LOT_STATUS_LABEL,
  lotType: LOT_TYPE_LABEL,
  processType: PROCESS_TYPE_LABEL,
  productionPlanStatus: PRODUCTION_PLAN_STATUS_LABEL,
  purchaseOrderStatus: PURCHASE_ORDER_STATUS_LABEL,
  purchaseRequisitionStatus: PURCHASE_REQUISITION_STATUS_LABEL,
  rawMaterialType: RAW_MATERIAL_TYPE_LABEL,
  reservationStatus: RESERVATION_STATUS_LABEL,
  salesOrderItemStatus: SALES_ORDER_ITEM_STATUS_LABEL,
  shipmentRequestStatus: SHIPMENT_REQUEST_STATUS_LABEL,
};

/** 객체 배열을 펼 때 줄 이름으로 쓰는 키 (앞에 있는 것부터). 없으면 순번(1부터). */
const ROW_ID_KEYS = ['inspectionItemCode', 'lineNo', 'lotNo', 'id'] as const;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const isPlainObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: JsonValue) => value === null || typeof value !== 'object';

const lastSegment = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

const join = (prefix: string, key: string) => (prefix ? `${prefix}.${key}` : key);

/** 값 한 칸의 화면 문구. key(경로)가 공통 코드 칸이면 표시명으로 바꾼다. */
export function formatDiffValue(value: JsonValue, key = ''): string {
  if (value === null) return '-';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  if (typeof value === 'string') {
    if (value === '') return '(빈 값)';
    const codeLabel = CODE_LABEL_BY_KEY[lastSegment(key)]?.[value];
    if (codeLabel) return codeLabel;
    // 측정값은 저장된 자리수와 상관없이 같은 글자로 보인다 (밀시트·검사 화면과 같은 규칙)
    if (lastSegment(key) === 'measuredValue') return trimNum(value);
    return ISO_DATE_TIME.test(value) ? fmtDateTime(value) : value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '(없음)';
    return value.every(isScalar) ? value.map((v) => formatDiffValue(v, key)).join(', ') : `${value.length}건`;
  }
  const size = Object.keys(value).length;
  return size === 0 ? '{}' : `${size}개 항목`;
}

/** 객체 배열의 한 줄 이름: 항목 코드·줄 번호·LOT 번호·id, 없으면 순번 */
function rowIdOf(row: { [key: string]: JsonValue }, index: number): { name: string; idKey: string | null } {
  for (const idKey of ROW_ID_KEYS) {
    const v = row[idKey];
    if (typeof v === 'string' || typeof v === 'number') return { name: String(v), idKey };
  }
  return { name: String(index + 1), idKey: null };
}

/**
 * JSON을 경로 → 값 표로 편다. 값만 있는 배열은 한 칸에 이어 쓰고,
 * 객체 배열은 줄마다 펴서 비교한다(예: 검사 값 values → values.C.measuredValue).
 */
export function flattenJson(value: JsonValue, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.set(prefix, '{}');
    for (const key of keys) flattenJson(value[key] ?? null, join(prefix, key), out);
    return out;
  }
  if (Array.isArray(value) && value.length > 0 && !value.every(isScalar)) {
    value.forEach((element, index) => {
      if (!isPlainObject(element)) {
        flattenJson(element, join(prefix, String(index + 1)), out);
        return;
      }
      const { name, idKey } = rowIdOf(element, index);
      const rowPrefix = join(prefix, name);
      const rest = Object.keys(element).filter((k) => k !== idKey);
      if (rest.length === 0) out.set(rowPrefix, name);
      for (const k of rest) flattenJson(element[k] ?? null, join(rowPrefix, k), out);
    });
    return out;
  }
  const key = prefix || '값';
  out.set(key, formatDiffValue(value, key));
  return out;
}

/** 변경 전·후 비교 줄. 둘 다 없으면 빈 배열. 키 순서는 변경 전 → 변경 후에 처음 나온 순서. */
export function diffRows(before: JsonValue | null, after: JsonValue | null): DiffRow[] {
  const b = before === null ? null : flattenJson(before);
  const a = after === null ? null : flattenJson(after);
  if (!b && !a) return [];
  const keys = [...new Set([...(b?.keys() ?? []), ...(a?.keys() ?? [])])];
  return keys.map((key) => {
    const beforeValue = b?.get(key);
    const afterValue = a?.get(key);
    return { key, before: beforeValue, after: afterValue, changed: beforeValue !== afterValue };
  });
}
