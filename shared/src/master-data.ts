// 기준정보 조회 응답 타입 (REQ-MST-001·002·007, docs/backend/master-data.md). 톤·치수는 문자열.
import type { ItemType, UnitType } from './codes';

export interface CustomerView {
  id: number;
  customerCode: string;
  customerName: string;
}

export interface ItemView {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitType: UnitType;
  /** 제품만 */
  steelGradeId: number | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  widthMm: string | null;
  lengthMm: string | null;
  /** 1매 이론중량(t, 소수 3자리). 제품만 */
  theoreticalWeightTon: string | null;
  defaultYardId: number;
}
