# mrp API

MRP 계산 (REQ-PRD-005, 업무 프로세스 정의서 4.4, BP-PRD-01). 모든 경로는 `/api/v1` 아래, 로그인 필요.
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8805, DB `fs_pur`)에 curl로 호출한 응답에서 옮겼다. 톤은 문자열(소수 3자리), 날짜는 `"2026-10-20T00:00:00.000Z"` 모양(앞 10자리만 쓴다).

## 권한

| API | 필요한 권한 |
|---|---|
| `POST /mrp-runs` | `PURCHASE_REQUISITION_CREATE` 또는 `PLAN_CONFIRM` USE (구매·생산) |
| `GET /mrp-runs`, `GET /mrp-runs/latest`, `GET /mrp-runs/:id` | 위 둘 중 하나 VIEW 이상 (구매·생산·영업·품질·관리자) |

## 계산 규칙

진행 중인 생산계획(`PLANNED`·`CONFIRMED`·`IN_PROGRESS`) **전체**를 한 번에 계산한다.

```text
계획별 남은 히트 수
  PLANNED            = 히트 편성 계산(부족 매수 − 여재 사용 매수)의 히트 수
  CONFIRMED·IN_PROGRESS = 편성한 히트 수 − 이미 만든 히트 LOT 수
히트 톤            = 남은 히트 수 × 히트 용량(250t)
필요 용선          = Σ(히트 톤 ÷ 제강 수율)                     requiredHotMetalTon   예) 250 ÷ 0.95 = 263.158
만들어야 할 용선   = max(0, 필요 용선 − 용선 LOT 잔량)          hotMetalTon
철광석·석탄·석회석 = 만들어야 할 용선 × 원단위(t/t)             예) 263.158 × 1.6 = 421.053
합금철             = 강종별 히트 톤 × 원단위(kg/t) ÷ 1,000      예) 250 × 6 ÷ 1000 = 1.500
순소요             = max(0, 총소요 − 원료 LOT 잔량 − 입고예정)
입고예정           = 확정 발주(CONFIRMED·PARTIALLY_RECEIVED) 품목의 orderedTon − receivedTon 합
필요일             = 그 원료를 쓰는 계획에 연결된 수주 납기 중 가장 이른 날
```

- 재고·입고예정은 계획별이 아니라 **합계에서 한 번만** 뺀다 (같은 공급을 계획마다 중복 차감하지 않는다).
- 제강 수율은 용선 환산에 한 번만 쓴다. 합금철은 히트 톤 기준이라 수율을 다시 적용하지 않는다.
- MRP는 구매요청을 만들지 않는다 (자동 초안은 P2). 화면에서 결과를 보고 `POST /purchase-requisitions`에 `sourceType: 'MRP'`로 등록한다.
- 실행할 때마다 `mrp_run`·`mrp_requirement`에 저장하고 작업 로그 `MRP_RUN`을 남긴다.

## 타입

```ts
/** POST /mrp-runs, GET /mrp-runs/latest(없으면 null), GET /mrp-runs/:id */
interface MrpRunDetail {
  id: number;
  mrpRunNo: string;                   // 'MRP-20260930-0007'
  createdAt: string;                  // 실행 시각
  runEmployee: { id: number; employeeNo: string; employeeName: string } | null;
  heatCount: number;                  // 아직 만들지 않은 히트 수 합계
  heatTon: string;                    // 그 히트 톤 합계
  requiredHotMetalTon: string | null; // 필요 용선 (용선 재고 차감 전)
  hotMetalRemainingTon: string | null;// 실행 시점의 용선 LOT 잔량 합계
  hotMetalTon: string;                // 새로 만들어야 하는 용선. 원료 소요의 기준
  /** 실행 시점에 소요를 만든 생산계획 (남은 히트가 있는 것만) */
  plans: {
    productionPlanId: number;
    productionPlanNo: string;
    productionPlanStatus: string;     // PRODUCTION_PLAN_STATUS
    steelGradeId: number;
    steelGradeCode: string;           // 'SS275'
    specCode: string;                 // 'SL-SS275-250x1200x10000'
    itemType: 'SLAB' | 'COIL';
    salesOrderId: number | null;      // 수주가 취소돼 연결이 끊긴 계획은 null
    salesOrderNo: string | null;
    dueDate: string | null;           // 수주 납기
    heatCount: number;                // 이 계획의 남은 히트 수
    heatTon: string;
    hotMetalTon: string;              // 이 계획의 필요 용선
  }[];
  requirements: MrpRequirementView[]; // 원료별 (rawMaterial.id 오름차순)
}

interface MrpRequirementView {
  id: number;
  rawMaterial: { id: number; materialCode: string; rawMaterialType: string; itemName: string };
  requiredTon: string;                // 총소요
  remainingTon: string;               // 실행 시점의 원료 LOT 잔량 합계
  scheduledReceiptTon: string;        // 실행 시점의 입고예정
  netRequiredTon: string;             // 순소요
  requiredDate: string | null;        // 필요일
  /** 이 원료의 소요에 기여한 생산계획. requiredTon은 용선 재고를 빼기 전 그 계획의 몫 */
  contributions: {
    productionPlanId: number;
    productionPlanNo: string;
    salesOrderNo: string | null;
    dueDate: string | null;
    heatCount: number;
    requiredTon: string;
  }[];
  /**
   * "지금" 이 원료를 덮고 있는 구매요청·발주. 조회할 때마다 다시 계산한다 (저장값 아님).
   * MRP 뒤에 구매요청을 올렸으면 같은 실행을 다시 조회했을 때 덮인 것으로 나온다 → 중복 요청 방지에 쓴다.
   */
  coverage: {
    openRequisitionTon: string;       // 아직 발주로 넘어가지 않은 구매요청 수량 합 (DRAFT·WAITING_APPROVAL·APPROVED의 미발주분)
    openRequisitions: { purchaseRequisitionId: number; purchaseRequisitionNo: string; purchaseRequisitionStatus: string; unorderedTon: string }[];
    openPurchaseOrders: { purchaseOrderId: number; purchaseOrderNo: string; dueDate: string | null; outstandingTon: string }[];   // 미입고가 남은 발주
    orderedAfterRunTon: string;       // 이 실행 뒤에 확정된 발주 수량 합
    uncoveredTon: string;             // max(0, netRequiredTon − openRequisitionTon − orderedAfterRunTon) → 새로 요청할 양
    isCovered: boolean;               // uncoveredTon == 0
  };
}

/** GET /mrp-runs 의 원소 (최신순, 최대 50건) */
interface MrpRunListItem {
  id: number;
  mrpRunNo: string;
  createdAt: string;
  runEmployee: { id: number; employeeNo: string; employeeName: string } | null;
  heatCount: number;
  heatTon: string;
  hotMetalTon: string;
  shortageCount: number;              // 순소요 > 0 인 원료 수
  totalNetRequiredTon: string;        // 순소요 합계
}
```

## 엔드포인트

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /mrp-runs` | 본문 없음 | `201 MrpRunDetail` |
| `GET /mrp-runs` | — | `MrpRunListItem[]` |
| `GET /mrp-runs/latest` | — | `MrpRunDetail \| null` (실행한 적이 없으면 `data: null`) |
| `GET /mrp-runs/:id` | — | `MrpRunDetail` (없으면 `404 COM-004`) |

`requirements`에는 배합 원단위가 등록된 원료만 나온다. 진행 중인 계획이 없으면 철광석·석탄·석회석이 총소요 `0.000`으로 나오고 합금철 행은 없다.
수율·원단위·규격 매핑 등 기준정보가 빠져 있으면 `400 MST-001`.

## 예시

```jsonc
// POST /mrp-runs (서구매) — SS275 슬래브 10매 수주, 재고 6매 예약, 부족 4매 생산계획(PLANNED) 1건이 있을 때
{ "success": true, "data": {
  "id": 7, "mrpRunNo": "MRP-20260930-0007", "createdAt": "2026-09-30T11:30:07.031Z",
  "runEmployee": { "id": 6, "employeeNo": "1907015", "employeeName": "서구매" },
  "heatCount": 1, "heatTon": "250.000", "requiredHotMetalTon": "263.158", "hotMetalRemainingTon": "0.000", "hotMetalTon": "263.158",
  "plans": [ { "productionPlanId": 46, "productionPlanNo": "PP-20260930-0001", "productionPlanStatus": "PLANNED", "steelGradeId": 1, "steelGradeCode": "SS275",
    "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "salesOrderId": 46, "salesOrderNo": "SO-20260930-0001", "dueDate": "2026-10-20T00:00:00.000Z",
    "heatCount": 1, "heatTon": "250.000", "hotMetalTon": "263.158" } ],
  "requirements": [
    { "id": 29, "rawMaterial": { "id": 1, "materialCode": "IO", "rawMaterialType": "IRON_ORE", "itemName": "철광석" },
      "requiredTon": "421.053", "remainingTon": "1050.000", "scheduledReceiptTon": "0.000", "netRequiredTon": "0.000", "requiredDate": "2026-10-20T00:00:00.000Z",
      "contributions": [ { "productionPlanId": 46, "productionPlanNo": "PP-20260930-0001", "salesOrderNo": "SO-20260930-0001", "dueDate": "2026-10-20T00:00:00.000Z", "heatCount": 1, "requiredTon": "421.053" } ],
      "coverage": { "openRequisitionTon": "0.000", "openRequisitions": [], "openPurchaseOrders": [], "orderedAfterRunTon": "0.000", "uncoveredTon": "0.000", "isCovered": true } },
    { "id": 31, "rawMaterial": { "id": 3, "materialCode": "LS", "rawMaterialType": "LIMESTONE", "itemName": "석회석" },
      "requiredTon": "65.790", "remainingTon": "150.000", "scheduledReceiptTon": "40.000", "netRequiredTon": "0.000", "requiredDate": "2026-10-20T00:00:00.000Z",
      "contributions": [ /* … */ ],
      "coverage": { "openRequisitionTon": "0.000", "openRequisitions": [],
        "openPurchaseOrders": [ { "purchaseOrderId": 46, "purchaseOrderNo": "PO-20260930-0026", "dueDate": "2026-10-10T00:00:00.000Z", "outstandingTon": "40.000" } ],
        "orderedAfterRunTon": "0.000", "uncoveredTon": "0.000", "isCovered": true } },
    { "id": 32, "rawMaterial": { "id": 4, "materialCode": "FM", "rawMaterialType": "FERROALLOY", "itemName": "합금철 FeMn" },
      "requiredTon": "1.500", "remainingTon": "2.000", "scheduledReceiptTon": "0.000", "netRequiredTon": "0.000", "requiredDate": "2026-10-20T00:00:00.000Z",
      "contributions": [ { "productionPlanId": 46, "productionPlanNo": "PP-20260930-0001", "salesOrderNo": "SO-20260930-0001", "dueDate": "2026-10-20T00:00:00.000Z", "heatCount": 1, "requiredTon": "1.500" } ],
      "coverage": { "openRequisitionTon": "3.000",
        "openRequisitions": [ { "purchaseRequisitionId": 88, "purchaseRequisitionNo": "PR-20260930-0076", "purchaseRequisitionStatus": "APPROVED", "unorderedTon": "3.000" } ],
        "openPurchaseOrders": [], "orderedAfterRunTon": "0.000", "uncoveredTon": "0.000", "isCovered": true } }
    /* 석탄(CL) 197.369, FeSi(FS) 0.625 생략 */ ] } }

// 부족이 있을 때의 원료 행 (철광석 재고 250t, 입고예정 20t)
{ "requiredTon": "421.053", "remainingTon": "250.000", "scheduledReceiptTon": "20.000", "netRequiredTon": "151.053",
  "coverage": { "openRequisitionTon": "0.000", "openRequisitions": [], "openPurchaseOrders": [], "orderedAfterRunTon": "0.000", "uncoveredTon": "151.053", "isCovered": false } }

// GET /mrp-runs 의 원소
{ "id": 8, "mrpRunNo": "MRP-20260930-0008", "createdAt": "2026-09-30T11:30:41.539Z", "runEmployee": { "id": 88, "employeeNo": "…", "employeeName": "…" },
  "heatCount": 1, "heatTon": "250.000", "hotMetalTon": "263.158", "shortageCount": 5, "totalNetRequiredTon": "416.337" }
```

## 화면에서 쓰는 법

1. `GET /mrp-runs/latest`로 마지막 결과를 보여 주고, "MRP 실행" 버튼은 `POST /mrp-runs`.
2. 원료 행에서 `netRequiredTon > 0`이면 부족. `coverage.isCovered`가 `false`일 때만 "구매요청 등록"을 권하고 기본 수량은 `coverage.uncoveredTon`, 희망 입고일은 `requiredDate` 이전으로 제안한다.
3. `coverage.openRequisitions`·`openPurchaseOrders`를 같이 보여 주면 이미 진행 중인 요청·발주가 보인다.

실시간 주제: `mrp-runs` (MRP 실행, 발주 확정, 입고 확정 때 온다 → `latest`를 다시 불러온다).
