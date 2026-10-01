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
