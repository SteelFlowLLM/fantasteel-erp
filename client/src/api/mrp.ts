// MRP 계산 결과 (docs/api/mrp.md 의 응답 모양 그대로).
import { api } from '@/api/client';

export interface MrpRunEmployee { id: number; employeeNo: string; employeeName: string }

export interface MrpPlanView {
  productionPlanId: number;
  productionPlanNo: string;
  productionPlanStatus: string;
  steelGradeId: number;
  steelGradeCode: string;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  salesOrderId: number | null;
  salesOrderNo: string | null;
  dueDate: string | null;
  heatCount: number;
  heatTon: string;
  hotMetalTon: string;
}

export interface MrpContribution {
  productionPlanId: number;
  productionPlanNo: string;
  salesOrderNo: string | null;
  dueDate: string | null;
  heatCount: number;
  requiredTon: string;
}

export interface MrpCoverage {
  openRequisitionTon: string;
  openRequisitions: { purchaseRequisitionId: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string; unorderedTon: string }[];
  openPurchaseOrders: { purchaseOrderId: number; purchaseOrderNo: string; dueDate: string | null; outstandingTon: string }[];
  orderedAfterRunTon: string;
  uncoveredTon: string;
  isCovered: boolean;
}

export interface MrpRequirementView {
  id: number;
  rawMaterial: { id: number; materialCode: string; rawMaterialType: string; itemName: string };
  requiredTon: string;
  remainingTon: string;
  scheduledReceiptTon: string;
  netRequiredTon: string;
  requiredDate: string | null;
  contributions: MrpContribution[];
  coverage: MrpCoverage;
}

export interface MrpRunDetail {
  id: number;
  mrpRunNo: string;
  createdAt: string;
  runEmployee: MrpRunEmployee | null;
  heatCount: number;
  heatTon: string;
  requiredHotMetalTon: string | null;
  hotMetalRemainingTon: string | null;
  hotMetalTon: string;
  plans: MrpPlanView[];
  requirements: MrpRequirementView[];
}

export interface MrpRunListItem {
  id: number;
  mrpRunNo: string;
  createdAt: string;
  runEmployee: MrpRunEmployee | null;
  heatCount: number;
  heatTon: string;
  hotMetalTon: string;
  shortageCount: number;
  totalNetRequiredTon: string;
}

export const mrpApi = {
  /** 실행한 적이 없으면 null */
  latest: () => api.get<MrpRunDetail | null>('/mrp-runs/latest'),
  list: () => api.get<MrpRunListItem[]>('/mrp-runs'),
  get: (id: number) => api.get<MrpRunDetail>(`/mrp-runs/${id}`),
  run: () => api.post<MrpRunDetail>('/mrp-runs'),
};
