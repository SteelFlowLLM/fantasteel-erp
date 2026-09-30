# 대시보드 API (`modules/dashboard`) — P3

REQ-DSH-001·002, BP-DSH-01. 기준 URL `/api/v1`, 응답 `{ success: true, data }`.

**권한**: 로그인한 사원은 **모든 위젯 데이터를 볼 수 있다** (v2에서는 역할별 위젯 범위가 설계 문서에서 TBD라서 나누지 않았다 — 역할 제한이 정해지면 서비스에서 추가). 배치는 본인 것만 읽고 쓴다 (사원 id는 토큰에서 가져오며 요청 본문의 값은 쓰지 않는다). 토큰 없으면 `401 AUTH-002`.

모든 위젯 값은 DB 집계이며 고정 숫자를 넣지 않는다 (P2 위젯 제외). 데이터가 없으면 빈 배열·0·`null` 을 돌려준다.
Decimal은 문자열 (이름이 `…Ton`이면 소수 3자리), Date는 ISO 8601. 비율(`…Rate`)은 0~1 범위의 **소수 4자리 문자열**(`"0.4000"`)이고 분모가 0이면 `null`.
"오늘"·"하루"는 **한국 시간(UTC+9)** 기준이다 (`date: "2026-09-30"`).

| 메서드·경로 | 설명 |
|---|---|
| `GET /dashboard/layout` | 내 위젯 배치 |
| `PUT /dashboard/layout` | 내 위젯 배치 저장 |
| `GET /dashboard/widgets/:widgetCode` | 위젯 데이터 |
| `GET /search?q=` | 통합 검색 |

---

## 위젯 배치

```ts
type WidgetCode = 'PROCESS_FLOW' | 'ORDER_FULFILLMENT' | 'AGENT_RISK' | 'RECENT_EVENTS' | 'PRODUCT_STOCK' | 'PROCESS_YIELD'
  | 'RAW_MATERIAL_BALANCE' | 'REJECT_RATE' | 'DELIVERY_RISK' | 'PURCHASE_PROGRESS' | 'SHIPMENT_RESULT' | 'SURPLUS_AGE' | 'PRODUCTION_VOLUME' | 'AI_USAGE';

interface WidgetPlacement { widgetCode: WidgetCode; x: number; y: number; w: number; h: number }   // 12칸 격자

interface DashboardLayoutResponse {
  placements: WidgetPlacement[];
  isDefault: boolean;     // 저장한 배치가 없어 기본 배치를 준 경우 true
}
```

위젯 목록·이름·기본 크기·P2 여부는 `@fantasteel/shared` 의 `WIDGETS` 를 쓴다 (서버도 이것으로 검증한다). 위젯 추가 = 배치에 넣기, 제외 = 빼기 (REQ-DSH-002).

### `GET /dashboard/layout`

저장한 배치가 없으면(또는 저장값이 깨졌으면) **기본 배치** — `WIDGETS` 중 `isDefault` 위젯을 기본 크기로 왼쪽→오른쪽, 12칸이 넘치면 다음 줄로 채운 것. 실제 응답 (`2104012` 김영업, 저장한 배치 없음):

```json
{
  "placements": [
    { "widgetCode": "PROCESS_FLOW",      "x": 0, "y": 0,  "w": 12, "h": 3 },
    { "widgetCode": "ORDER_FULFILLMENT", "x": 0, "y": 3,  "w": 6,  "h": 5 },
    { "widgetCode": "AGENT_RISK",        "x": 6, "y": 3,  "w": 6,  "h": 5 },
    { "widgetCode": "RECENT_EVENTS",     "x": 0, "y": 8,  "w": 6,  "h": 5 },
    { "widgetCode": "PRODUCT_STOCK",     "x": 6, "y": 8,  "w": 6,  "h": 5 },
    { "widgetCode": "PROCESS_YIELD",     "x": 0, "y": 13, "w": 6,  "h": 4 }
  ],
  "isDefault": true
}
```

### `PUT /dashboard/layout`

본문 `{ "placements": WidgetPlacement[] }` — 전체 배치를 통째로 덮어쓴다. 빈 배열도 허용(위젯을 모두 뺀 화면). 응답은 저장된 `DashboardLayoutResponse` (`isDefault: false`).

검증 (모두 `400 COM-003` + 한국어 메시지, 실패하면 이전 저장값 유지):

| 규칙 | 메시지 예 |
|---|---|
| `widgetCode`는 `WIDGETS` 안의 코드 | `알 수 없는 위젯입니다: FOO` |
| 같은 위젯 중복 금지 | `같은 위젯을 두 번 배치할 수 없습니다: PRODUCT_STOCK` |
| `x, y, w, h` 정수 | `placements.0.x는 정수여야 합니다` |
| `x ≥ 0`, `y ≥ 0` | `PRODUCT_STOCK의 위치(x, y)는 0 이상이어야 합니다` |
| `w ≥ 1`, `h ≥ 1` | `PRODUCT_STOCK의 크기(w, h)는 1 이상이어야 합니다` |
| `x + w ≤ 12` | `PRODUCT_STOCK가 12칸 격자를 벗어납니다 (x + w ≤ 12)` |
| `placements`가 배열이 아님·본문 없음 | `placements는 배열이어야 합니다` |

겹침(같은 칸에 두 위젯)은 검사하지 않는다 — 격자 라이브러리가 정리한다. P2 위젯(`AGENT_RISK`, `AI_USAGE`)도 배치할 수 있고 위젯 데이터는 "준비 중"으로 온다.

---

## 위젯 데이터 `GET /dashboard/widgets/:widgetCode`

쿼리 (모두 선택): `days`(1~90) — `REJECT_RATE` 기본 30, `SHIPMENT_RESULT`·`PRODUCTION_VOLUME` 기본 14 / `limit`(1~50) — 목록 위젯의 최대 행 수 (`RECENT_EVENTS` 기본 10, `SURPLUS_AGE` 기본 40, 그 밖 20). 위젯이 쓰지 않는 쿼리는 무시한다.
없는 코드는 `404 COM-004`, 값 오류는 `400 COM-003`.

모든 응답의 머리말:

```ts
interface WidgetHead { widgetCode: WidgetCode; available: true; generatedAt: string }
// P2 위젯 (AGENT_RISK, AI_USAGE) — 데이터 없음
interface WidgetUnavailable { widgetCode: 'AGENT_RISK' | 'AI_USAGE'; available: false; grade: 'P2' }
```
```json
{ "widgetCode": "AGENT_RISK", "available": false, "grade": "P2" }
```
`available === false` 이면 "준비 중 (P2)" 카드로 그린다.

### PROCESS_FLOW — 공정 흐름 현황

```ts
interface ProcessFlowWidget extends WidgetHead {
  stages: { key: string; label: string; count: number; unit: string; linkPath: string | null }[];   // 순서대로 화면에 나열
  issuedToday: { date: string; goodsIssueCount: number; lotCount: number };
}
```
`stages[].key` (순서): `OPEN_PLANS`(진행 중 생산계획 = PLANNED·CONFIRMED·IN_PROGRESS) · `HEAT_AWAITING_INSPECTION` · `SLAB_AWAITING_INSPECTION` · `COIL_AWAITING_INSPECTION`(각 `is_passed` null) · `QUALIFIED_SLAB` · `QUALIFIED_COIL`(적격 = 자기 검사 합격 + 상위 히트 합격 + IN_STOCK) · `OPEN_SHIPMENT_REQUESTS`(REQUESTED·ALLOCATED·PARTIALLY_ISSUED) · `ISSUED_TODAY`(오늘 출고한 LOT 수).

```json
{ "widgetCode": "PROCESS_FLOW", "available": true, "generatedAt": "2026-09-30T11:25:07.172Z",
  "stages": [
    { "key": "OPEN_PLANS", "label": "진행 중 생산계획", "count": 1, "unit": "건", "linkPath": "/production/plans" },
    { "key": "HEAT_AWAITING_INSPECTION", "label": "히트 검사 대기", "count": 0, "unit": "개", "linkPath": "/quality/inspections" },
    { "key": "SLAB_AWAITING_INSPECTION", "label": "슬래브 검사 대기", "count": 1, "unit": "매", "linkPath": "/quality/inspections" },
    { "key": "COIL_AWAITING_INSPECTION", "label": "코일 검사 대기", "count": 1, "unit": "개", "linkPath": "/quality/inspections" },
    { "key": "QUALIFIED_SLAB", "label": "합격 슬래브 재고", "count": 16, "unit": "매", "linkPath": null },
    { "key": "QUALIFIED_COIL", "label": "합격 코일 재고", "count": 17, "unit": "개", "linkPath": null },
    { "key": "OPEN_SHIPMENT_REQUESTS", "label": "진행 중 출하요청", "count": 0, "unit": "건", "linkPath": null },
    { "key": "ISSUED_TODAY", "label": "오늘 출고", "count": 2, "unit": "개", "linkPath": "/goods-issues" } ],
  "issuedToday": { "date": "2026-09-30", "goodsIssueCount": 1, "lotCount": 2 } }
```

### ORDER_FULFILLMENT — 수주 충족 현황

진행 중 수주(취소·전량 출하 제외)를 납기 빠른 순으로. 품목별·수주별 수치:

```ts
interface OrderFulfillmentWidget extends WidgetHead {
  deliveryRiskDays: number;                  // production_setting.delivery_risk_days
  definitions: { progressRate: string; reservedQty: string; inProductionQty: string; note: string };   // 화면 툴팁에 그대로 써도 되는 정의 문구
  totalOpenSalesOrders: number;                   // limit 적용 전 전체 진행 중 수주 수
  salesOrders: {
    salesOrderId: number; salesOrderNo: string; customerName: string;
    dueDate: string; daysToDue: number;      // 오늘(한국 날짜) 기준 남은 일수, 지났으면 음수
    isDeliveryRisk: boolean;                 // 품목 중 하나라도 납기 위험 (DELIVERY_RISK 규칙)
    orderedQty: number; orderedTon: string;
    reservedQty: number;                     // ACTIVE 예약 매수 (미출고)
    inProductionQty: number;                 // 진행 중 생산계획의 잔여 목표 = 계획 목표 − 불합격 아닌 생산 LOT 수 (계획 상태 PLANNED·CONFIRMED·IN_PROGRESS)
    shippedQty: number;
    progressRate: string | null;             // 출하 ÷ 주문 (분모 = 주문 매수)
    linkPath: string;                        // /sales-orders/:id
    items: {
      salesOrderItemId: number; lineNo: number; specCode: string;
      orderedQty: number; orderedTon: string; reservedQty: number; inProductionQty: number; shippedQty: number;
      remainingQty: number; progressRate: string | null; isDeliveryRisk: boolean;
    }[];
  }[];
}
```
예약·생산 중·출하는 같은 제품의 서로 다른 단계라서 **더해서 "충족 매수"로 쓰지 않는다** (업무 프로세스 정의서 4.5). 수주 합계 매수는 슬래브 매 + 코일 개를 그대로 더한 값이다.

```json
{ "widgetCode": "ORDER_FULFILLMENT", "available": true, "generatedAt": "2026-09-30T11:25:07.210Z", "deliveryRiskDays": 3,
  "definitions": { "progressRate": "출하 매수 ÷ 주문 매수 (분모 = 주문 매수)", "reservedQty": "ACTIVE 예약 매수 (미출고)", "inProductionQty": "진행 중 생산계획의 잔여 목표 매수 = 계획 목표 매수 − 불합격이 아닌 생산 LOT 수", "note": "예약·생산 중·출하는 같은 제품의 서로 다른 단계이므로 더해서 충족 매수로 쓰지 않는다. 수주 합계는 슬래브 매 + 코일 개를 그대로 더한 값이다." },
  "totalOpenSalesOrders": 1,
  "salesOrders": [ { "salesOrderId": 72, "salesOrderNo": "SO-TSTDOC-2", "customerName": "미래자동차부품", "dueDate": "2026-10-02T00:00:00.000Z", "daysToDue": 2, "isDeliveryRisk": true,
    "orderedQty": 10, "orderedTon": "235.500", "reservedQty": 3, "inProductionQty": 3, "shippedQty": 4, "progressRate": "0.4000", "linkPath": "/sales-orders/72",
    "items": [ { "salesOrderItemId": 79, "lineNo": 1, "specCode": "SL-SS275-250x1200x10000", "orderedQty": 10, "orderedTon": "235.500", "reservedQty": 3, "inProductionQty": 3, "shippedQty": 4, "remainingQty": 6, "progressRate": "0.4000", "isDeliveryRisk": true } ] } ] }
```

### RECENT_EVENTS — 최근 작업 로그

```ts
interface RecentEventsWidget extends WidgetHead {
  items: { id: number; occurredAt: string; eventType: string; eventTypeLabel: string; actorType: 'USER' | 'SYSTEM'; actorLabel: string;
           summary: string; targetType: string; targetNo: string | null; salesOrderId: number | null; isAiAssisted: boolean;
           linkPath: string | null }[];   // 최신순. linkPath = salesOrderId가 있으면 "/business-events?salesOrderId=:id", 없으면 null
}
```
```json
{ "widgetCode": "RECENT_EVENTS", "available": true, "generatedAt": "2026-09-30T11:25:07.233Z",
  "items": [ { "id": 47, "occurredAt": "2026-09-30T07:23:43.975Z", "eventType": "GOODS_ISSUE_CONFIRMED", "eventTypeLabel": "출고", "actorType": "USER", "actorLabel": "김영업",
    "summary": "출고 GI-TSTDOC 확정 (슬래브 1매, 코일 1개)", "targetType": "GOODS_ISSUE", "targetNo": "GI-TSTDOC", "salesOrderId": 71, "isAiAssisted": false, "linkPath": "/business-events?salesOrderId=71" } ] }
```

### PRODUCT_STOCK — 제품 재고

규격별 (재고가 0이 아니거나 예약이 있는 규격만). 재고 풀 기준: 합격·미소진 재고, 열연 투입용으로 귀속된 슬래브는 제외, 가용 = 재고 − 예약. 톤은 매수 × 1매 이론중량 계산값.

```ts
interface ProductStockWidget extends WidgetHead {
  note: string;
  items: { productSpecId: number; specCode: string; itemType: 'SLAB' | 'COIL'; itemTypeLabel: string; unit: '매' | '개'; steelGradeCode: string;
           theoreticalWeightTon: string; onHandQty: number; reservedQty: number; availableQty: number;
           onHandTon: string; reservedTon: string; availableTon: string }[];      // 슬래브 → 코일, 규격 코드 순
  totals: { itemType: 'SLAB' | 'COIL'; itemTypeLabel: string; onHandQty: number; reservedQty: number; availableQty: number;
            onHandTon: string; reservedTon: string; availableTon: string }[];       // 항상 SLAB, COIL 2행
}
```
```json
{ "widgetCode": "PRODUCT_STOCK", "available": true, "generatedAt": "2026-09-30T11:25:07.249Z",
  "note": "재고 풀 기준: 합격·미소진 재고 중 열연 투입용으로 귀속된 슬래브는 제외. 가용 = 재고 − 예약",
  "items": [ { "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "itemTypeLabel": "슬래브", "unit": "매", "steelGradeCode": "SS275", "theoreticalWeightTon": "23.550",
               "onHandQty": 6, "reservedQty": 0, "availableQty": 6, "onHandTon": "141.300", "reservedTon": "0.000", "availableTon": "141.300" } ],
  "totals": [ { "itemType": "SLAB", "itemTypeLabel": "슬래브", "onHandQty": 15, "reservedQty": 0, "availableQty": 15, "onHandTon": "340.302", "reservedTon": "0.000", "availableTon": "340.302" },
              { "itemType": "COIL", "itemTypeLabel": "코일", "onHandQty": 17, "reservedQty": 0, "availableQty": 17, "onHandTon": "349.804", "reservedTon": "0.000", "availableTon": "349.804" } ] }
```
(`items`는 규격 6개 중 1개만 실었다.)

### PROCESS_YIELD — 공정별 수율

`production_result` 중 **완료(COMPLETED) 실적** 전체를 공정별로 합산. 실적이 없어도 4개 공정이 모두 나온다 (0·`null`).

```ts
interface ProcessYieldWidget extends WidgetHead {
  definitions: { plannedYieldRate: string; actualYieldRate: string; qtyAttainmentRate: string };
  processes: {                               // 제선 → 제강 → 연주 → 열연
    processCode: 'IRONMAKING' | 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'; processLabel: string;
    resultCount: number;
    inputTon: string; outputTon: string;     // 합계
    plannedQty: number; outputQty: number; lossQty: number;   // 합계 (연주·열연은 매수)
    plannedYieldRate: string | null;         // 라우팅 계획 수율 (제선·열연은 라우팅에 없어 null — 열연은 규격 매핑에서 계산하는 값이라 여기서는 주지 않음)
    actualYieldRate: string | null;          // 산출 톤 합 ÷ 투입 톤 합 (투입 0이면 null)
    qtyAttainmentRate: string | null;        // 산출 매수 합 ÷ 계획 매수 합 (계획 0이면 null) — "계획 대비 산출"
  }[];
}
```
```json
{ "widgetCode": "PROCESS_YIELD", "available": true, "generatedAt": "2026-09-30T11:25:07.266Z",
  "definitions": { "plannedYieldRate": "라우팅의 계획 수율 (없으면 null)", "actualYieldRate": "완료 실적의 산출 톤 합 ÷ 투입 톤 합 (투입이 0이면 null)", "qtyAttainmentRate": "완료 실적의 산출 매수 합 ÷ 계획 매수 합 (계획이 0이면 null)" },
  "processes": [
    { "processCode": "STEELMAKING", "processLabel": "제강", "resultCount": 1, "inputTon": "500.000", "outputTon": "475.000", "plannedQty": 0, "outputQty": 0, "lossQty": 0, "plannedYieldRate": "0.9500", "actualYieldRate": "0.9500", "qtyAttainmentRate": null },
    { "processCode": "CASTING", "processLabel": "연주", "resultCount": 2, "inputTon": "500.000", "outputTon": "447.500", "plannedQty": 20, "outputQty": 19, "lossQty": 1, "plannedYieldRate": "0.9600", "actualYieldRate": "0.8950", "qtyAttainmentRate": "0.9500" },
    { "processCode": "HOT_ROLLING", "processLabel": "열연", "resultCount": 0, "inputTon": "0.000", "outputTon": "0.000", "plannedQty": 0, "outputQty": 0, "lossQty": 0, "plannedYieldRate": null, "actualYieldRate": null, "qtyAttainmentRate": null } ] }
```
(제선 행은 생략. 위 값은 시험용 실적 4건 기준.)

### RAW_MATERIAL_BALANCE — 원료 잔량 대비 소요

```ts
interface RawMaterialBalanceWidget extends WidgetHead {
  mrpRun: { mrpRunId: number; mrpRunNo: string; createdAt: string } | null;   // 최신 MRP 실행. 없으면 null
  items: { rawMaterialId: number; materialCode: string; materialName: string; rawMaterialType: string; rawMaterialTypeLabel: string;
           onHandTon: string;             // inventory.on_hand_ton
           scheduledReceiptTon: string;   // 확정·부분 입고 발주의 (발주 − 입고) 합
           grossRequiredTon: string | null;   // 최신 MRP의 총소요. 그 실행에 이 원료가 없으면 null
           netRequiredTon: string | null }[]; // 최신 MRP의 순소요
}
```
```json
{ "widgetCode": "RAW_MATERIAL_BALANCE", "available": true, "generatedAt": "2026-09-30T11:25:07.283Z",
  "mrpRun": { "mrpRunId": 7, "mrpRunNo": "MRP-TSTDOC", "createdAt": "2026-09-30T11:23:43.988Z" },
  "items": [ { "rawMaterialId": 2, "materialCode": "CL", "materialName": "석탄", "rawMaterialType": "COAL", "rawMaterialTypeLabel": "석탄",
               "onHandTon": "300.000", "scheduledReceiptTon": "120.000", "grossRequiredTon": "375.000", "netRequiredTon": "0.000" },
             { "rawMaterialId": 3, "materialCode": "LS", "materialName": "석회석", "rawMaterialType": "LIMESTONE", "rawMaterialTypeLabel": "석회석",
               "onHandTon": "150.000", "scheduledReceiptTon": "0.000", "grossRequiredTon": null, "netRequiredTon": null } ] }
```
(원료 5종 중 2개만 실었다.)

### REJECT_RATE — 강종별 불합격률

최근 `days`일(기본 30, 지금부터 거슬러) 안에 **판정된(PASS·FAIL) 검사 기록**(`inspected_at` 기준)을 강종별로. 불합격률 = 불합격 ÷ 판정된 검사 수. 검사 기록 1건 = 1 (같은 LOT을 다시 검사하면 각각 센다). 활성 강종은 검사가 없어도 모두 나온다 (`rejectRate: null`). 강종은 검사한 LOT의 강종.

```ts
interface RejectRateWidget extends WidgetHead {
  days: number; from: string; to: string;
  definitions: { rejectRate: string; note: string };
  grades: { steelGradeId: number; steelGradeCode: string; inspectedCount: number; failedCount: number; rejectRate: string | null;
            byProcess: { processCode: 'STEELMAKING' | 'CASTING' | 'HOT_ROLLING'; processLabel: string; inspectedCount: number; failedCount: number; rejectRate: string | null }[] }[];   // 강종 코드 순
}
```
```json
{ "widgetCode": "REJECT_RATE", "available": true, "generatedAt": "2026-09-30T11:25:07.300Z", "days": 30, "from": "2026-08-31T11:25:07.300Z", "to": "2026-09-30T11:25:07.300Z",
  "definitions": { "rejectRate": "불합격 검사 수 ÷ 판정된(합격+불합격) 검사 수, 기간 안에 검사한 건 기준. 검사 기록 1건 = 1", "note": "같은 LOT을 다시 검사하면 각각 센다" },
  "grades": [ { "steelGradeId": 1, "steelGradeCode": "SS275", "inspectedCount": 16, "failedCount": 1, "rejectRate": "0.0625",
                "byProcess": [ { "processCode": "STEELMAKING", "processLabel": "제강", "inspectedCount": 1, "failedCount": 0, "rejectRate": "0.0000" },
                               { "processCode": "CASTING", "processLabel": "연주", "inspectedCount": 11, "failedCount": 1, "rejectRate": "0.0909" },
                               { "processCode": "HOT_ROLLING", "processLabel": "열연", "inspectedCount": 4, "failedCount": 0, "rejectRate": "0.0000" } ] } ] }
```
(강종 3개 중 SS275만 실었다.)

### DELIVERY_RISK — 납기 위험 수주

**규칙(AI 아님)**: 납기까지 남은 일수 ≤ `production_setting.delivery_risk_days`(초기 3) **이고** 출하 매수 < 주문 매수. 납기가 이미 지난 미출하 품목도 포함(`daysToDue` 음수). 취소된 수주·품목 제외. 수주 **품목** 단위 행, 남은 일수 적은 순(지난 것 먼저).

```ts
interface DeliveryRiskWidget extends WidgetHead {
  deliveryRiskDays: number;
  rule: string;
  total: number;                             // limit 적용 전 건수
  items: { salesOrderId: number; salesOrderNo: string; salesOrderItemId: number; lineNo: number; customerName: string; specCode: string;
           orderedQty: number; shippedQty: number; remainingQty: number; remainingTon: string;
           dueDate: string; daysToDue: number; isOverdue: boolean; linkPath: string }[];
}
```
```json
{ "widgetCode": "DELIVERY_RISK", "available": true, "generatedAt": "2026-09-30T11:25:07.316Z", "deliveryRiskDays": 3,
  "rule": "납기까지 남은 일수 ≤ 기준일 이고 출하 매수 < 주문 매수 (규칙 판정, AI 아님). 납기가 지난 미출하 품목 포함", "total": 1,
  "items": [ { "salesOrderId": 72, "salesOrderNo": "SO-TSTDOC-2", "salesOrderItemId": 79, "lineNo": 1, "customerName": "미래자동차부품", "specCode": "SL-SS275-250x1200x10000",
               "orderedQty": 10, "shippedQty": 4, "remainingQty": 6, "remainingTon": "141.300", "dueDate": "2026-10-02T00:00:00.000Z", "daysToDue": 2, "isOverdue": false, "linkPath": "/sales-orders/72" } ] }
```

### PURCHASE_PROGRESS — 구매 진행

```ts
interface PurchaseProgressWidget extends WidgetHead {
  requisitionsByStatus: { status: 'DRAFT' | 'WAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ORDERED'; label: string; count: number }[];   // 항상 5행
  openPurchaseOrders: {                      // 미입고가 남은 발주(CONFIRMED·PARTIALLY_RECEIVED)
    count: number; outstandingTon: string;   // 미입고 톤 합 = Σ(발주 − 입고)
    purchaseOrders: { purchaseOrderId: number; purchaseOrderNo: string; supplierName: string; dueDate: string | null; outstandingTon: string; lineCount: number }[];   // 납기 빠른 순(납기 없는 발주는 뒤), limit개
  };
}
```
```json
{ "widgetCode": "PURCHASE_PROGRESS", "available": true, "generatedAt": "2026-09-30T11:25:07.333Z",
  "requisitionsByStatus": [ { "status": "DRAFT", "label": "작성 중", "count": 0 }, { "status": "WAITING_APPROVAL", "label": "승인 대기", "count": 1 }, { "status": "APPROVED", "label": "승인", "count": 0 }, { "status": "REJECTED", "label": "반려", "count": 0 }, { "status": "ORDERED", "label": "발주 완료", "count": 0 } ],
  "openPurchaseOrders": { "count": 1, "outstandingTon": "120.000",
    "purchaseOrders": [ { "purchaseOrderId": 7, "purchaseOrderNo": "PO-TSTDOC", "supplierName": "호주광업상사", "dueDate": "2026-10-04T00:00:00.000Z", "outstandingTon": "120.000", "lineCount": 1 } ] } }
```

### SHIPMENT_RESULT — 출하 실적

최근 `days`일(기본 14, 오늘 포함) **하루 단위**, 출고 확정 시각(`goods_issue.confirmed_at`, 한국 날짜) 기준. 출고 LOT 1개 = 1(슬래브 1매 또는 코일 1개), 톤 = 출고 LOT의 규격 이론중량 합. 출고가 없는 날도 0으로 채워 `days`개가 항상 나온다 (오래된 날 → 오늘).

```ts
interface ShipmentResultWidget extends WidgetHead {
  days: number;
  series: { date: string; issuedQty: number; slabQty: number; coilQty: number; issuedTon: string }[];
  totalQty: number; totalTon: string;
}
```
```json
{ "widgetCode": "SHIPMENT_RESULT", "available": true, "generatedAt": "2026-09-30T11:25:07.349Z", "days": 14,
  "series": [ { "date": "2026-09-17", "issuedQty": 0, "slabQty": 0, "coilQty": 0, "issuedTon": "0.000" },
              "… 12일 생략 …",
              { "date": "2026-09-30", "issuedQty": 2, "slabQty": 1, "coilQty": 1, "issuedTon": "46.525" } ],
  "totalQty": 2, "totalTon": "46.525" }
```

### SURPLUS_AGE — 여재 보유 기간

**여재 슬래브** = 적격(자기 검사 합격 + 상위 히트 합격 + `IN_STOCK`) · `sales_order_item_id` 없음 · CONFIRMED 배정 없음. 보유 일수 = 생산완료일(`produced_at`)부터 지금까지의 만 일수. 오래된 순 `limit`개 (`summary`는 전체 기준).

```ts
interface SurplusAgeWidget extends WidgetHead {
  definition: string;
  summary: { count: number; totalTon: string; maxAgeDays: number | null; avgAgeDays: number | null };   // 여재가 없으면 count 0, 나머지 null/"0.000"
  items: { lotId: number; lotNo: string; specCode: string | null; steelGradeCode: string | null; weightTon: string | null;
           producedAt: string; ageDays: number; linkPath: string }[];   // linkPath = "/lots/trace?lot=:lotNo"
}
```
```json
{ "widgetCode": "SURPLUS_AGE", "available": true, "generatedAt": "2026-09-30T11:25:07.364Z",
  "definition": "여재 슬래브 = 적격(검사·상위 히트 합격, 재고) · 수주 미귀속 · CONFIRMED 배정 없음. 보유 일수 = 생산완료일부터 오늘까지",
  "summary": { "count": 16, "totalTon": "363.852", "maxAgeDays": 20, "avgAgeDays": 8.8 },
  "items": [ { "lotId": 403, "lotNo": "TSTDOC-HT-03", "specCode": "SL-SS275-250x1200x10000", "steelGradeCode": "SS275", "weightTon": "23.550", "producedAt": "2026-09-10T11:23:43.992Z", "ageDays": 20, "linkPath": "/lots/trace?lot=TSTDOC-HT-03" },
             { "lotId": 16, "lotNo": "HT-1-260921-001-05", "specCode": "SL-SS275-250x1200x10000", "steelGradeCode": "SS275", "weightTon": "23.550", "producedAt": "2026-09-21T04:05:00.000Z", "ageDays": 9, "linkPath": "/lots/trace?lot=HT-1-260921-001-05" } ] }
```
(`items`는 16건 중 2건만 실었다.)

### PRODUCTION_VOLUME — 생산량

최근 `days`일(기본 14) 하루 단위로 만든 슬래브·코일 LOT 수. 생산완료일(`produced_at`, 한국 날짜) 기준이며 검사 결과와 무관. 빈 날은 0.

```ts
interface ProductionVolumeWidget extends WidgetHead {
  days: number; definition: string;
  series: { date: string; slabQty: number; coilQty: number }[];
  totalSlabQty: number; totalCoilQty: number;
}
```
```json
{ "widgetCode": "PRODUCTION_VOLUME", "available": true, "generatedAt": "2026-09-30T11:25:07.381Z", "days": 14,
  "definition": "생산완료일(produced_at) 기준으로 만든 슬래브·코일 LOT 수 (검사 결과와 무관)",
  "series": [ { "date": "2026-09-21", "slabQty": 10, "coilQty": 0 }, { "date": "2026-09-22", "slabQty": 8, "coilQty": 4 }, { "date": "2026-09-23", "slabQty": 14, "coilQty": 4 }, { "date": "2026-09-24", "slabQty": 0, "coilQty": 9 }, "…" ],
  "totalSlabQty": 34, "totalCoilQty": 18 }
```

### AGENT_RISK, AI_USAGE

P2 — `{ "widgetCode": "AGENT_RISK", "available": false, "grade": "P2" }` 만 온다.

---

## 통합 검색 `GET /search?q=`

검색 상자용. 번호의 **일부**(대소문자 무시)로 아래 6종을 찾아 이동 경로를 돌려준다. 최대 10건, 정확히 일치하는 번호가 맨 앞, 나머지는 종류를 번갈아 (앞부분 일치 우선) 채운다. `q`가 비면 `[]`. 60자 초과 `400 COM-003`.

```ts
type SearchResponse = {
  kind: 'SALES_ORDER' | 'LOT' | 'PRODUCTION_PLAN' | 'PURCHASE_REQUISITION' | 'SHIPMENT_REQUEST' | 'MILL_SHEET';
  kindLabel: string;    // 수주 · LOT · 생산계획 · 구매요청 · 출하요청 · 밀시트
  label: string;        // 찾은 번호
  linkPath: string;     // 프론트 경로
}[];
```

| kind | 찾는 번호 | linkPath |
|---|---|---|
| `SALES_ORDER` | 수주번호 | `/sales-orders/:id` |
| `LOT` | LOT 번호 (원료·용선·히트·슬래브·코일) | `/lots/trace?lot=:lotNo` (URL 인코딩) |
| `PRODUCTION_PLAN` | 생산계획번호 | `/production/plans?plan=:id` |
| `PURCHASE_REQUISITION` | 구매요청번호 | `/purchase-requisitions/:id` |
| `SHIPMENT_REQUEST` | 출하요청번호 | `/shipment-requests/:id` |
| `MILL_SHEET` | 밀시트번호 | `/mill-sheets?id=:id` |

`GET /search?q=TSTDOC` (시험 데이터, 10건으로 잘림):
```json
[ { "kind": "SALES_ORDER", "kindLabel": "수주", "label": "SO-TSTDOC-2", "linkPath": "/sales-orders/72" },
  { "kind": "LOT", "kindLabel": "LOT", "label": "TSTDOC-HT-03", "linkPath": "/lots/trace?lot=TSTDOC-HT-03" },
  { "kind": "PRODUCTION_PLAN", "kindLabel": "생산계획", "label": "PP-TSTDOC", "linkPath": "/production/plans?plan=13" },
  { "kind": "PURCHASE_REQUISITION", "kindLabel": "구매요청", "label": "PR-TSTDOC", "linkPath": "/purchase-requisitions/13" },
  { "kind": "SHIPMENT_REQUEST", "kindLabel": "출하요청", "label": "SHP-TSTDOC", "linkPath": "/shipment-requests/18" },
  { "kind": "MILL_SHEET", "kindLabel": "밀시트", "label": "MS-TSTDOC", "linkPath": "/mill-sheets?id=18" },
  { "kind": "SALES_ORDER", "kindLabel": "수주", "label": "SO-TSTDOC", "linkPath": "/sales-orders/71" },
  { "kind": "LOT", "kindLabel": "LOT", "label": "TSTDOC-HT-02", "linkPath": "/lots/trace?lot=TSTDOC-HT-02" },
  { "kind": "LOT", "kindLabel": "LOT", "label": "TSTDOC-HT-01", "linkPath": "/lots/trace?lot=TSTDOC-HT-01" },
  { "kind": "LOT", "kindLabel": "LOT", "label": "TSTDOC-HT", "linkPath": "/lots/trace?lot=TSTDOC-HT" } ]
```
정확 일치 — `GET /search?q=so-tstdoc-2` → `[ { "kind": "SALES_ORDER", "kindLabel": "수주", "label": "SO-TSTDOC-2", "linkPath": "/sales-orders/72" } ]`.

## 오류 요약

| 상황 | 응답 |
|---|---|
| 없는 `widgetCode` | `404 COM-004` `위젯을(를) 찾을 수 없습니다` |
| `days`·`limit` 범위 오류 | `400 COM-003` (예: `days는 1 이상이어야 합니다`) |
| 배치 검증 실패 | `400 COM-003` (위 표) |
| 토큰 없음 | `401 AUTH-002` |
