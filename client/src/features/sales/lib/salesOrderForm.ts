// 수주 화면의 순수 계산: 매수 입력 확인(4.1·SO-002), 등록 줄 상태, 수량 단위, 충족 지표 표시(4.5 분모 명시), 목록 거르기.
import { ERROR_MESSAGE, PRODUCT_QTY_UNIT, type ProductItemType, type SalesOrderItemStatus } from '@/codes';
import type { ProgressMeasure } from '@/lib/inventoryMath';

/** 매수: 1 이상 정수만. 소수·0·음수·글자는 거부하고, 글자를 지우거나 반올림하지 않는다 (4.1, SO-002). */
export function parseOrderedQty(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const qty = Number(text);
  return Number.isSafeInteger(qty) && qty >= 1 ? qty : null;
}

export interface DraftLine {
  key: string;
  itemType: ProductItemType;
  steelGradeId: number | null;
  itemId: number | null;
  qtyText: string;
  dueDate: string;
}

export interface DraftLineErrors {
  itemId?: string;
  qty?: string;
  dueDate?: string;
}

/** 한 줄의 입력 오류. submitted 전에는 입력한 칸만 확인한다. */
export function draftLineErrors(line: DraftLine, submitted: boolean): DraftLineErrors {
  const errors: DraftLineErrors = {};
  if (line.itemId === null && submitted) errors.itemId = '규격을 선택해 주세요';
  if ((line.qtyText !== '' || submitted) && parseOrderedQty(line.qtyText) === null) errors.qty = ERROR_MESSAGE['SO-002'];
  if (line.dueDate === '' && submitted) errors.dueDate = '납기를 입력해 주세요';
  return errors;
}

export const hasLineErrors = (errors: DraftLineErrors): boolean => Boolean(errors.itemId || errors.qty || errors.dueDate);

/** 미리보기에 넘길 줄: 규격과 매수가 맞는 줄만 (원래 줄 위치를 함께 준다) */
export function previewLinesOf(lines: readonly DraftLine[]): { index: number; itemId: number; orderedQty: number }[] {
  return lines.flatMap((line, index) => {
    const qty = parseOrderedQty(line.qtyText);
    return line.itemId !== null && qty !== null ? [{ index, itemId: line.itemId, orderedQty: qty }] : [];
  });
}

/** 수량 단위: 슬래브 매, 코일 개. 섞이면 '매·개' */
export function qtyUnitOf(itemTypes: readonly ProductItemType[]): string {
  const units = [...new Set(itemTypes.map((t) => PRODUCT_QTY_UNIT[t]))];
  return units.length === 1 ? (units[0] ?? '매') : units.length === 0 ? '매' : '매·개';
}

/** 진행률(%)은 버림으로 보인다. 분모가 0이면 null */
export const percentOf = (measure: ProgressMeasure): number | null => (measure.ratio === null ? null : Math.floor(measure.ratio * 100));

/** "6 / 10매" — 분모를 늘 함께 보인다 (4.5) */
export const measureText = (measure: ProgressMeasure, unit: string): string => `${measure.qty.toLocaleString('en-US')} / ${measure.denominatorQty.toLocaleString('en-US')}${unit}`;

export type SalesOrderStatusFilter = 'ALL' | SalesOrderItemStatus;
export type ItemTypeFilter = 'ALL' | ProductItemType;

export interface SalesOrderFilter {
  status: SalesOrderStatusFilter;
  customerId: number | null;
  itemType: ItemTypeFilter;
  riskOnly: boolean;
  keyword: string;
}

export const EMPTY_FILTER: SalesOrderFilter = { status: 'ALL', customerId: null, itemType: 'ALL', riskOnly: false, keyword: '' };

export interface FilterableSalesOrder {
  salesOrderNo: string;
  customerId: number;
  customerName: string;
  status: SalesOrderItemStatus;
  itemTypes: readonly ProductItemType[];
  isDueRisk: boolean;
}

/** 목록 거르기 (화면 편의, PLAN 5장: 필터는 남긴다) */
export function filterSalesOrders<T extends FilterableSalesOrder>(rows: readonly T[], filter: SalesOrderFilter): T[] {
  const keyword = filter.keyword.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filter.status === 'ALL' || row.status === filter.status) &&
      (filter.customerId === null || row.customerId === filter.customerId) &&
      (filter.itemType === 'ALL' || row.itemTypes.includes(filter.itemType)) &&
      (!filter.riskOnly || row.isDueRisk) &&
      (keyword === '' || row.salesOrderNo.toLowerCase().includes(keyword) || row.customerName.toLowerCase().includes(keyword)),
  );
}

/** 적용한 필터 수 (키워드 제외) */
export const activeFilterCount = (filter: SalesOrderFilter): number =>
  [filter.status !== 'ALL', filter.customerId !== null, filter.itemType !== 'ALL', filter.riskOnly].filter(Boolean).length;
