// 화면 선택 목록 (docs/api/master-data.md — GET /master-data/lookups). 로그인한 모든 사원이 쓸 수 있다.
import type { RawMaterialType, YardType } from '@fantasteel/shared';
import { api } from './client';

export interface LookupSteelGrade { id: number; steelGradeCode: string; steelGradeName: string }
export interface LookupProductSpec {
  id: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  /** 1매 이론중량 "23.550" (소수 3자리 확정값) */
  theoreticalWeightTon: string;
  /** 슬래브면 매핑된 코일 규격 id, 코일이면 매핑된 슬래브 규격 id */
  mappedSpecId: number | null;
}
export interface LookupCustomer { id: number; customerCode: string; customerName: string }

export interface Lookups {
  steelGrades: LookupSteelGrade[];
  productSpecs: LookupProductSpec[];
  rawMaterials: { id: number; materialCode: string; name: string; rawMaterialType: RawMaterialType; defaultSupplierId: number | null; yardId: number | null }[];
  customers: LookupCustomer[];
  suppliers: { id: number; supplierCode: string; supplierName: string }[];
  yards: { id: number; yardCode: string; yardName: string; yardType: YardType }[];
  productionSetting: { heatCapacityTon: string; deliveryRiskDays: number } | null;
}

export const lookupApi = {
  get: () => api.get<Lookups>('/master-data/lookups'),
};
