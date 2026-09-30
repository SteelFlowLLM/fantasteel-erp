# 작업 로그 조회 API (`modules/business-event`)

REQ-LOG-001~003, BP-LOG-01 (수주·LOT 시간순 타임라인, Decision Replay). 기준 URL `/api/v1`, 응답 `{ success: true, data }`.
**로그인한 사원은 모두 조회할 수 있다.** 이 API는 조회 전용이다 — 이벤트는 각 업무 모듈이 `BusinessEventRecorder.record(tx, …)` 로 본 거래와 같은 트랜잭션에서 남긴다 (기록기는 이 모듈이 전역으로 제공, 수정 없음).

Decimal·Date 표기는 전역 규칙 (Date = ISO 8601). `before`/`after` 는 기록 당시의 JSON 그대로다.

| 메서드·경로 | 설명 |
|---|---|
| `GET /business-events` | 이벤트 목록·타임라인 |
| `GET /business-events/:id` | 이벤트 1건 |

## `GET /business-events`

쿼리 (모두 선택, 조합하면 AND):

| 이름 | 타입 | 설명 |
|---|---|---|
| `salesOrderId` | int | 그 수주의 이벤트 (`sales_order_id`) |
| `lotId` | int | 이벤트의 `lot_ids`에 그 LOT이 들어 있는 것 |
| `includeLineage` | `true\|false` | `lotId`와 함께: 그 LOT의 **조상·자손** LOT의 이벤트도 포함. 형제 LOT은 포함하지 않는다. `lotId` 없이 주면 무시 |
| `eventType` | `BusinessEventType` | 이벤트 유형 (예: `AUTO_RESERVED`) |
| `actorType` | `USER\|SYSTEM` | 주체 |
| `targetType` | `EventTargetType` | 대상 종류 (예: `LOT`, `SALES_ORDER`) |
| `from`, `to` | ISO 8601 또는 `YYYY-MM-DD` | 발생 시각 범위 (양 끝 포함). 날짜만 주면 **한국 시간** 기준 — `from=2026-09-30` 은 그날 00:00 KST부터, `to=2026-09-30` 은 그날 23:59:59.999 KST까지 |
| `q` | string(≤100) | `summary` 또는 `targetNo`에 포함된 글자 (대소문자 무시) |
| `limit` | 1~500 | 기본 50 |
| `cursor` | int | 이전 응답의 `nextCursor` |
| `order` | `asc\|desc` | 생략하면 **`salesOrderId` 또는 `lotId`가 있으면 `asc`(시간순 타임라인), 없으면 `desc`(최근순)** |

정렬은 항상 `occurred_at` → `id` (같은 시각이면 id 순; `desc`면 반대). 페이지 나누기는 커서 방식이다: 응답의 `nextCursor`를 같은 조건 그대로 다음 요청의 `cursor`로 보낸다. `hasMore`가 `false`면 `nextCursor`는 `null`.

```ts
interface BusinessEventListResponse {
  items: BusinessEventView[];
  nextCursor: number | null;
  hasMore: boolean;
  order: 'asc' | 'desc';       // 실제로 적용된 정렬
}

interface BusinessEventView {
  id: number;
  occurredAt: string;
  actorType: 'USER' | 'SYSTEM';
  actorLabel: string;          // 사용자면 사원 이름, 시스템이면 "시스템"
  actor: { employeeId: number; employeeNo: string; employeeName: string; departmentName: string; jobGrade: string } | null;   // SYSTEM이면 null
  eventType: BusinessEventType;
  eventTypeLabel: string;      // BUSINESS_EVENT_TYPE_LABEL (예: "자동 예약", "배정 확정")
  targetType: EventTargetType;
  targetId: number | null;
  targetNo: string | null;     // 화면 표시용 번호
  salesOrderId: number | null;
  salesOrderNo: string | null;
  lotIds: number[];
  lots: { id: number; lotNo: string; lotType: LotType }[];   // lotIds를 번호로 풀어 둔 것
  summary: string;             // 사실을 한 줄로
  before: unknown | null;      // 변경 전 데이터 (JSON)
  after: unknown | null;       // 변경 후 데이터 (JSON)
  reasonCode: EventReasonCode | null;   // STOCK_FIRST, FIFO_RECOMMENDATION, QUALITY_PASSED …
  reason: string | null;       // 사람이 읽을 사유
  isAiAssisted: boolean;       // AI 초안으로 확정한 작업 (P2)
  messageId: number | null;    // 원본 메시지 (Message → ERP)
  actionDraftId: number | null;
  isLineageOnly: boolean;      // lotId + includeLineage 조회에서, 요청한 LOT이 아니라 조상·자손 LOT의 이벤트이면 true. 그 밖의 조회는 항상 false
}
```

### 실제 응답

수주 타임라인 — `GET /business-events?salesOrderId=71&limit=2` (시간순, 다음 페이지 있음):

```json
{
  "items": [
    { "id": 42, "occurredAt": "2026-09-30T02:23:43.975Z", "actorType": "USER", "actorLabel": "김영업",
      "actor": { "employeeId": 3, "employeeNo": "2104012", "employeeName": "김영업", "departmentName": "영업부", "jobGrade": "대리" },
      "eventType": "SALES_ORDER_REGISTERED", "eventTypeLabel": "수주 등록", "targetType": "SALES_ORDER", "targetId": null, "targetNo": "SO-TSTDOC",
      "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "lotIds": [], "lots": [], "summary": "수주 SO-TSTDOC 등록",
      "before": null, "after": null, "reasonCode": null, "reason": null, "isAiAssisted": false, "messageId": null, "actionDraftId": null, "isLineageOnly": false },
    { "id": 43, "…": "(같은 모양) eventType RESERVATION_CREATED, summary \"합격 재고 1매 예약\"" }
  ],
  "nextCursor": 43,
  "hasMore": true,
  "order": "asc"
}
```

다음 페이지 — `GET /business-events?salesOrderId=71&limit=2&cursor=43` → 이어서 `id 45, 46` (`nextCursor: 46`).

LOT 타임라인 항목 예 (`GET /business-events?lotId=401`, LOT 2개에 걸친 검사 이벤트):

```json
{
  "id": 44, "occurredAt": "2026-09-30T04:23:43.975Z", "actorType": "USER", "actorLabel": "정품질",
  "actor": { "employeeId": 14, "employeeNo": "1911030", "employeeName": "정품질", "departmentName": "품질부", "jobGrade": "과장" },
  "eventType": "INSPECTION_REGISTERED", "eventTypeLabel": "검사", "targetType": "QUALITY_INSPECTION", "targetId": null, "targetNo": "TSTDOC-HT-02",
  "salesOrderId": null, "salesOrderNo": null, "lotIds": [401, 399],
  "lots": [ { "id": 401, "lotNo": "TSTDOC-HT-02", "lotType": "SLAB" }, { "id": 399, "lotNo": "TSTDOC-HT", "lotType": "HEAT" } ],
  "summary": "TSTDOC-HT-02 슬래브 검사 합격", "before": null, "after": null, "reasonCode": null, "reason": null,
  "isAiAssisted": false, "messageId": null, "actionDraftId": null, "isLineageOnly": false
}
```

`before`/`after`/`reasonCode` 가 있는 항목 (`GET /business-events/43`):

```json
{
  "id": 43, "occurredAt": "2026-09-30T03:23:43.975Z", "actorType": "USER", "actorLabel": "김영업",
  "actor": { "employeeId": 3, "employeeNo": "2104012", "employeeName": "김영업", "departmentName": "영업부", "jobGrade": "대리" },
  "eventType": "RESERVATION_CREATED", "eventTypeLabel": "예약", "targetType": "RESERVATION", "targetId": null, "targetNo": "SO-TSTDOC",
  "salesOrderId": 71, "salesOrderNo": "SO-TSTDOC", "lotIds": [], "lots": [], "summary": "합격 재고 1매 예약",
  "before": { "onHandQty": 6, "reservedQty": 0 }, "after": { "onHandQty": 6, "reservedQty": 1 },
  "reasonCode": "STOCK_FIRST", "reason": null, "isAiAssisted": false, "messageId": null, "actionDraftId": null, "isLineageOnly": false
}
```

상·하위 LOT 포함 — `GET /business-events?lotId=400&includeLineage=true` (슬래브 400의 조상 히트 399·용선 398 이벤트도 `isLineageOnly: true` 로 함께 나온다):

```json
[ { "id": 44, "eventType": "INSPECTION_REGISTERED",   "lotIds": [401, 399], "isLineageOnly": true },
  { "id": 47, "eventType": "GOODS_ISSUE_CONFIRMED",   "lotIds": [401, 402], "isLineageOnly": true },
  { "id": 48, "eventType": "WORK_COMPLETED",          "lotIds": [399, 398], "isLineageOnly": true } ]
```
(요약을 위해 `id`·`eventType`·`lotIds`·`isLineageOnly`만 뽑았다. 실제 항목은 위 `BusinessEventView` 전체 모양.)
슬래브 400 자신의 이벤트가 있으면 `isLineageOnly: false` 로 함께 시간순에 섞여 나온다.

## `GET /business-events/:id`

`BusinessEventView` 1건 (위 `id 43` 예). 없으면 `404 COM-004`, id가 숫자가 아니면 `400 COM-003`.

## 오류

| 상황 | 응답 |
|---|---|
| 값 형식 오류 (`actorType=ROBOT`, `from=yesterday`, `limit=501` …) | `400 COM-003` 한국어 메시지 (예: `actorType은 USER 또는 SYSTEM이어야 합니다`) |
| 없는 이벤트 | `404 COM-004` `작업 로그을(를) 찾을 수 없습니다` |
| 토큰 없음 | `401 AUTH-002` |

## 프론트 사용 메모

- 수주 상세의 "이력" 탭: `?salesOrderId=:id` (asc). 프론트 경로 `/business-events?salesOrderId=:id`.
- LOT 추적 화면의 타임라인: `?lotId=:id`, "상·하위 LOT 포함" 토글 = `includeLineage=true` (`isLineageOnly` 항목은 흐리게 표시하는 식으로 구분).
- 최근 목록·필터(유형·주체·기간·검색어)는 `order` 생략(desc) + `cursor` 로 더 불러오기.
- `lotIds`가 아주 많은 이벤트(예: 히트의 슬래브 전체)는 `lots` 배열이 길 수 있다.
