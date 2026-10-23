// 업무방 수주 요약의 매수 문구 (업무 프로세스 4.1 "화면 단위는 슬래브 매, 코일 개", 공통 코드 정의서 UNIT_TYPE QTY)
import { PRODUCT_QTY_UNIT, type ProductItemType } from '@/codes';
import { fmtInt } from '@/lib/format';

export interface SalesOrderItemQty {
  itemType: ProductItemType;
  orderedQty: number;
  shippedQty: number;
}

/** 수주 매수와 출고 매수를 품목 유형의 단위(슬래브 매, 코일 개)를 붙여 적는다 */
export function formatItemQty(item: SalesOrderItemQty): { ordered: string; shipped: string } {
  const unit = PRODUCT_QTY_UNIT[item.itemType];
  return { ordered: `${fmtInt(item.orderedQty)}${unit}`, shipped: `${fmtInt(item.shippedQty)}${unit}` };
}

/** 업무방 칩의 출고 한 줄: 단위가 하나면 매수 합계, 슬래브·코일이 섞이면 단위를 더할 수 없어 출고 끝난 품목 수 */
export function formatShippedSummary(items: readonly SalesOrderItemQty[]): string {
  const units = new Set(items.map((item) => PRODUCT_QTY_UNIT[item.itemType]));
  if (units.size === 1) {
    const unit = [...units][0];
    const shipped = items.reduce((sum, item) => sum + item.shippedQty, 0);
    const ordered = items.reduce((sum, item) => sum + item.orderedQty, 0);
    return `출고 ${fmtInt(shipped)}/${fmtInt(ordered)}${unit}`;
  }
  const done = items.filter((item) => item.shippedQty >= item.orderedQty).length;
  return `출고 완료 ${done}/${items.length}품목`;
}
