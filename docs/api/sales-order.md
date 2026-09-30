# sales-order API

수주 등록 → 합격 재고 우선 예약 → 부족분 생산계획 / 충족 현황 / 예약 이력 / 수주 취소 (REQ-SO-001~006, BP-SO-01·02).
모든 경로는 `/api/v1` 아래, 로그인 필요(`Authorization: Bearer …`).
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8803, DB `fs_sales`)에 curl로 호출한 응답에서 옮겼다.

- 수량은 **정수 매수**(슬래브 매, 코일 개)다. 톤(`…Ton`)은 서버가 `매수 × 1매 이론중량`으로 계산한 **문자열**(소수 3자리, 예 `"235.500"`)이고 저장하지 않는다.
- 날짜만 있는 값(`dueDate`)은 요청·응답 모두 `"YYYY-MM-DD"`. 시각(`createdAt` 등)은 ISO 8601 문자열.
- 상태값은 `@fantasteel/shared`의 `SALES_ORDER_ITEM_STATUS`(= `SALES_ORDER_STATUS`)와 `…_LABEL`, 예약은 `RESERVATION_STATUS`.
- 수주 헤더 상태(`salesOrderStatus`)는 저장값이 아니라 품목 상태에서 계산한 값이다(`deriveSalesOrderStatus`).

## 권한 요약

| API | 필요한 권한 |
|---|---|
| `GET /sales-orders`, `GET /:id`, `GET /:id/fulfillment`, `GET /:id/reservations` | `ORDER_CREATE` · `PLAN_CONFIRM` · `SHIPMENT_REQUEST` 중 하나 VIEW 이상 (시드 기준 모든 역할) |
| `POST /sales-orders` | `ORDER_CREATE` USE (영업) |
| `POST /sales-orders/:id/cancel` | `ORDER_CANCEL` USE (영업) |

권한이 없으면 403 `COM-002`, 토큰이 없으면 401 `AUTH-002`.

## 공통 타입

```ts
type SalesOrderItemStatus = 'REGISTERED' | 'IN_PROGRESS' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED';
type SalesOrderStatus = SalesOrderItemStatus;               // 헤더 상태(계산값)
type ReservationStatus = 'ACTIVE' | 'CONVERTED' | 'RELEASED';

interface SalesOrderItemView {
  id: number;                       // salesOrderItemId (출하요청에 쓴다)
  lineNo: number;
  productSpecId: number;
  specCode: string;                 // 'SL-SS275-250x1200x10000'
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;                  // '매' | '개'
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;     // 1매 이론중량 '23.550'
  salesOrderItemStatus: SalesOrderItemStatus;
  orderedQty: number;
  orderedTon: string;               // orderedQty × theoreticalWeightTon
  shippedQty: number;               // 누적 출고 확정 매수
  shippedTon: string;
  reservedQty: number;              // 재고에서 잡은 ACTIVE 예약 매수
  passedQty: number;                // 부족분 생산분이 검사 합격해 자동 예약된 ACTIVE 매수
  inProductionQty: number;          // 진행 중 생산계획의 남은 목표 매수 (unsecuredQty를 넘지 않게 자른 값)
  unsecuredQty: number;             // 현재 미확보 = max(0, orderedQty − shippedQty − reservedQty − passedQty)
  additionalPlanNeededQty: number;  // 추가 계획 필요 = max(0, unsecuredQty − 진행 계획 잔여 목표)
  cancelledQty: number;             // 취소된 품목의 미출하 잔량 (취소가 아니면 0)
  progressRate: number;             // % (소수 1자리, 버림) = (reservedQty + passedQty + shippedQty) ÷ orderedQty
}

interface SalesOrderView {
  id: number;
  salesOrderNo: string;             // 'SO-YYYYMMDD-NNNN'
  customer: { id: number; customerCode: string; customerName: string };
  dueDate: string;                  // 'YYYY-MM-DD'
  ownerEmployee: { id: number; employeeNo: string; employeeName: string };   // 수주 담당 = 등록한 사원
  note: string | null;
  salesOrderStatus: SalesOrderStatus;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  orderedQty: number;               // 품목 주문 매수 합 (매·개 구분 없이 더한 값)
  orderedTon: string;
  shippedQty: number;
  shippedTon: string;
  progressRate: number;             // % = Σ(reservedQty + passedQty + shippedQty) ÷ Σ orderedQty, 분모는 취소되지 않은 품목 (전부 취소면 전체 품목)
  daysToDue: number;                // 오늘(Asia/Seoul)부터 납기까지 남은 일수. 오늘 = 0, 지났으면 음수
  isDeliveryRisk: boolean;          // 규칙: daysToDue ≤ production_setting.delivery_risk_days 이고 출하 매수 < 주문 매수 (취소 품목 제외). AI 판단 아님
  workRoomId: number | null;        // 수주 업무방 chat_room id → `/messenger?room=:id`
  createdAt: string;
  items: SalesOrderItemView[];
}
```

### 충족 현황 지표 읽는 법 (업무 프로세스 정의서 4.5)

`reservedQty`(재고 예약) · `passedQty`(검사합격 자동 예약) · `shippedQty`(출하)는 서로 겹치지 않는 **확보된 매수**이고,
`inProductionQty`(생산중)는 **미확보 매수 안에서만** 센다. 그래서 네 값을 더해도 `orderedQty`를 넘지 않는다.

```
reservedQty + passedQty + shippedQty + unsecuredQty = orderedQty        (취소 품목 제외)
inProductionQty + additionalPlanNeededQty = unsecuredQty
```

진행률 분모는 `orderedQty`, 분자는 `reservedQty + passedQty + shippedQty`(생산중은 넣지 않는다).

---

## 1. `POST /sales-orders` — 수주 등록

한 트랜잭션에서: 수주번호 채번 → 수주·품목 저장 → 품목별로 합격·가용 재고 예약(부분 예약 허용) → 부족 매수만 생산계획(`PLANNED`) 생성 → 수주 업무방(`chat_room` WORK, 이름 `#<수주번호>`, 멤버 = 담당자 + 생산부·품질부·물류부·구매부 부서장) 생성 → 작업 로그.
코일·슬래브 품목을 한 수주에 섞을 수 있다.

```ts
// 요청
interface CreateSalesOrderBody {
  customerId: number;
  dueDate: string;                  // 'YYYY-MM-DD'
  note?: string;                    // 500자 이하
  items: { productSpecId: number; orderedQty: number }[];   // 1건 이상. orderedQty는 1 이상의 정수 (JSON 숫자)
}
// 요청 헤더(선택): Idempotency-Key: <문자열 200자 이하>
// 응답 201: SalesOrderView
```

- **Idempotency-Key**: 같은 사원이 같은 키로 다시 보내면 수주를 또 만들지 않고 **처음 응답**을 그대로 돌려준다(본문이 달라도 처음 결과). 네트워크 재시도에는 같은 키를, 새 수주에는 새 키(예: 화면을 열 때 만든 UUID)를 쓴다. 실패한 요청은 키가 남지 않는다. 재응답은 JSON 키 순서만 다를 수 있다.
- 오류

| 상황 | HTTP | code | message |
|---|---|---|---|
| 수량이 소수(10.5)·0·음수·누락·문자열 | 400 | `SO-002` | 수량은 1 이상의 정수로 입력해 주세요 |
| 없는 규격·사용 중지 규격·원료 품목 | 400 | `SO-001` | 등록되지 않은 규격입니다 |
| 없는·사용 중지 고객사 | 400 | `COM-003` | 등록된 고객사를 선택해 주세요 |
| `dueDate` 형식 오류, `items` 빈 배열 등 | 400 | `COM-003` | (항목별 안내) |

수량은 반올림하지 않는다. 품목 중 하나라도 틀리면 수주 전체가 저장되지 않는다.

```bash
curl -X POST :8803/api/v1/sales-orders -H 'Authorization: Bearer …' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: walk-so-1' \
  -d '{"customerId":1,"dueDate":"2026-10-20","note":"1차 납품분","items":[{"productSpecId":1,"orderedQty":10}]}'
```

```json
{ "success": true, "data": {
  "id": 141, "salesOrderNo": "SO-20260930-0141",
  "customer": { "id": 1, "customerCode": "CUS-01", "customerName": "한빛중공업" },
  "dueDate": "2026-10-20",
  "ownerEmployee": { "id": 3, "employeeNo": "2104012", "employeeName": "김영업" },
  "note": "1차 납품분", "salesOrderStatus": "IN_PROGRESS",
  "isCancelled": false, "cancelledAt": null, "cancelReason": null,
  "orderedQty": 10, "orderedTon": "235.500", "shippedQty": 0, "shippedTon": "0.000",
  "progressRate": 60, "daysToDue": 20, "isDeliveryRisk": false, "workRoomId": 141,
  "createdAt": "2026-09-30T11:30:28.632Z",
  "items": [ {
    "id": 146, "lineNo": 1, "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000",
    "itemType": "SLAB", "qtyUnit": "매", "steelGradeCode": "SS275",
    "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000", "theoreticalWeightTon": "23.550",
    "salesOrderItemStatus": "IN_PROGRESS",
    "orderedQty": 10, "orderedTon": "235.500", "shippedQty": 0, "shippedTon": "0.000",
    "reservedQty": 6, "passedQty": 0, "inProductionQty": 4, "unsecuredQty": 4,
    "additionalPlanNeededQty": 0, "cancelledQty": 0, "progressRate": 60
  } ]
} }
```

(시드: SS275 슬래브 합격 재고 6매 → 10매 수주 → ACTIVE 예약 6매 + 부족 4매 생산계획. 품목 상태는 부족분 계획이 있으면 `IN_PROGRESS`, 전량 예약이면 `REGISTERED`.)

## 2. `GET /sales-orders` — 목록

```ts
// 쿼리 (모두 선택)
interface ListSalesOrdersQuery {
  status?: SalesOrderStatus;        // 계산한 헤더 상태로 거른다
  customerId?: number;
  itemType?: 'SLAB' | 'COIL';       // 그 품목 유형이 하나라도 있는 수주
  dueFrom?: string;                 // 납기 범위 'YYYY-MM-DD' (양 끝 포함)
  dueTo?: string;
  keyword?: string;                 // 수주번호·고객사명·규격 코드 부분 일치
  deliveryRiskOnly?: boolean;       // 'true'면 납기 위험 수주만
  page?: number;                    // 기본 1
  size?: number;                    // 기본 50, 최대 200
}
// 응답 200
interface SalesOrderListView { rows: SalesOrderView[]; total: number; page: number; size: number }
```

최신 등록순(id 내림차순). `rows`의 각 행은 상세와 같은 모양이다(품목 요약 포함).
잘못된 `status` → 400 `COM-003` "status는 REGISTERED, IN_PROGRESS, PARTIALLY_SHIPPED, SHIPPED, CANCELLED 중 하나여야 합니다".

```bash
curl ':8803/api/v1/sales-orders?deliveryRiskOnly=true&customerId=2' -H 'Authorization: Bearer …'
# → { "rows": [ { "salesOrderNo": "SO-20260930-0142", "daysToDue": 2, "isDeliveryRisk": true, "salesOrderStatus": "IN_PROGRESS", … } ], "total": 1, "page": 1, "size": 50 }
```

## 3. `GET /sales-orders/:id` — 상세

응답 200: `SalesOrderView`. 없으면 404 `COM-004`.

## 4. `GET /sales-orders/:id/fulfillment` — 수주 충족 현황 (REQ-SO-004)

```ts
interface FulfillmentView extends Omit<SalesOrderView, 'items'> {
  items: FulfillmentItemView[];
}
interface FulfillmentItemView extends SalesOrderItemView {
  productionPlans: {
    id: number;
    productionPlanNo: string;
    productionPlanStatus: string;   // PRODUCTION_PLAN_STATUS
    isReproduction: boolean;
    shortageQty: number;            // 계획 목표 매수
    remainingTargetQty: number;     // 남은 목표 = shortageQty − 이미 적격이 된 생산분 (완료·취소 계획은 0)
    heatCount: number;
    plannedSlabQty: number;
    surplusUseQty: number;
  }[];
  lots: {                           // 이 품목을 위해 생산·귀속된 LOT + 이 품목에 배정(확정·소진)된 LOT, 생산완료일 순
    id: number;
    lotNo: string;
    lotType: string;                // 'SLAB' | 'COIL'
    lotStatus: string;              // LOT_STATUS: 'IN_STOCK' | 'CONSUMED' | 'SHIPPED'
    isPassed: boolean | null;
    heatNo: string | null;
    isHeatPassed: boolean | null;
    producedAt: string;
    productionPlanId: number | null;
    allocationPurpose: 'SHIPMENT' | 'ROLLING' | null;   // 이 품목에 대한 배정이 없으면 null
    allocationStatus: 'CONFIRMED' | 'CONSUMED' | null;
  }[];
}
```

```json
"items": [ { "…": "SalesOrderItemView 필드", "reservedQty": 0, "passedQty": 0, "inProductionQty": 4, "shippedQty": 6, "unsecuredQty": 4,
  "productionPlans": [ { "id": 69, "productionPlanNo": "PP-20260930-0069", "productionPlanStatus": "PLANNED", "isReproduction": false,
    "shortageQty": 4, "remainingTargetQty": 4, "heatCount": 0, "plannedSlabQty": 0, "surplusUseQty": 0 } ],
  "lots": [ { "id": 16, "lotNo": "HT-1-260921-001-05", "lotType": "SLAB", "lotStatus": "SHIPPED", "isPassed": true,
    "heatNo": "HT-1-260921-001", "isHeatPassed": true, "producedAt": "2026-09-21T04:05:00.000Z", "productionPlanId": null,
    "allocationPurpose": "SHIPMENT", "allocationStatus": "CONSUMED" } ]
} ]
```

## 5. `GET /sales-orders/:id/reservations` — 예약 이력

ACTIVE·CONVERTED·RELEASED 모두, id 순.

```ts
type Response = {
  id: number;
  salesOrderItemId: number;
  lineNo: number;
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  reservedQty: number;
  reservedTon: string;
  status: ReservationStatus;
  isAutoReserved: boolean;          // true = 부족분 생산분 검사 합격 시 자동 예약 (SYSTEM)
  createdAt: string;
  updatedAt: string;
}[];
```

부분 출고는 예약을 나눈다: ACTIVE 6매에서 2매 출고 → `ACTIVE 4` + `CONVERTED 2` 두 행.

```json
[ { "id": 122, "salesOrderItemId": 146, "lineNo": 1, "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB",
    "reservedQty": 6, "reservedTon": "141.300", "status": "ACTIVE", "isAutoReserved": false,
    "createdAt": "2026-09-30T11:30:28.640Z", "updatedAt": "2026-09-30T11:30:28.640Z" } ]
```

## 6. `POST /sales-orders/:id/cancel` — 수주 취소 (REQ-SO-006)

```ts
// 요청
interface CancelSalesOrderBody { reason?: string }   // 500자 이하
// 응답 200: SalesOrderView (isCancelled = true)
```

한 트랜잭션에서:
1. 출고가 끝난 매수는 그대로 둔다 (shipped_qty, CONVERTED 예약, 출고, 밀시트 유지).
2. 취소 품목이 들어 있는 **미출고 출하요청은 요청 전체를 취소**하고 확정 배정을 해제한다 (출하요청 품목에는 취소 상태가 없고 출고 확정이 요청 단위여서). 같은 출하요청에 묶였던 다른 수주 품목은 다시 출하요청해야 한다.
3. ACTIVE 예약 → `RELEASED`, 재고 풀의 예약 매수 감소.
4. 시작 전 생산계획 → `CANCELLED`. 생산 중 계획은 수주 연결만 끊고 완료 후 슬래브 여재가 된다. 열연 배정은 해제하고 귀속 슬래브는 재고 풀(여재)로 돌아간다.
5. 품목 상태:
   - 미출하 품목 → `CANCELLED`
   - 전량 출하된 품목 → `SHIPPED` 유지
   - **일부 출하된 품목 → `CANCELLED`**. `orderedQty`·`shippedQty`는 그대로 두고 잔량은 `cancelledQty = orderedQty − shippedQty`로 보여 준다.
6. 헤더: `isCancelled = true`, `cancelledAt`, `cancelReason`. 헤더 상태는 남은 품목에서 계산한다 (전부 취소 → `CANCELLED`, 출하완료 품목이 남아 있으면 `SHIPPED`).
7. 작업 로그(`SALES_ORDER_CANCELLED`, `RESERVATION_RELEASED`, `ALLOCATION_RELEASED`, `PRODUCTION_PLAN_CANCELLED`/`SURPLUS_CONVERTED`)와 생산·물류 역할 알림.

| 상황 | HTTP | code | message |
|---|---|---|---|
| 이미 취소됨 | 409 | `COM-005` | 이미 취소된 수주입니다 |
| 모든 품목이 출하완료 | 409 | `COM-005` | 전량 출하된 수주는 취소할 수 없습니다 |
| 없는 수주 | 404 | `COM-004` | 수주을(를) 찾을 수 없습니다 |

```bash
curl -X POST :8803/api/v1/sales-orders/141/cancel -H 'Authorization: Bearer …' -H 'Content-Type: application/json' -d '{"reason":"고객 사정으로 잔량 취소"}'
# 10매 중 6매 출하 뒤 취소 →
# "salesOrderStatus": "CANCELLED", "isCancelled": true, "cancelReason": "고객 사정으로 잔량 취소", "shippedQty": 6, "progressRate": 60,
# "items": [ { "salesOrderItemStatus": "CANCELLED", "orderedQty": 10, "shippedQty": 6, "cancelledQty": 4, "unsecuredQty": 0, "inProductionQty": 0, … } ]
```

## 작업 로그 (수주 타임라인 `GET /business-events?salesOrderId=`)

| 시점 | eventType | reasonCode | summary 예 |
|---|---|---|---|
| 등록 | `SALES_ORDER_REGISTERED` | – | 한빛중공업 수주 SO-20260930-0141 등록 (품목 1건) |
| 재고 예약 | `RESERVATION_CREATED` | `STOCK_FIRST` | 합격 재고 6매 예약 |
| 부족분 계획 | `PRODUCTION_PLAN_CREATED` | `ORDER_SHORTAGE` | SO-20260930-0141 #1 부족 4매 생산계획 생성 |
| 취소 | `RESERVATION_RELEASED` / `PRODUCTION_PLAN_CANCELLED` / `SALES_ORDER_CANCELLED` | `ORDER_CANCELLED` | 수주 SO-20260930-0141 취소 (#1 잔량 4매) |

## 실시간 주제

등록·취소 뒤 `changed` 이벤트로 `sales-orders`, `inventories`, `production-plans`, `chat-rooms`(등록), `shipment-requests`·`allocations`(취소)가 나간다.
