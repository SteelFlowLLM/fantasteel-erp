# purchasing API

구매요청 → 부서장 승인 → 발주 → 부분 입고 → 원료 LOT (REQ-PUR-001~004, REQ-AUTH-004, BP-PUR-01·02).
모든 경로는 `/api/v1` 아래, 로그인 필요(`Authorization: Bearer …`).
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8805, DB `fs_pur`)에 curl로 호출한 응답에서 옮겼다.

- 톤은 **문자열**(소수 3자리, 예 `"150.000"`)로 온다. 요청에서는 문자열 `"40.25"` 또는 숫자 `40.25` 둘 다 받는다 (소수 3자리 이하).
- 시각은 ISO 8601 문자열. 날짜만 있는 값(`desiredReceiptDate`, `dueDate`, `receiptDate`)은 요청은 `"YYYY-MM-DD"`, 응답은 `"2026-10-10T00:00:00.000Z"` 모양이다 → 화면에서는 앞 10자리만 쓴다.
- 상태값은 `@fantasteel/shared`의 `PURCHASE_REQUISITION_STATUS` · `PURCHASE_ORDER_STATUS` · `GOODS_RECEIPT_STATUS` · `REQUISITION_SOURCE_TYPE`와 `…_LABEL`을 쓴다.

## 권한 요약

| API | 필요한 권한 |
|---|---|
| `GET /purchase-requisitions` | `PURCHASE_REQUISITION_CREATE` 또는 `PO_CONFIRM` VIEW 이상 |
| `GET /purchase-requisitions/:id` | 위 권한이 있거나, 그 구매요청의 **요청자·승인권자** (역할 무관) |
| `POST /purchase-requisitions`, `PATCH /:id`, `POST /:id/submit` | `PURCHASE_REQUISITION_CREATE` USE (+ 수정·제출은 요청자 본인만) |
| `POST /:id/approve`, `POST /:id/reject` | 역할 권한 없음. **그 구매요청의 승인권자(`approver.id`)만** (service에서 로그인 사원과 비교) |
| `GET /approvals` | 로그인만 (부서장이 아니면 빈 목록) |
| `GET /purchase-orders`, `GET /purchase-orders/:id` | `PO_CONFIRM` · `RECEIPT_CONFIRM` · `PURCHASE_REQUISITION_CREATE` 중 하나 VIEW 이상 |
| `GET /purchase-orders/orderable` | `PO_CONFIRM` VIEW 이상 |
| `POST /purchase-orders` | `PO_CONFIRM` USE |
| `GET /goods-receipts` | `RECEIPT_CONFIRM` 또는 `PO_CONFIRM` VIEW 이상 |
| `POST /goods-receipts`, `POST /goods-receipts/:id/confirm` | `RECEIPT_CONFIRM` USE |

시드 기준: 구매(서구매·남구매)는 전부 USE, 생산(최생산·박생산·강생산)은 구매요청 등록만 USE, 관리자는 VIEW만, 영업·품질은 없음(403 `COM-002`).

## 공통 타입

```ts
type PurchaseRequisitionStatus = 'DRAFT' | 'WAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ORDERED';
type RequisitionSourceType = 'DIRECT' | 'MRP' | 'MESSAGE';
type PurchaseOrderStatus = 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
type GoodsReceiptStatus = 'DRAFT' | 'CONFIRMED';

interface EmployeeBrief {
  id: number;
  employeeNo: string;
  employeeName: string;
  jobGrade: string;
  department: { id: number; departmentName: string };
}
interface RawMaterialBrief {
  id: number;
  materialCode: string;       // 'IO' | 'CL' | 'LS' | 'FM' | 'FS' …
  rawMaterialType: string;    // RAW_MATERIAL_TYPE
  itemName: string;           // '철광석'
}
interface SupplierBrief { id: number; supplierCode: string; supplierName: string }
interface YardBrief { id: number; yardCode: string; yardName: string }
```

---

## 1. 구매요청

```ts
interface PurchaseRequisitionItemView {
  id: number;                 // 발주할 때 purchaseRequisitionItemId로 쓴다. PATCH로 품목을 바꾸면 id가 새로 생긴다
  lineNo: number;
  rawMaterial: RawMaterialBrief;
  requiredTon: string;        // 요청 수량
  orderedTon: string;         // 발주로 넘어간 누계
  unorderedTon: string;       // 아직 발주하지 않은 양 = requiredTon − orderedTon
}

/** GET /purchase-requisitions 의 원소, GET /approvals 의 purchaseRequisitions 원소 */
interface PurchaseRequisitionListItem {
  id: number;
  purchaseRequisitionNo: string;          // 'PR-20260930-0074'
  requesterId: number;
  departmentId: number;                   // 요청자 소속 부서
  approverId: number | null;              // 제출 전에는 null
  purchaseRequisitionStatus: PurchaseRequisitionStatus;
  desiredReceiptDate: string | null;      // '2026-10-10T00:00:00.000Z'
  requestReason: string | null;
  rejectReason: string | null;            // 반려 상태일 때만. 다시 제출하면 null
  sourceType: RequisitionSourceType;
  sourceDraftId: number | null;           // MESSAGE일 때 Action Draft id
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: EmployeeBrief;
  approver: EmployeeBrief | null;         // 승인권자(부서장). 요청자가 부서장이면 상위 부서의 부서장
  department: { id: number; departmentName: string };   // 요청자 소속 부서
  totalRequiredTon: string;
  items: PurchaseRequisitionItemView[];
}

/** GET /purchase-requisitions/:id, 그리고 POST·PATCH·submit·approve·reject 의 응답 */
interface PurchaseRequisitionDetail extends Omit<PurchaseRequisitionListItem, 'items'> {
  items: (PurchaseRequisitionItemView & {
    /** 이 품목으로 만든 발주 품목 (요청-발주 배분량) */
    purchaseOrderItems: {
      id: number;
      purchaseOrderId: number;
      purchaseOrderNo: string;
      purchaseOrderStatus: PurchaseOrderStatus;
      supplier: SupplierBrief;
      dueDate: string | null;
      orderedTon: string;
      receivedTon: string;
    }[];
  })[];
  /** Message → ERP로 만들어진 경우 원본 초안과 원본 메시지 */
  sourceDraft: {
    id: number;
    actionType: string;                   // 'PURCHASE_REQUISITION_CREATE'
    draftStatus: string;                  // DRAFT_STATUS
    confirmedAt: string | null;
    executedAt: string | null;
    message: {
      id: number;
      content: string;
      createdAt: string;
      sender: EmployeeBrief | null;
      chatRoom: { id: number; chatRoomType: string; chatRoomName: string | null };
    } | null;
  } | null;
}
```

### `GET /purchase-requisitions` → `PurchaseRequisitionListItem[]` (최신순)

| 쿼리 | 뜻 |
|---|---|
| `status` | `PurchaseRequisitionStatus` |
| `mine=true` | 내가 요청한 것만 |
| `toApprove=true` | 내가 승인할 것만 (승인 대기 + 승인권자 = 나). `status`보다 우선 |

### `GET /purchase-requisitions/:id` → `PurchaseRequisitionDetail`

### `POST /purchase-requisitions` → `201 PurchaseRequisitionDetail`

```ts
interface CreatePurchaseRequisitionBody {
  items: { rawMaterialId: number; requiredTon: string | number }[];   // 1개 이상, 같은 원료 중복 불가, 톤 > 0
  desiredReceiptDate: string;            // 'YYYY-MM-DD', 오늘 이후
  requestReason?: string;                // 500자 이하
  sourceType?: 'DIRECT' | 'MRP';         // 기본 'DIRECT'. MRP 화면에서 등록하면 'MRP'
  submit?: boolean;                      // false(기본) → DRAFT, true → 등록과 동시에 제출(WAITING_APPROVAL)
}
```
요청자는 로그인 사원이다 (본문으로 받지 않는다). `submit: true`인데 승인권자가 없으면 `PUR-001`이고 구매요청도 만들어지지 않는다.

### `PATCH /purchase-requisitions/:id` → `PurchaseRequisitionDetail`

요청자 본인, `DRAFT` 또는 `REJECTED`일 때만. 보낸 항목만 바뀐다. `items`를 보내면 **품목 전체를 교체**한다(품목 id가 바뀐다).

```ts
interface UpdatePurchaseRequisitionBody {
  items?: { rawMaterialId: number; requiredTon: string | number }[];
  desiredReceiptDate?: string;
  requestReason?: string;
}
```

### `POST /purchase-requisitions/:id/submit` → `200 PurchaseRequisitionDetail` (본문 없음)

요청자 본인, `DRAFT`·`REJECTED`에서만. 승인권자를 찾아 `approver`를 채우고 `WAITING_APPROVAL`로 바꾼다.
승인권자 = 요청자 소속 부서의 부서장. 요청자가 그 부서의 부서장이면 상위 부서의 부서장. 없으면 `PUR-001`.
승인권자에게 알림(`APPROVAL_REQUEST`, `linkPath = /purchase-requisitions/:id`), 작업 로그 `PURCHASE_REQUISITION_CONFIRMED`.

### `POST /purchase-requisitions/:id/approve` → `200 PurchaseRequisitionDetail` (본문 없음)

승인권자만, `WAITING_APPROVAL`에서만. → `APPROVED`. 요청자에게 `APPROVAL_RESULT` 알림, 구매 역할 전원에게 `PURCHASE` 알림("발주 필요", `linkPath = /purchase-orders`). 작업 로그 `PURCHASE_REQUISITION_APPROVED`.

### `POST /purchase-requisitions/:id/reject` → `200 PurchaseRequisitionDetail`

```ts
interface RejectPurchaseRequisitionBody { rejectReason: string }   // 필수, 1~500자
```
승인권자만. → `REJECTED` + `rejectReason`. 요청자가 `PATCH`로 고친 뒤 다시 `submit`할 수 있다. 작업 로그 `PURCHASE_REQUISITION_REJECTED`.

### `GET /approvals` → 내가 승인할 것

```ts
interface ApprovalsView {
  purchaseRequisitions: PurchaseRequisitionListItem[];   // WAITING_APPROVAL 이고 approver = 나
  counts: { purchaseRequisition: number; total: number };
}
```
로그인한 누구나 부를 수 있다. 부서장이 아니면 `{ purchaseRequisitions: [], counts: { purchaseRequisition: 0, total: 0 } }`.

### 예시 (최생산 2001009 = 제강파트장 → 승인권자 강생산 1402002 = 생산부장)

```jsonc
// POST /purchase-requisitions  (최생산)
// {"items":[{"rawMaterialId":1,"requiredTon":"150"},{"rawMaterialId":3,"requiredTon":40.25}],"desiredReceiptDate":"2026-10-10","requestReason":"10월 2주차 제선 투입분","sourceType":"MRP","submit":false}
{ "success": true, "data": {
  "id": 86, "purchaseRequisitionNo": "PR-20260930-0074", "requesterId": 10, "departmentId": 6, "approverId": null,
  "purchaseRequisitionStatus": "DRAFT", "desiredReceiptDate": "2026-10-10T00:00:00.000Z", "requestReason": "10월 2주차 제선 투입분",
  "rejectReason": null, "sourceType": "MRP", "sourceDraftId": null, "submittedAt": null, "approvedAt": null, "rejectedAt": null,
  "createdAt": "2026-09-30T11:27:41.016Z", "updatedAt": "2026-09-30T11:27:41.016Z",
  "requester": { "id": 10, "employeeNo": "2001009", "employeeName": "최생산", "jobGrade": "대리", "department": { "id": 6, "departmentName": "제강파트" } },
  "approver": null,
  "department": { "id": 6, "departmentName": "제강파트" },
  "totalRequiredTon": "190.250",
  "items": [
    { "id": 90, "lineNo": 1, "rawMaterial": { "id": 1, "materialCode": "IO", "rawMaterialType": "IRON_ORE", "itemName": "철광석" }, "requiredTon": "150.000", "orderedTon": "0.000", "unorderedTon": "150.000", "purchaseOrderItems": [] },
    { "id": 91, "lineNo": 2, "rawMaterial": { "id": 3, "materialCode": "LS", "rawMaterialType": "LIMESTONE", "itemName": "석회석" }, "requiredTon": "40.250", "orderedTon": "0.000", "unorderedTon": "40.250", "purchaseOrderItems": [] }
  ],
  "sourceDraft": null } }

// POST /purchase-requisitions/:id/submit (최생산) → 달라지는 부분
//   "purchaseRequisitionStatus": "WAITING_APPROVAL", "approverId": 7, "submittedAt": "2026-09-30T11:27:41.245Z",
//   "approver": { "id": 7, "employeeNo": "1402002", "employeeName": "강생산", "jobGrade": "부장", "department": { "id": 4, "departmentName": "생산부" } },
//   "department": { "id": 6, "departmentName": "제강파트" }
// 서구매(1907015, 구매부)가 제출하면 approver = 남구매(1604007, 구매부장)

// 발주 뒤 GET /purchase-requisitions/:id 의 items[0]
{ "id": 92, "lineNo": 1, "rawMaterial": { "id": 1, "materialCode": "IO", "rawMaterialType": "IRON_ORE", "itemName": "철광석" },
  "requiredTon": "150.000", "orderedTon": "150.000", "unorderedTon": "0.000",
  "purchaseOrderItems": [ { "id": 49, "purchaseOrderId": 45, "purchaseOrderNo": "PO-20260930-0025", "purchaseOrderStatus": "CONFIRMED",
    "supplier": { "id": 1, "supplierCode": "SUP-01", "supplierName": "호주광업상사" }, "dueDate": "2026-10-10T00:00:00.000Z", "orderedTon": "150.000", "receivedTon": "0.000" } ] }

// Message → ERP로 생긴 구매요청의 sourceDraft (GET /purchase-requisitions/88)
"sourceType": "MESSAGE", "sourceDraftId": 45,
"sourceDraft": { "id": 45, "actionType": "PURCHASE_REQUISITION_CREATE", "draftStatus": "EXECUTED",
  "confirmedAt": "2026-09-30T11:28:56.476Z", "executedAt": "2026-09-30T11:28:56.484Z",
  "message": { "id": 49, "content": "다음 주 제강 계획 때문에 합금철 FeMn 3톤이 더 필요합니다. 10일까지 입고 부탁드려요.", "createdAt": "…",
    "sender": { "id": 10, "employeeNo": "2001009", "employeeName": "최생산", "jobGrade": "대리", "department": { "id": 6, "departmentName": "제강파트" } },
    "chatRoom": { "id": 45, "chatRoomType": "GROUP", "chatRoomName": "원료 수급 협의" } } }

// GET /approvals (강생산)
{ "success": true, "data": { "purchaseRequisitions": [ /* PurchaseRequisitionListItem */ ], "counts": { "purchaseRequisition": 1, "total": 1 } } }
```

---

## 2. 발주

발주는 만들면 바로 `CONFIRMED`다 (별도 확정 단계 없음 → `POST /purchase-orders/:id/confirm`은 없다). 입고가 시작되면 `PARTIALLY_RECEIVED`, 모든 품목이 다 들어오면 `RECEIVED`.

```ts
interface PurchaseOrderItemView {
  id: number;                        // 입고할 때 purchaseOrderItemId로 쓴다
  lineNo: number;
  rawMaterial: RawMaterialBrief;
  purchaseRequisitionItemId: number | null;
  orderedTon: string;
  receivedTon: string;               // 확정된 입고 누계
  outstandingTon: string;            // 미입고량 = orderedTon − receivedTon (입고예정)
}

/** GET /purchase-orders 의 원소 */
interface PurchaseOrderListItem {
  id: number;
  purchaseOrderNo: string;           // 'PO-20260930-0025'
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

/** GET /purchase-orders/:id, POST /purchase-orders 의 응답 */
interface PurchaseOrderDetail extends Omit<PurchaseOrderListItem, 'items'> {
  items: (PurchaseOrderItemView & {
    purchaseRequisition: { id: number; purchaseRequisitionNo: string; lineNo: number } | null;
    goodsReceipts: {
      id: number;
      goodsReceiptNo: string;
      goodsReceiptStatus: GoodsReceiptStatus;
      receivedTon: string;
      receiptDate: string;
      confirmedAt: string | null;
      yard: YardBrief | null;
      lot: { id: number; lotNo: string; remainingTon: string } | null;   // 확정된 입고만
    }[];
  })[];
}

/** GET /purchase-orders/orderable 의 원소: 기본 공급업체별 묶음 */
interface OrderableGroup {
  supplier: SupplierBrief | null;    // 기본 공급업체가 없는 원료는 null 묶음
  items: {
    purchaseRequisitionItemId: number;
    purchaseRequisitionId: number;
    purchaseRequisitionNo: string;
    desiredReceiptDate: string | null;
    lineNo: number;
    rawMaterial: RawMaterialBrief;
    requiredTon: string;
    orderedTon: string;
    unorderedTon: string;            // 이번에 발주할 수 있는 최대량
  }[];
  totalUnorderedTon: string;
}
```

### `GET /purchase-orders` → `PurchaseOrderListItem[]` (최신순) — 쿼리 `status`, `supplierId`
### `GET /purchase-orders/orderable` → `OrderableGroup[]`
승인(`APPROVED`)됐고 아직 다 발주하지 않은 구매요청 품목. 발주 화면은 묶음 1개 = 발주 1건으로 만든다.
### `GET /purchase-orders/:id` → `PurchaseOrderDetail`
### `POST /purchase-orders` → `201 PurchaseOrderDetail`

```ts
interface CreatePurchaseOrderBody {
  supplierId: number;
  dueDate: string;                   // 'YYYY-MM-DD', 오늘 이후
  items: { purchaseRequisitionItemId: number; orderedTon: string | number }[];   // 1개 이상, 같은 품목 중복 불가
}
```
검증: 승인된 구매요청의 품목만(`PUR-002`) · `orderedTon` ≤ 그 품목의 `unorderedTon`(넘으면 `COM-003`) · 원료의 기본 공급업체가 있으면 `supplierId`가 그 업체여야 한다(`COM-003`).
결과: 구매요청 품목의 `orderedTon` 누계 증가, 구매요청의 모든 품목이 다 발주되면 구매요청이 `ORDERED`. 작업 로그 `PURCHASE_ORDER_CONFIRMED`. 요청자에게 `PURCHASE` 알림.

```jsonc
// GET /purchase-orders/orderable (서구매)
{ "success": true, "data": [
  { "supplier": { "id": 1, "supplierCode": "SUP-01", "supplierName": "호주광업상사" },
    "items": [ { "purchaseRequisitionItemId": 95, "purchaseRequisitionId": 87, "purchaseRequisitionNo": "PR-20260930-0075", "desiredReceiptDate": "2026-10-10T00:00:00.000Z", "lineNo": 1,
      "rawMaterial": { "id": 2, "materialCode": "CL", "rawMaterialType": "COAL", "itemName": "석탄" }, "requiredTon": "10.000", "orderedTon": "0.000", "unorderedTon": "10.000" } ],
    "totalUnorderedTon": "10.000" },
  { "supplier": { "id": 3, "supplierCode": "SUP-03", "supplierName": "대한합금" }, "items": [ /* … */ ], "totalUnorderedTon": "3.000" } ] }

// POST /purchase-orders  {"supplierId":1,"dueDate":"2026-10-10","items":[{"purchaseRequisitionItemId":92,"orderedTon":"150"}]}
// 입고가 끝난 뒤의 GET /purchase-orders/45
{ "success": true, "data": {
  "id": 45, "purchaseOrderNo": "PO-20260930-0025", "supplierId": 1, "purchaseOrderStatus": "RECEIVED", "dueDate": "2026-10-10T00:00:00.000Z",
  "orderedEmployeeId": 6, "confirmedAt": "2026-09-30T11:28:06.041Z", "createdAt": "2026-09-30T11:28:06.043Z", "updatedAt": "2026-09-30T11:28:25.854Z",
  "supplier": { "id": 1, "supplierCode": "SUP-01", "supplierName": "호주광업상사" },
  "totalOrderedTon": "150.000", "totalReceivedTon": "150.000", "totalOutstandingTon": "0.000",
  "items": [ { "id": 49, "lineNo": 1, "rawMaterial": { "id": 1, "materialCode": "IO", "rawMaterialType": "IRON_ORE", "itemName": "철광석" },
    "purchaseRequisitionItemId": 92, "purchaseRequisition": { "id": 86, "purchaseRequisitionNo": "PR-20260930-0074", "lineNo": 1 },
    "orderedTon": "150.000", "receivedTon": "150.000", "outstandingTon": "0.000",
    "goodsReceipts": [
      { "id": 25, "goodsReceiptNo": "RCV-20260930-0025", "goodsReceiptStatus": "CONFIRMED", "receivedTon": "60.500", "receiptDate": "2026-09-30T00:00:00.000Z", "confirmedAt": "2026-09-30T11:28:25.726Z",
        "yard": { "id": 1, "yardCode": "RY-01", "yardName": "원료 야드" }, "lot": { "id": 131, "lotNo": "RM-IO-260930-001", "remainingTon": "60.500" } },
      { "id": 26, "goodsReceiptNo": "RCV-20260930-0026", "goodsReceiptStatus": "CONFIRMED", "receivedTon": "89.500", "receiptDate": "2026-09-30T00:00:00.000Z", "confirmedAt": "2026-09-30T11:28:25.852Z",
        "yard": { "id": 1, "yardCode": "RY-01", "yardName": "원료 야드" }, "lot": { "id": 132, "lotNo": "RM-IO-260930-002", "remainingTon": "89.500" } },
      { "id": 27, "goodsReceiptNo": "RCV-20260930-0027", "goodsReceiptStatus": "DRAFT", "receivedTon": "10.000", "receiptDate": "2026-09-30T00:00:00.000Z", "confirmedAt": null,
        "yard": { "id": 1, "yardCode": "RY-01", "yardName": "원료 야드" }, "lot": null } ] } ] } }
```

---

## 3. 입고

입고는 초안(`DRAFT`)을 만들고 확정(`CONFIRMED`)하는 두 단계다. 재고·LOT은 **확정할 때만** 바뀐다. 입고 검사는 없다.

```ts
/** GET /goods-receipts 의 원소, POST /goods-receipts, POST /goods-receipts/:id/confirm 의 응답 */
interface GoodsReceiptView {
  id: number;
  goodsReceiptNo: string;            // 'RCV-20260930-0025'
  purchaseOrderItemId: number;
  receivedTon: string;
  receiptDate: string;               // '2026-09-30T00:00:00.000Z'
  yardId: number | null;
  goodsReceiptStatus: GoodsReceiptStatus;
  note: string | null;
  confirmedEmployeeId: number | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  yard: YardBrief | null;
  /** 확정 시 만들어진 원료 LOT (초안이면 null) */
  lot: { id: number; lotNo: string; initialTon: string; remainingTon: string } | null;
  rawMaterial: RawMaterialBrief;
  purchaseOrder: { id: number; purchaseOrderNo: string; purchaseOrderStatus: PurchaseOrderStatus; supplier: SupplierBrief };
  /** 발주 품목의 현재 누계 */
  purchaseOrderItem: { id: number; lineNo: number; orderedTon: string; receivedTon: string; outstandingTon: string };
}
```

### `GET /goods-receipts` → `GoodsReceiptView[]` (최신순) — 쿼리 `status`, `purchaseOrderId`
### `POST /goods-receipts` → `201 GoodsReceiptView` (DRAFT)

```ts
interface CreateGoodsReceiptBody {
  purchaseOrderItemId: number;
  receivedTon: string | number;      // > 0, ≤ 그 발주 품목의 outstandingTon (넘으면 PUR-003)
  receiptDate: string;               // 'YYYY-MM-DD', 오늘 이전
  yardId?: number;                   // 원료 야드만. 비우면 원료의 기본 야드
  note?: string;                     // 500자 이하
}
```

### `POST /goods-receipts/:id/confirm` → `200 GoodsReceiptView` (본문 없음)

한 트랜잭션에서: 미입고량 재검증(`PUR-003`) → `CONFIRMED` → 원료 LOT 생성(`RM-원료코드-YYMMDD-NNN`, `initialTon = remainingTon = receivedTon`) → 원료 재고(`GET /raw-materials`의 `onHandTon`) 증가 → 발주 품목 `receivedTon` 증가 → 발주 상태 `PARTIALLY_RECEIVED`/`RECEIVED` → 작업 로그 `GOODS_RECEIPT_CONFIRMED`(`lotIds`에 새 LOT).
**이미 확정된 입고를 다시 확정하면** 아무것도 바꾸지 않고 확정된 결과를 그대로 `200`으로 돌려준다 (LOT이 하나 더 생기지 않는다).
초안을 여러 개 만들어 두면 합계가 미입고량을 넘을 수 있는데, 넘는 초안은 확정할 때 `PUR-003`으로 거부된다 (위 예시의 `RCV-…-0027`). 초안을 지우는 API는 없다.

```jsonc
// POST /goods-receipts {"purchaseOrderItemId":49,"receivedTon":"60.5","receiptDate":"2026-09-30","note":"1차 입고"}  →  POST /goods-receipts/25/confirm
{ "success": true, "data": {
  "id": 25, "goodsReceiptNo": "RCV-20260930-0025", "purchaseOrderItemId": 49, "receivedTon": "60.500", "receiptDate": "2026-09-30T00:00:00.000Z", "yardId": 1,
  "goodsReceiptStatus": "CONFIRMED", "note": "1차 입고", "confirmedEmployeeId": 6, "confirmedAt": "2026-09-30T11:28:25.726Z",
  "createdAt": "2026-09-30T11:28:25.671Z", "updatedAt": "2026-09-30T11:28:25.726Z",
  "yard": { "id": 1, "yardCode": "RY-01", "yardName": "원료 야드" },
  "lot": { "id": 131, "lotNo": "RM-IO-260930-001", "initialTon": "60.500", "remainingTon": "60.500" },
  "rawMaterial": { "id": 1, "materialCode": "IO", "rawMaterialType": "IRON_ORE", "itemName": "철광석" },
  "purchaseOrder": { "id": 45, "purchaseOrderNo": "PO-20260930-0025", "purchaseOrderStatus": "PARTIALLY_RECEIVED", "supplier": { "id": 1, "supplierCode": "SUP-01", "supplierName": "호주광업상사" } },
  "purchaseOrderItem": { "id": 49, "lineNo": 1, "orderedTon": "150.000", "receivedTon": "60.500", "outstandingTon": "89.500" } } }
```

---

## 오류

| HTTP | code | 언제 | message 예 |
|---|---|---|---|
| 400 | `PUR-001` | 제출했는데 승인권자(부서장)가 없다 | 승인권자(부서장)가 지정되어 있지 않아 제출할 수 없습니다. 관리자에게 부서장 지정을 요청해 주세요 |
| 400 | `PUR-002` | 승인 전(`DRAFT`·`WAITING_APPROVAL`·`REJECTED`) 구매요청 품목으로 발주 | PR-20260930-0074: 부서장 승인 전에는 발주할 수 없습니다 |
| 400 | `PUR-003` | 입고 수량이 발주 미입고량을 넘는다 (초안 생성·확정 모두) | 철광석: 입고 수량이 발주 미입고량 0.000t를 넘습니다 |
| 400 | `COM-003` | 입력값 오류: 톤 0 이하·소수 4자리, 지난 날짜, 같은 원료 중복, 남은 수량 초과 발주, 기본 공급업체가 아닌 곳, 이미 전량 발주, 반려 사유 없음, 모르는 필드 | PR-20260930-0074 철광석: 발주할 수 있는 남은 수량은 150.000t입니다 |
| 403 | `COM-002` | 역할 권한 없음 / 요청자가 아닌데 수정·제출 / 승인권자가 아닌데 승인·반려 / **자기 요청을 자기가 승인** | 자기가 요청한 구매요청은 승인·반려할 수 없습니다 |
| 404 | `COM-004` | 대상 없음 | 구매요청을(를) 찾을 수 없습니다 |
| 409 | `COM-005` | 상태가 맞지 않음: 승인 대기 중 수정, 이미 승인된 것 재승인 등 | 승인 대기 상태의 구매요청만 승인·반려할 수 있습니다 |

## 실시간 주제 (`changed`)

`purchase-requisitions`, `purchase-orders`, `goods-receipts`, `lots`, `inventories`, `mrp-runs`(발주·입고로 입고예정·잔량이 바뀌었을 때), `business-events`, 그리고 사원별 `notification` 이벤트.
