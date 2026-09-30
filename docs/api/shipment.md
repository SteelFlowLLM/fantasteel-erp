# shipment API

출하요청 → (LOT 배정은 `inventory.md`의 `/allocations`) → 출고 확정 → 밀시트 스냅샷·PDF (REQ-SHP-001~004, REQ-INV-005, BP-SHP-01).
모든 경로는 `/api/v1` 아래, 로그인 필요(`Authorization: Bearer …`).
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8803, DB `fs_sales`)에 curl로 호출한 응답에서 옮겼다.

- 수량은 정수 매수(슬래브 매, 코일 개). 톤(`…Ton`)은 계산값 문자열(소수 3자리).
- 날짜만 있는 값(`requestedShipDate`)은 요청·응답 모두 `"YYYY-MM-DD"`. 시각은 ISO 8601 문자열.
- 상태값은 `@fantasteel/shared`의 `SHIPMENT_REQUEST_STATUS` · `SHIPMENT_REQUEST_ITEM_STATUS` · `ALLOCATION_STATUS` · `PDF_STATUS`와 `…_LABEL`.

## 화면 흐름

```
영업  GET  /shipment-requests/shippable      출하요청할 수 있는 수주 품목과 매수
영업  POST /shipment-requests                출하요청 (REQUESTED, 품목 WAITING_ALLOCATION)
영업  POST /allocations/recommend            FIFO 추천            ┐ inventory.md
영업  POST /allocations                      배정 확정 → ALLOCATED ┘ (물류에 "출고 대기" 알림)
물류  POST /shipment-requests/:id/goods-issue   출고 확정 → ISSUED, 예약 CONVERTED, 밀시트 발행 (수주 담당에 알림)
물류  GET  /mill-sheets/:id  →  POST /mill-sheets/:id/pdf  →  GET /mill-sheets/:id/pdf
```

부분 출하는 출하요청을 나눠서 한다 (예: 2매 요청·출고 → 4매 요청·출고). 출고 확정은 출하요청 단위다.

## 권한 요약

| API | 필요한 권한 |
|---|---|
| `GET /shipment-requests`, `GET /shipment-requests/:id` | `SHIPMENT_REQUEST` 또는 `GOODS_ISSUE_CONFIRM` VIEW 이상 (영업·물류·품질·관리자) |
| `GET /shipment-requests/shippable` | `SHIPMENT_REQUEST` VIEW 이상 |
| `POST /shipment-requests`, `POST /shipment-requests/:id/cancel` | `SHIPMENT_REQUEST` USE (영업) |
| `POST /shipment-requests/:id/goods-issue` | `GOODS_ISSUE_CONFIRM` USE (물류) |
| `GET /goods-issues` | `GOODS_ISSUE_CONFIRM` 또는 `SHIPMENT_REQUEST` VIEW 이상 |
| `GET /mill-sheets`, `GET /mill-sheets/:id`, `GET /mill-sheets/:id/pdf` | `MILLSHEET_READ` VIEW 이상 (영업·품질·물류·관리자) |
| `POST /mill-sheets/:id/pdf` | `MILLSHEET_READ` USE (영업·품질·물류) |

## 공통 타입

```ts
type ShipmentRequestStatus = 'REQUESTED' | 'ALLOCATED' | 'PARTIALLY_ISSUED' | 'ISSUED' | 'CANCELLED';   // PARTIALLY_ISSUED는 쓰지 않는다
type ShipmentRequestItemStatus = 'WAITING_ALLOCATION' | 'ALLOCATED' | 'ISSUED';
type AllocationStatus = 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
type SalesOrderItemStatus = 'REGISTERED' | 'IN_PROGRESS' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED';
type PdfStatus = 'PENDING' | 'READY' | 'FAILED';

interface EmployeeRef { id: number; employeeNo: string; employeeName: string }
interface CustomerRef { id: number; customerCode: string; customerName: string }
interface MillSheetRef { id: number; millSheetNo: string; salesOrderId: number; pdfStatus: PdfStatus }
```

---

## 1. 출하요청

```ts
interface ShipmentRequestView {
  id: number;
  shipmentRequestNo: string;          // 'SHP-YYYYMMDD-NNNN'
  customer: CustomerRef;
  requestedShipDate: string;          // 'YYYY-MM-DD'
  shipmentRequestStatus: ShipmentRequestStatus;
  requester: EmployeeRef | null;
  memo: string | null;
  cancelledAt: string | null;
  createdAt: string;
  requestQty: number;                 // 품목 요청 매수 합
  requestTon: string;
  allocatedQty: number;               // 배정(확정·소진)된 LOT 수 합
  items: ShipmentRequestItemView[];
  goodsIssue: { id: number; goodsIssueNo: string; confirmedAt: string | null; confirmedEmployee: EmployeeRef | null } | null;   // 출고 확정 뒤
  millSheets: MillSheetRef[];         // 출고 확정 뒤, 수주 품목마다 1장
}
interface ShipmentRequestItemView {
  id: number;                         // shipmentRequestItemId (배정 API에 쓴다)
  lineNo: number;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;                    // '매' | '개'
  steelGradeCode: string;
  theoreticalWeightTon: string;
  requestQty: number;
  requestTon: string;
  allocatedQty: number;               // requestQty와 같으면 배정 완료
  shipmentRequestItemStatus: ShipmentRequestItemStatus;   // WAITING_ALLOCATION = 배정 대기
  allocations: {                      // 확정(CONFIRMED)·소진(CONSUMED) 배정. 해제된 것은 빠진다
    id: number;                       // allocationId
    lotId: number;
    lotNo: string;
    lotType: string;
    heatNo: string | null;
    producedAt: string;
    status: AllocationStatus;
    confirmedAt: string;
  }[];
}
```

### 1-1. `GET /shipment-requests/shippable` — 출하요청할 수 있는 수주 품목

취소·출하완료가 아닌 수주 품목 중 `shippableQty > 0`인 것.

```ts
// 쿼리 (선택)
interface ListShippableQuery { customerId?: number; salesOrderId?: number }
// 응답 200
type Response = {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customer: CustomerRef;
  dueDate: string;                    // 'YYYY-MM-DD'
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;
  steelGradeCode: string;
  theoreticalWeightTon: string;
  orderedQty: number;
  shippedQty: number;
  reservedQty: number;                // ACTIVE 예약 매수
  requestedQty: number;               // 다른 미출고(REQUESTED·ALLOCATED) 출하요청에 이미 들어 있는 매수
  shippableQty: number;               // 지금 요청할 수 있는 매수 = reservedQty − requestedQty
  shippableTon: string;
}[];
```

```json
[ { "salesOrderItemId": 146, "salesOrderId": 141, "salesOrderNo": "SO-20260930-0141", "lineNo": 1,
    "customer": { "id": 1, "customerCode": "CUS-01", "customerName": "한빛중공업" }, "dueDate": "2026-10-20",
    "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "qtyUnit": "매", "steelGradeCode": "SS275",
    "theoreticalWeightTon": "23.550", "orderedQty": 10, "shippedQty": 0, "reservedQty": 6, "requestedQty": 0,
    "shippableQty": 6, "shippableTon": "141.300" } ]
```

### 1-2. `POST /shipment-requests` — 출하요청 (REQ-SHP-001)

```ts
// 요청
interface CreateShipmentRequestBody {
  customerId: number;
  requestedShipDate: string;          // 'YYYY-MM-DD'
  memo?: string;                      // 500자 이하
  items: { salesOrderItemId: number; requestQty: number }[];   // 1건 이상, 같은 수주 품목은 한 번만. requestQty는 1 이상의 정수
}
// 응답 201: ShipmentRequestView (shipmentRequestStatus = 'REQUESTED', 품목 'WAITING_ALLOCATION')
```

| 상황 | HTTP | code | message 예 |
|---|---|---|---|
| 요청 매수 > ACTIVE 예약 − 다른 미출고 출하요청 | 400 | `INV-001` | SO-20260930-0141 #1: 출하요청할 수 있는 매수는 6매입니다 (예약 6, 다른 출하요청 0) |
| 다른 고객사의 수주 품목 | 400 | `COM-003` | SO-20260930-0141 #1: 같은 고객사의 수주 품목만 한 출하요청에 묶을 수 있습니다 |
| 취소된 수주 품목 | 409 | `COM-005` | …: 취소된 수주 품목은 출하요청할 수 없습니다 |
| 매수가 정수가 아님 | 400 | `COM-003` | items.0.출하 매수는 1 이상의 정수로 입력해 주세요 |
| 같은 수주 품목 중복 | 400 | `COM-003` | 같은 수주 품목을 한 출하요청에 두 번 넣을 수 없습니다 |
| 없는 수주 품목 | 404 | `COM-004` | 수주 품목을(를) 찾을 수 없습니다 |

```bash
curl -X POST :8803/api/v1/shipment-requests -H 'Authorization: Bearer …' -H 'Content-Type: application/json' \
  -d '{"customerId":1,"requestedShipDate":"2026-10-02","memo":"1차 출하","items":[{"salesOrderItemId":146,"requestQty":2}]}'
```

```json
{ "id": 43, "shipmentRequestNo": "SHP-20260930-0043",
  "customer": { "id": 1, "customerCode": "CUS-01", "customerName": "한빛중공업" },
  "requestedShipDate": "2026-10-02", "shipmentRequestStatus": "REQUESTED",
  "requester": { "id": 3, "employeeNo": "2104012", "employeeName": "김영업" },
  "memo": "1차 출하", "cancelledAt": null, "createdAt": "2026-09-30T11:30:42.612Z",
  "requestQty": 2, "requestTon": "47.100", "allocatedQty": 0,
  "items": [ { "id": 44, "lineNo": 1, "salesOrderItemId": 146, "salesOrderId": 141, "salesOrderNo": "SO-20260930-0141", "salesOrderLineNo": 1,
    "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "qtyUnit": "매", "steelGradeCode": "SS275",
    "theoreticalWeightTon": "23.550", "requestQty": 2, "requestTon": "47.100", "allocatedQty": 0,
    "shipmentRequestItemStatus": "WAITING_ALLOCATION", "allocations": [] } ],
  "goodsIssue": null, "millSheets": [] }
```

### 1-3. `GET /shipment-requests` — 목록

```ts
// 쿼리 (모두 선택)
interface ListShipmentRequestsQuery {
  status?: ShipmentRequestStatus;
  customerId?: number;
  salesOrderId?: number;              // 그 수주의 품목이 들어 있는 출하요청
  shipFrom?: string;                  // 출하 요청일 범위 'YYYY-MM-DD' (양 끝 포함)
  shipTo?: string;
  keyword?: string;                   // 출하번호·고객사명·수주번호 부분 일치
}
// 응답 200: ShipmentRequestView[]  (최신순, 상세와 같은 모양)
```

물류의 출고 대기 목록은 `?status=ALLOCATED`.

### 1-4. `GET /shipment-requests/:id` — 상세 (배정 LOT 포함)

응답 200: `ShipmentRequestView`. 없으면 404 `COM-004`.

```json
// 배정 확정 뒤
"shipmentRequestStatus": "ALLOCATED", "allocatedQty": 4,
"items": [ { "id": 45, "requestQty": 4, "allocatedQty": 4, "shipmentRequestItemStatus": "ALLOCATED",
  "allocations": [ { "id": 98, "lotId": 20, "lotNo": "HT-1-260921-001-09", "lotType": "SLAB", "heatNo": "HT-1-260921-001",
    "producedAt": "2026-09-21T04:09:00.000Z", "status": "CONFIRMED", "confirmedAt": "2026-09-30T11:31:42.656Z" }, "… 3건" ] } ],
"goodsIssue": null, "millSheets": []
```

### 1-5. `POST /shipment-requests/:id/cancel` — 출하요청 취소 (출고 전)

```ts
// 요청
interface CancelShipmentRequestBody { reason?: string }
// 응답 200: ShipmentRequestView (shipmentRequestStatus = 'CANCELLED', cancelledAt, 품목은 WAITING_ALLOCATION·allocations = [])
```

확정 배정을 모두 해제(`RELEASED`)하고 `ALLOCATION_RELEASED` 로그를 남긴다. 예약은 그대로라 같은 매수를 다시 요청할 수 있다.
이미 취소 → 409 `COM-005` "이미 취소된 출하요청입니다" / 출고 확정됨 → 409 `COM-005` "출고 확정된 출하요청은 취소할 수 없습니다".

수주를 취소하면(`POST /sales-orders/:id/cancel`) 그 품목이 든 미출고 출하요청도 이 방식으로 함께 취소된다.

---

## 2. 출고 확정

### 2-1. `POST /shipment-requests/:id/goods-issue` — 출고 확정 (REQ-SHP-002)

본문 없음. 요청 헤더(선택): `Idempotency-Key: <문자열 200자 이하>`.

한 트랜잭션에서 (출하요청 → 수주 품목 → 재고 풀 → LOT 순으로 잠근 뒤):
1. 출하요청이 `ALLOCATED`(모든 품목 배정 완료)인지 확인.
2. 배정 LOT을 다시 확인: 적격(자기 검사 + 상위 히트 합격)·미소진·CONFIRMED. 미합격이면 **출고 전체를 막는다**(`INV-002`).
3. 배정 `CONSUMED`, LOT `SHIPPED`, 재고 풀 `onHandQty`·`reservedQty` 감소.
4. 출고 매수만큼 ACTIVE 예약 → `CONVERTED` (부분 출고는 예약을 나눈다: ACTIVE 6 → 2 출고 → ACTIVE 4 + CONVERTED 2).
5. 수주 품목 `shippedQty` 증가, 품목 상태 재계산(`PARTIALLY_SHIPPED` / `SHIPPED`).
6. 출고(`goods_issue`)·출고 LOT 기록, (출고 × 수주 품목)마다 밀시트 스냅샷 1장 발행.
7. 출하요청·품목 `ISSUED`, 작업 로그(`RESERVATION_CONVERTED`, `MILL_SHEET_ISSUED`, `GOODS_ISSUE_CONFIRMED`), 수주 담당에게 알림.

**다시 눌러도 두 번 출고되지 않는다.** 같은 `Idempotency-Key`로 다시 보내면 처음 응답을 돌려주고, 키가 없거나 다르면 상태 확인에서 409로 막힌다.

```ts
// 응답 200
interface GoodsIssueView {
  id: number;
  goodsIssueNo: string;               // 'GI-YYYYMMDD-NNNN'
  goodsIssueStatus: string;           // 'CONFIRMED'
  confirmedAt: string | null;
  confirmedEmployee: EmployeeRef | null;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  customer: CustomerRef;
  issuedQty: number;                  // 이번 출고 매수 합
  issuedTon: string;
  items: {
    shipmentRequestItemId: number;
    salesOrderItemId: number;
    salesOrderId: number;
    salesOrderNo: string;
    salesOrderLineNo: number;
    productSpecId: number;
    specCode: string;
    itemType: 'SLAB' | 'COIL';
    qtyUnit: string;
    steelGradeCode: string;
    issuedQty: number;                // 이번 출고 매수
    issuedTon: string;
    orderedQty: number;               // 수주 품목의 주문 매수
    shippedQty: number;               // 수주 품목의 누적 출고 매수 (조회 시점 값)
    salesOrderItemStatus: SalesOrderItemStatus;
    lots: { lotId: number; lotNo: string; heatNo: string | null }[];
  }[];
  millSheets: MillSheetRef[];
}
```

| 상황 | HTTP | code | message 예 |
|---|---|---|---|
| 배정이 끝나지 않음 (`REQUESTED`) | 409 | `COM-005` | LOT 배정이 끝나지 않은 출하요청입니다. 배정을 먼저 확정해 주세요 |
| 이미 출고 확정됨 | 409 | `COM-005` | 이미 출고 확정된 출하요청입니다 |
| 취소된 출하요청 | 409 | `COM-005` | 취소된 출하요청입니다 |
| 배정 LOT 또는 상위 히트가 미합격 | 400 | `INV-002` | HT-…: 제품 또는 상위 히트가 미합격이어서 출고할 수 없습니다 |
| 배정 LOT이 이미 투입·출고됨 | 400 | `INV-004` | HT-…: 이미 투입·출고된 LOT입니다 |
| 출하 매수 > 예약 또는 주문 잔량 | 400 | `INV-001` | …: 출하 매수만큼의 예약이 없습니다 (ACTIVE 예약 0) |
| 물류 권한 없음 | 403 | `COM-002` | 해당 업무 권한이 없습니다 |

```bash
curl -X POST :8803/api/v1/shipment-requests/43/goods-issue -H 'Authorization: Bearer …' -H 'Idempotency-Key: walk-gi-1'
```

```json
{ "id": 20, "goodsIssueNo": "GI-20260930-0020", "goodsIssueStatus": "CONFIRMED", "confirmedAt": "2026-09-30T11:31:02.176Z",
  "confirmedEmployee": { "id": 17, "employeeNo": "2005024", "employeeName": "윤물류" },
  "shipmentRequestId": 43, "shipmentRequestNo": "SHP-20260930-0043",
  "customer": { "id": 1, "customerCode": "CUS-01", "customerName": "한빛중공업" },
  "issuedQty": 2, "issuedTon": "47.100",
  "items": [ { "shipmentRequestItemId": 44, "salesOrderItemId": 146, "salesOrderId": 141, "salesOrderNo": "SO-20260930-0141", "salesOrderLineNo": 1,
    "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "qtyUnit": "매", "steelGradeCode": "SS275",
    "issuedQty": 2, "issuedTon": "47.100", "orderedQty": 10, "shippedQty": 2, "salesOrderItemStatus": "PARTIALLY_SHIPPED",
    "lots": [ { "lotId": 16, "lotNo": "HT-1-260921-001-05", "heatNo": "HT-1-260921-001" }, { "lotId": 17, "lotNo": "HT-1-260921-001-06", "heatNo": "HT-1-260921-001" } ] } ],
  "millSheets": [ { "id": 21, "millSheetNo": "MS-20260930-0021", "salesOrderId": 141, "pdfStatus": "PENDING" } ] }
```

### 2-2. `GET /goods-issues` — 출고 목록

```ts
// 쿼리 (모두 선택)
interface ListGoodsIssuesQuery {
  shipmentRequestId?: number;
  customerId?: number;
  salesOrderId?: number;
  from?: string;                      // 출고 확정일 범위 'YYYY-MM-DD' (Asia/Seoul, 양 끝 포함)
  to?: string;
}
// 응답 200: GoodsIssueView[]  (최신순)
```

---

## 3. 밀시트

출고 확정 때 (출고 × 수주 품목)마다 1장 발행한다. 발행 시점의 값을 `snapshot`에 복사해 두고, **조회와 PDF는 이 스냅샷만 쓴다** — 나중에 고객사명·검사값 원본이 바뀌어도 밀시트는 그대로다.

```ts
interface MillSheetSnapshot {
  millSheetNo: string;
  issuedAt: string;
  customer: { customerCode: string; customerName: string };
  salesOrder: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number };
  shipment: { shipmentRequestNo: string; goodsIssueNo: string; goodsIssuedAt: string };
  productSpec: {
    specCode: string;
    itemType: 'SLAB' | 'COIL';
    steelGradeCode: string;
    steelGradeName: string;
    standardNo: string | null;        // 'KS D 3503'
    thicknessMm: string;
    widthMm: string;
    lengthMm: string;
    theoreticalWeightTon: string;     // 1매 이론중량
  };
  qty: number;                        // 출고 매수
  qtyUnit: string;                    // '매' | '개'
  weightTon: string;                  // qty × 1매 이론중량
  heats: {                            // 출고 LOT들의 히트 (히트가 여러 개면 히트마다)
    heatNo: string;
    composition: MillSheetInspection | null;   // 히트 성분 검사 (화학성분)
  }[];
  lots: {                             // 출고 LOT, 생산완료일 → LOT 번호 순
    lotNo: string;
    lotType: 'SLAB' | 'COIL';
    heatNo: string | null;
    producedAt: string;
    inspection: MillSheetInspection | null;    // 슬래브: 표면·치수(CASTING) / 코일: 치수·기계적 성질(HOT_ROLLING)
    parentSlab: { lotNo: string; inspection: MillSheetInspection | null } | null;   // 코일이면 압연 전 슬래브와 그 검사, 슬래브면 null
  }[];
}
interface MillSheetInspection {
  qualityInspectionNo: string;
  processCode: string;                // 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'
  inspectionResult: string;           // 'PASS' (그 공정의 최근 합격 검사를 담는다)
  inspectedAt: string | null;
  values: {
    inspectionItemCode: string;       // 성분은 원소 기호 'C' 'Si' 'Mn' 'P' 'S', 그 밖은 'TENSILE_STRENGTH' 등
    inspectionItemName: string;
    unit: string | null;
    minValue: string | null;          // 판정 기준 (검사 시점 값)
    maxValue: string | null;
    measuredValue: string | null;
    isPassed: boolean | null;
  }[];
}
```

스냅샷은 DB에 JSON(jsonb)으로 저장되어 **객체 키 순서가 위 선언 순서와 다를 수 있다**. 배열 순서는 그대로다.

### 3-1. `GET /mill-sheets` — 목록

```ts
// 쿼리 (모두 선택)
interface ListMillSheetsQuery {
  customerId?: number;
  salesOrderId?: number;
  goodsIssueId?: number;
  from?: string;                      // 발행일 범위 'YYYY-MM-DD' (Asia/Seoul, 양 끝 포함)
  to?: string;
  keyword?: string;                   // 밀시트 번호 부분 일치
}
// 응답 200 (최신순). 표시값은 모두 스냅샷에서 꺼낸다
type Response = {
  id: number;
  millSheetNo: string;                // 'MS-YYYYMMDD-NNNN'
  issuedAt: string;
  pdfStatus: PdfStatus;
  goodsIssueId: number;
  goodsIssueNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  steelGradeCode: string;
  qty: number;
  qtyUnit: string;
  weightTon: string;
  heatNos: string[];
}[];
```

```json
[ { "id": 21, "millSheetNo": "MS-20260930-0021", "issuedAt": "2026-09-30T11:31:02.176Z", "pdfStatus": "PENDING",
    "goodsIssueId": 20, "goodsIssueNo": "GI-20260930-0020", "salesOrderId": 141, "salesOrderNo": "SO-20260930-0141", "lineNo": 1,
    "customerId": 1, "customerName": "한빛중공업", "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "steelGradeCode": "SS275",
    "qty": 2, "qtyUnit": "매", "weightTon": "47.100", "heatNos": ["HT-1-260921-001"] } ]
```

### 3-2. `GET /mill-sheets/:id` — 상세 (저장된 스냅샷)

```ts
interface MillSheetView {
  id: number;
  millSheetNo: string;
  goodsIssueId: number;
  salesOrderId: number;
  customerId: number;
  issuedAt: string;
  pdfStatus: PdfStatus;               // PENDING(아직 안 만듦) | READY | FAILED
  pdfUrl: string | null;              // READY면 '/api/v1/mill-sheets/:id/pdf', 아니면 null
  snapshot: MillSheetSnapshot;
}
```

```json
{ "id": 21, "millSheetNo": "MS-20260930-0021", "goodsIssueId": 20, "salesOrderId": 141, "customerId": 1,
  "issuedAt": "2026-09-30T11:31:02.176Z", "pdfStatus": "PENDING", "pdfUrl": null,
  "snapshot": {
    "millSheetNo": "MS-20260930-0021", "issuedAt": "2026-09-30T11:31:02.176Z",
    "customer": { "customerCode": "CUS-01", "customerName": "한빛중공업" },
    "salesOrder": { "salesOrderId": 141, "salesOrderNo": "SO-20260930-0141", "salesOrderItemId": 146, "lineNo": 1 },
    "shipment": { "shipmentRequestNo": "SHP-20260930-0043", "goodsIssueNo": "GI-20260930-0020", "goodsIssuedAt": "2026-09-30T11:31:02.176Z" },
    "productSpec": { "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "steelGradeCode": "SS275", "steelGradeName": "일반 구조용 압연 강재",
      "standardNo": "KS D 3503", "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000", "theoreticalWeightTon": "23.550" },
    "qty": 2, "qtyUnit": "매", "weightTon": "47.100",
    "heats": [ { "heatNo": "HT-1-260921-001", "composition": {
      "qualityInspectionNo": "QI-20260921-0001", "processCode": "STEELMAKING", "inspectionResult": "PASS", "inspectedAt": "2026-09-21T01:00:00.000Z",
      "values": [ { "inspectionItemCode": "C", "inspectionItemName": "C", "unit": "%", "minValue": null, "maxValue": "0.25", "measuredValue": "0.175", "isPassed": true }, "… Si, Mn, P, S" ] } } ],
    "lots": [ { "lotNo": "HT-1-260921-001-05", "lotType": "SLAB", "heatNo": "HT-1-260921-001", "producedAt": "2026-09-21T04:05:00.000Z",
      "inspection": { "qualityInspectionNo": "QI-20260921-0010", "processCode": "CASTING", "inspectionResult": "PASS", "inspectedAt": "2026-09-21T05:05:00.000Z",
        "values": [ { "inspectionItemCode": "SURFACE_DEFECT_COUNT", "inspectionItemName": "표면 결함 수", "unit": "개", "minValue": null, "maxValue": "2", "measuredValue": "0", "isPassed": true }, "… 두께·폭·길이 편차" ] },
      "parentSlab": null }, "… 1건" ]
  } }
```

코일 밀시트의 LOT:

```json
{ "lotNo": "C1-260923-001-01", "lotType": "COIL", "heatNo": "HT-1-260923-001", "producedAt": "…",
  "inspection": { "qualityInspectionNo": "QI-20260924-0031", "processCode": "HOT_ROLLING", "inspectionResult": "PASS", "inspectedAt": "2026-09-24T05:01:00.000Z",
    "values": [ { "inspectionItemCode": "TENSILE_STRENGTH", "inspectionItemName": "인장강도", "unit": "MPa", "minValue": "270", "maxValue": null, "measuredValue": "302.4", "isPassed": true }, "… 연신율, 두께·폭 편차" ] },
  "parentSlab": { "lotNo": "HT-1-260923-001-01", "inspection": { "processCode": "CASTING", "inspectionResult": "PASS", "values": [ "… 슬래브 표면·치수" ] } } }
```

### 3-3. `POST /mill-sheets/:id/pdf` — PDF 생성 (REQ-SHP-004)

본문 없음. 응답 200: `MillSheetView` (`pdfStatus = 'READY'`, `pdfUrl` 있음).

- 저장된 스냅샷으로만 그린다. 이미 `READY`이고 파일이 있으면 다시 만들지 않고 그대로 돌려준다.
- 실패하면(예: 서버에 한글 글꼴이 없음) `pdf_status = FAILED`로만 바꾸고 **500 `SHP-001`** "밀시트 PDF를 만들지 못했습니다. 스냅샷은 저장되어 있으니 다시 시도해 주세요". 스냅샷·출고는 그대로여서 다시 누르면 같은 내용으로 다시 만든다.
- 글꼴: 환경변수 `MILL_SHEET_FONT_PATH`(.ttf)가 있으면 그것만 쓰고, 없으면 `/System/Library/Fonts/Supplemental/AppleGothic.ttf` → `/Library/Fonts/Arial Unicode.ttf` → `/System/Library/Fonts/Supplemental/Arial Unicode.ttf` → `/usr/share/fonts/truetype/nanum/NanumGothic.ttf` 순으로 찾는다.

```json
{ "id": 21, "millSheetNo": "MS-20260930-0021", "goodsIssueId": 20, "salesOrderId": 141, "customerId": 1,
  "issuedAt": "2026-09-30T11:31:02.176Z", "pdfStatus": "READY", "pdfUrl": "/api/v1/mill-sheets/21/pdf", "snapshot": { "…": "…" } }
```

### 3-4. `GET /mill-sheets/:id/pdf` — PDF 내려받기

응답 200: PDF 바이트 (`Content-Type: application/pdf`, `Content-Disposition: inline; filename="MS-20260930-0021.pdf"`). 공통 응답 포맷으로 감싸지 않는다.
PDF가 아직 없으면(`PENDING`·`FAILED`) 409 `COM-005` "PDF가 아직 없습니다. PDF 생성을 먼저 실행해 주세요".

브라우저 새 창으로 열 때는 헤더를 붙일 수 없으므로 `GET /api/v1/mill-sheets/21/pdf?access_token=<토큰>` 을 쓰거나, `fetch`로 받아 Blob URL로 연다.

---

## 작업 로그 (수주 타임라인)

| 시점 | eventType | reasonCode | summary 예 |
|---|---|---|---|
| 출하요청 | `SHIPMENT_REQUESTED` | – | 출하요청 SHP-20260930-0043: SO-20260930-0141 #1 2매 |
| 배정 확정 | `ALLOCATION_CONFIRMED` | `FIFO_RECOMMENDATION` | SO-20260930-0141 #1 출하 배정 2건 확정 (HT-1-260921-001-05, HT-1-260921-001-06) |
| 출고 확정 (품목마다) | `RESERVATION_CONVERTED` | `GOODS_ISSUE` | 예약 2매 출고 전환 (남은 ACTIVE 예약 4매) |
| 출고 확정 (품목마다) | `MILL_SHEET_ISSUED` | `GOODS_ISSUE` | 밀시트 MS-20260930-0021 발행 (SO-20260930-0141 #1 2매, 히트 HT-1-260921-001) |
| 출고 확정 (수주마다) | `GOODS_ISSUE_CONFIRMED` | `GOODS_ISSUE` | 출고 GI-20260930-0020 확정: SO-20260930-0141 #1 2매 (출하요청 SHP-20260930-0043) |
| 출하요청 취소 (배정이 있었을 때) | `ALLOCATION_RELEASED` | `ALLOCATION_CHANGE` / `ORDER_CANCELLED` | 출하요청 SHP-20260930-0047 취소로 배정 2건 해제 (…) |

여러 수주의 품목을 묶은 출하요청은 수주마다 한 건씩 남아 각 수주 타임라인에 보인다. `lotIds`가 들어 있어 LOT 타임라인에도 나온다.

## 실시간 주제

`shipment-requests`, `allocations`, `goods-issues`, `mill-sheets`, `sales-orders`, `inventories`, `lots`.
