// 구매: 구매요청 → 부서장 승인 → 발주 → 입고 (docs/api/purchasing.md 의 응답 모양 그대로).
import type { GoodsReceiptStatus, PurchaseOrderStatus, PurchaseRequisitionStatus, RawMaterialType, RequisitionSourceType, YardType } from '@fantasteel/shared';
import { api } from '@/api/client';

export interface EmployeeBrief {
  id: number;
  employeeNo: string;
  employeeName: string;
  jobGrade: string;
  department: { id: number; departmentName: string };
}
export interface RawMaterialBrief { id: number; materialCode: string; rawMaterialType: string; itemName: string }
export interface SupplierBrief { id: number; supplierCode: string; supplierName: string }
export interface YardBrief { id: number; yardCode: string; yardName: string }

// ───────────── 구매요청 ─────────────
export interface PurchaseRequisitionItemView {
  id: number;
  lineNo: number;
  rawMaterial: RawMaterialBrief;
  requiredTon: string;
  orderedTon: string;
  unorderedTon: string;
}

export interface PurchaseRequisitionListItem {
  id: number;
  purchaseRequisitionNo: string;
  requesterId: number;
  departmentId: number;
  approverId: number | null;
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  desiredReceiptDate: string | null;
  requestReason: string | null;
  rejectReason: string | null;
  sourceType: RequisitionSourceType;
  sourceDraftId: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: EmployeeBrief;
  approver: EmployeeBrief | null;
  department: { id: number; departmentName: string };
  totalRequiredTon: string;
  items: PurchaseRequisitionItemView[];
}

export interface RequisitionPurchaseOrderItem {
  id: number;
  purchaseOrderId: number;
  purchaseOrderNo: string;
  purchaseOrderStatus: PurchaseOrderStatus;
  supplier: SupplierBrief;
  dueDate: string | null;
  orderedTon: string;
  receivedTon: string;
}

export interface RequisitionSourceDraft {
  id: number;
  actionType: string;
  draftStatus: string;
  confirmedAt: string | null;
  executedAt: string | null;
  message: {
    id: number;
    content: string;
    createdAt: string;
    sender: EmployeeBrief | null;
    chatRoom: { id: number; chatRoomType: string; chatRoomName: string | null };
  } | null;
}

export interface PurchaseRequisitionDetail extends Omit<PurchaseRequisitionListItem, 'items'> {
  items: (PurchaseRequisitionItemView & { purchaseOrderItems: RequisitionPurchaseOrderItem[] })[];
  sourceDraft: RequisitionSourceDraft | null;
}

export interface RequisitionItemInput { rawMaterialId: number; requiredTon: string | number }
export interface CreatePurchaseRequisitionBody {
  items: RequisitionItemInput[];
  desiredReceiptDate: string;
  requestReason?: string;
  sourceType?: 'DIRECT' | 'MRP';
  submit?: boolean;
}
export interface UpdatePurchaseRequisitionBody {
  items?: RequisitionItemInput[];
  desiredReceiptDate?: string;
  requestReason?: string;
}
export interface PurchaseRequisitionListQuery {
  status?: PurchaseRequisitionStatus;
  mine?: boolean;
  toApprove?: boolean;
}

export interface ApprovalsView {
  purchaseRequisitions: PurchaseRequisitionListItem[];
  counts: { purchaseRequisition: number; total: number };
}

export const purchaseRequisitionApi = {
  list: (q: PurchaseRequisitionListQuery = {}) =>
    api.get<PurchaseRequisitionListItem[]>('/purchase-requisitions', { status: q.status, mine: q.mine ? true : undefined, toApprove: q.toApprove ? true : undefined }),
  get: (id: number) => api.get<PurchaseRequisitionDetail>(`/purchase-requisitions/${id}`),
  create: (dto: CreatePurchaseRequisitionBody) => api.post<PurchaseRequisitionDetail>('/purchase-requisitions', dto),
  update: ({ id, ...dto }: UpdatePurchaseRequisitionBody & { id: number }) => api.patch<PurchaseRequisitionDetail>(`/purchase-requisitions/${id}`, dto),
  submit: (id: number) => api.post<PurchaseRequisitionDetail>(`/purchase-requisitions/${id}/submit`),
  approve: (id: number) => api.post<PurchaseRequisitionDetail>(`/purchase-requisitions/${id}/approve`),
  reject: ({ id, rejectReason }: { id: number; rejectReason: string }) => api.post<PurchaseRequisitionDetail>(`/purchase-requisitions/${id}/reject`, { rejectReason }),
};

export const approvalApi = {
  /** 내가 승인할 것. 부서장이 아니면 빈 목록이 온다. */
  mine: () => api.get<ApprovalsView>('/approvals'),
};

// ───────────── 발주 ─────────────
export interface PurchaseOrderItemView {
  id: number;
  lineNo: number;
  rawMaterial: RawMaterialBrief;
  purchaseRequisitionItemId: number | null;
  orderedTon: string;
  receivedTon: string;
  outstandingTon: string;
}

export interface PurchaseOrderListItem {
  id: number;
  purchaseOrderNo: string;
  supplierId: number;
  purchaseOrderStatus: PurchaseOrderStatus;
  dueDate: string | null;
  orderedEmployeeId: number | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: SupplierBrief;
  totalOrderedTon: string;
  totalReceivedTon: string;
  totalOutstandingTon: string;
  items: PurchaseOrderItemView[];
}

export interface PurchaseOrderReceiptBrief {
  id: number;
  goodsReceiptNo: string;
  goodsReceiptStatus: GoodsReceiptStatus;
  receivedTon: string;
  receiptDate: string;
  confirmedAt: string | null;
  yard: YardBrief | null;
  lot: { id: number; lotNo: string; remainingTon: string } | null;
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderListItem, 'items'> {
  items: (PurchaseOrderItemView & {
    purchaseRequisition: { id: number; purchaseRequisitionNo: string; lineNo: number } | null;
    goodsReceipts: PurchaseOrderReceiptBrief[];
  })[];
}

export interface OrderableItem {
  purchaseRequisitionItemId: number;
  purchaseRequisitionId: number;
  purchaseRequisitionNo: string;
  desiredReceiptDate: string | null;
  lineNo: number;
  rawMaterial: RawMaterialBrief;
  requiredTon: string;
  orderedTon: string;
  unorderedTon: string;
}
export interface OrderableGroup {
  supplier: SupplierBrief | null;
  items: OrderableItem[];
  totalUnorderedTon: string;
}

export interface CreatePurchaseOrderBody {
  supplierId: number;
  dueDate: string;
  items: { purchaseRequisitionItemId: number; orderedTon: string | number }[];
}
export interface PurchaseOrderListQuery { status?: PurchaseOrderStatus; supplierId?: number }

export const purchaseOrderApi = {
  list: (q: PurchaseOrderListQuery = {}) => api.get<PurchaseOrderListItem[]>('/purchase-orders', { status: q.status, supplierId: q.supplierId }),
  orderable: () => api.get<OrderableGroup[]>('/purchase-orders/orderable'),
  get: (id: number) => api.get<PurchaseOrderDetail>(`/purchase-orders/${id}`),
  create: (dto: CreatePurchaseOrderBody) => api.post<PurchaseOrderDetail>('/purchase-orders', dto),
};

// ───────────── 입고 ─────────────
export interface GoodsReceiptView {
  id: number;
  goodsReceiptNo: string;
  purchaseOrderItemId: number;
  receivedTon: string;
  receiptDate: string;
  yardId: number | null;
  goodsReceiptStatus: GoodsReceiptStatus;
  note: string | null;
  confirmedEmployeeId: number | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  yard: YardBrief | null;
  lot: { id: number; lotNo: string; initialTon: string; remainingTon: string } | null;
  rawMaterial: RawMaterialBrief;
  purchaseOrder: { id: number; purchaseOrderNo: string; purchaseOrderStatus: PurchaseOrderStatus; supplier: SupplierBrief };
  purchaseOrderItem: { id: number; lineNo: number; orderedTon: string; receivedTon: string; outstandingTon: string };
}

export interface CreateGoodsReceiptBody {
  purchaseOrderItemId: number;
  receivedTon: string | number;
  receiptDate: string;
  yardId?: number;
  note?: string;
}
export interface GoodsReceiptListQuery { status?: GoodsReceiptStatus; purchaseOrderId?: number }

export const goodsReceiptApi = {
  list: (q: GoodsReceiptListQuery = {}) => api.get<GoodsReceiptView[]>('/goods-receipts', { status: q.status, purchaseOrderId: q.purchaseOrderId }),
  create: (dto: CreateGoodsReceiptBody) => api.post<GoodsReceiptView>('/goods-receipts', dto),
  confirm: (id: number) => api.post<GoodsReceiptView>(`/goods-receipts/${id}/confirm`),
};

// ───────────── 선택 목록 (GET /master-data/lookups 에서 구매 화면이 쓰는 부분) ─────────────
export interface PurchasingLookups {
  rawMaterials: { id: number; materialCode: string; name: string; rawMaterialType: RawMaterialType; defaultSupplierId: number | null; yardId: number | null }[];
  suppliers: SupplierBrief[];
  yards: { id: number; yardCode: string; yardName: string; yardType: YardType }[];
}
export const purchasingLookupApi = {
  get: () => api.get<PurchasingLookups>('/master-data/lookups'),
};
