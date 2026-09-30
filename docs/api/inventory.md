# inventory API

재고 조회(제품 매수·원료 톤) · 여재 · 배정 추천/확정/해제 (REQ-INV-001·006~009, BP-INV-01·02).
모든 경로는 `/api/v1` 아래, 로그인 필요(`Authorization: Bearer …`).
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }`.
아래 타입과 예시는 실제 서버(포트 8803, DB `fs_sales`)에 curl로 호출한 응답에서 옮겼다.

- 제품은 **매수**(정수), 톤(`…Ton`)은 `매수 × 1매 이론중량` 계산값 **문자열**(소수 3자리). 원료는 톤 문자열.
- 시각은 ISO 8601 문자열.
- 예약(매수, LOT을 정하지 않음)과 배정(실제 LOT)은 다른 것이다. 예약은 수주 등록·검사 합격 때 생기고, 배정은 이 API로 확정한다.

## 권한 요약

| API | 필요한 권한 |
|---|---|
| `GET /inventories`, `GET /inventories/surplus` | 로그인만 (수주 입력·생산·구매·출하 화면이 모두 본다) |
| `POST /allocations/recommend`, `POST /allocations`, `POST /allocations/:id/release` | `purpose = SHIPMENT` → `SHIPMENT_REQUEST` USE (영업) / `purpose = ROLLING` → `ROLLING_ALLOCATE` USE (생산) |

배정 API는 둘 중 하나의 USE 권한이 있어야 들어올 수 있고, 목적에 맞는 권한인지는 본문(`purpose`)을 보고 다시 확인한다. 맞지 않으면 403 `COM-002`.

---

## 1. `GET /inventories` — 재고

```ts
// 쿼리 (모두 선택)
interface ListInventoriesQuery {
  itemType?: 'SLAB' | 'COIL' | 'RAW_MATERIAL';   // SLAB·COIL이면 products만, RAW_MATERIAL이면 rawMaterials만
  steelGrade?: string;                            // 강종 코드 'SS275' (제품에만 적용 → rawMaterials는 빈 배열)
  productSpecId?: number;                         // (제품에만 적용 → rawMaterials는 빈 배열)
}
// 응답 200
interface InventoryListView {
  products: ProductInventoryView[];      // 제품 규격마다 1행 (재고가 0이어도 나온다), 규격 id 순
  rawMaterials: RawMaterialInventoryView[];
}
interface ProductInventoryView {
  productSpecId: number;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  qtyUnit: string;                // '매' | '개'
  steelGradeId: number;
  steelGradeCode: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  theoreticalWeightTon: string;
  yardName: string | null;
  onHandQty: number;              // 합격·미소진 매수 (재고 풀. 여재 포함, 열연 투입용 귀속 슬래브 제외)
  reservedQty: number;            // ACTIVE 예약 매수 합계
  availableQty: number;           // 가용재고 = onHandQty − reservedQty (새로 예약할 수 있는 매수)
  pendingInspectionQty: number;   // 검사 대기: 자기 검사 또는 상위 히트 성분 검사 전인 미소진 LOT 수
  failedQty: number;              // 불합격: 자기 검사 불합격 또는 상위 히트 불합격인 미소진 LOT 수
  earmarkedQty: number;           // 열연 투입용으로 코일 수주에 귀속된 합격 슬래브 수 (재고 풀 밖)
  onHandTon: string;
  reservedTon: string;
  availableTon: string;
}
interface RawMaterialInventoryView {
  rawMaterialId: number;
  materialCode: string;           // 'IO' | 'CL' | 'LS' | 'FM' | 'FS'
  itemCode: string;
  itemName: string;
  rawMaterialType: string;        // RAW_MATERIAL_TYPE
  yardName: string | null;
  onHandTon: string;              // 원료 LOT 잔량 합계
  scheduledReceiptTon: string;    // 입고예정 = 확정 발주(CONFIRMED·PARTIALLY_RECEIVED)의 (발주량 − 입고 누계) 합계
}
```

```bash
curl ':8803/api/v1/inventories?steelGrade=SS275' -H 'Authorization: Bearer …'
```

```json
{ "success": true, "data": { "products": [ {
    "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000", "itemType": "SLAB", "qtyUnit": "매",
    "steelGradeId": 1, "steelGradeCode": "SS275", "thicknessMm": "250", "widthMm": "1200", "lengthMm": "10000",
    "theoreticalWeightTon": "23.550", "yardName": "슬래브 야드",
    "onHandQty": 6, "reservedQty": 0, "availableQty": 6, "pendingInspectionQty": 0, "failedQty": 0, "earmarkedQty": 0,
    "onHandTon": "141.300", "reservedTon": "0.000", "availableTon": "141.300"
  } ], "rawMaterials": [] } }
```

```json
// GET /inventories?itemType=RAW_MATERIAL
{ "products": [], "rawMaterials": [
  { "rawMaterialId": 1, "materialCode": "IO", "itemCode": "RM-IO", "itemName": "철광석", "rawMaterialType": "IRON_ORE",
    "yardName": "원료 야드", "onHandTon": "900.000", "scheduledReceiptTon": "0.000" } ] }
```

## 2. `GET /inventories/surplus` — 여재 (REQ-INV-008)

여재 = 합격(자기 검사 + 상위 히트)·미소진·수주에 묶이지 않음·확정 배정 없는 **슬래브**. 컬럼 없이 계산한다.

```ts
// 쿼리 (모두 선택)
interface ListSurplusQuery { steelGrade?: string; productSpecId?: number }
// 응답 200
interface SurplusView {
  lots: {                         // 생산완료일 → LOT 번호 순 (FIFO 순)
    lotId: number;
    lotNo: string;
    productSpecId: number;
    specCode: string;
    steelGradeCode: string;
    heatNo: string | null;
    producedAt: string;
    ageDays: number;              // 생산완료 뒤 지난 일수 (버림)
    theoreticalWeightTon: string;
    yardName: string | null;
    productionPlanId: number | null;
  }[];
  specs: {                        // 규격별 합계
    productSpecId: number;
    specCode: string;
    steelGradeCode: string;
    surplusQty: number;
    surplusTon: string;
    reservedQty: number;          // 같은 규격 재고 풀의 ACTIVE 예약 매수
    availableQty: number;         // 가용재고
  }[];
}
```

예약은 LOT을 정하지 않으므로, 여재 LOT 수(`surplusQty`)가 `availableQty`보다 많을 수 있다 — 그 차이만큼은 이미 어떤 수주에 예약돼 있다는 뜻이다. 화면에는 LOT 목록과 규격별 예약·가용 매수를 함께 보여 준다.

```json
{ "lots": [ { "lotId": 33, "lotNo": "HT-2-260922-001-06", "productSpecId": 9, "specCode": "SL-SM355-250x1500x10000", "steelGradeCode": "SM355",
    "heatNo": "HT-2-260922-001", "producedAt": "2026-09-22T04:06:00.000Z", "ageDays": 8, "theoreticalWeightTon": "29.438",
    "yardName": "슬래브 야드", "productionPlanId": null } ],
  "specs": [ { "productSpecId": 9, "specCode": "SL-SM355-250x1500x10000", "steelGradeCode": "SM355",
    "surplusQty": 3, "surplusTon": "88.314", "reservedQty": 2, "availableQty": 1 } ] }
```

---

## 배정 공통 타입

```ts
type AllocationPurpose = 'SHIPMENT' | 'ROLLING';
type AllocationStatus = 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
type ShipmentRequestItemStatus = 'WAITING_ALLOCATION' | 'ALLOCATED' | 'ISSUED';
type ShipmentRequestStatus = 'REQUESTED' | 'ALLOCATED' | 'PARTIALLY_ISSUED' | 'ISSUED' | 'CANCELLED';

// 배정 대상: 목적에 따라 하나만 쓴다
interface AllocationTarget {
  purpose: AllocationPurpose;
  shipmentRequestItemId?: number;   // purpose = 'SHIPMENT' 일 때 필수 (출하요청 품목)
  productionPlanId?: number;        // purpose = 'ROLLING' 일 때 필수 (코일 수주 품목에 연결된 생산계획)
}
interface AllocationLotView {
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;               // 생산완료일 (FIFO 기준)
  yardName: string | null;
  isEarmarked: boolean;             // 열연 배정에서만 true일 수 있다: 이 코일 수주 품목에 이미 귀속된 슬래브
}
interface ConfirmedAllocationView {
  id: number;                       // allocationId (해제·변경에 쓴다)
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}
```

**필요 매수**
- 출하: 출하요청 품목의 `requestQty` − 이미 확정된 배정 수.
- 열연: 그 코일 수주 품목이 지금 투입해야 할 슬래브 매수 = 미확보 코일 매수 − 검사 대기 코일 − 이미 확정 배정된 슬래브
  (= `StockService.rollingNeedQty` + 귀속됐지만 아직 배정 전인 슬래브). 배정할 LOT의 규격은 코일 규격에 매핑된 슬래브 규격이다.

**추천 대상**
- 출하: 그 규격의 적격(자기 검사 + 상위 히트 합격·미소진)·미배정 LOT. 열연 투입용 귀속 슬래브는 빠진다.
- 열연: 그 코일 수주 품목에 귀속된 슬래브 먼저, 모자라면 재고 풀의 여재 — 단 슬래브 판매 예약을 침범하지 않게 **가용 매수(`onHandQty − reservedQty`)까지만**.
- 순서는 생산완료일 오름차순, 같으면 LOT 번호 순 (FIFO).

## 3. `POST /allocations/recommend` — FIFO 추천 (아무것도 저장하지 않음)

```ts
// 요청: AllocationTarget
// 응답 200
interface AllocationRecommendationView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  salesOrderItemId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;            // 배정할 LOT의 규격 (출하: 수주 품목 규격, 열연: 대응 슬래브 규격)
  specCode: string;
  requiredQty: number;              // 필요한 전체 매수 = confirmedQty + neededQty
  confirmedQty: number;             // 이미 확정된 배정 수
  neededQty: number;                // 아직 배정해야 할 매수
  recommendedLots: AllocationLotView[];   // FIFO 추천, neededQty만큼 (모자라면 그보다 적다)
  shortageQty: number;              // 추천으로 못 채우는 매수 = neededQty − recommendedLots.length
  candidateLots: AllocationLotView[];     // 고를 수 있는 모든 LOT (FIFO 순, 최대 200). 추천과 다르게 고를 때 쓴다
  confirmedAllocations: ConfirmedAllocationView[];   // 현재 확정돼 있는 배정
}
```

```bash
curl -X POST :8803/api/v1/allocations/recommend -H 'Authorization: Bearer …' -H 'Content-Type: application/json' \
  -d '{"purpose":"SHIPMENT","shipmentRequestItemId":44}'
```

```json
{ "purpose": "SHIPMENT", "shipmentRequestItemId": 44, "shipmentRequestId": 43, "productionPlanId": null,
  "salesOrderItemId": 146, "salesOrderNo": "SO-20260930-0141", "salesOrderLineNo": 1,
  "productSpecId": 1, "specCode": "SL-SS275-250x1200x10000",
  "requiredQty": 2, "confirmedQty": 0, "neededQty": 2,
  "recommendedLots": [
    { "lotId": 16, "lotNo": "HT-1-260921-001-05", "lotType": "SLAB", "heatNo": "HT-1-260921-001", "producedAt": "2026-09-21T04:05:00.000Z", "yardName": "슬래브 야드", "isEarmarked": false },
    { "lotId": 17, "lotNo": "HT-1-260921-001-06", "lotType": "SLAB", "heatNo": "HT-1-260921-001", "producedAt": "2026-09-21T04:06:00.000Z", "yardName": "슬래브 야드", "isEarmarked": false } ],
  "shortageQty": 0,
  "candidateLots": [ "… 같은 모양, 6건 (…-05 ~ …-10)" ],
  "confirmedAllocations": [] }
```

```json
// 열연: {"purpose":"ROLLING","productionPlanId":70} → 슬래브 규격으로 추천
{ "purpose": "ROLLING", "shipmentRequestItemId": null, "shipmentRequestId": null, "productionPlanId": 70,
  "salesOrderItemId": 147, "salesOrderNo": "SO-20260930-0142", "salesOrderLineNo": 1,
  "productSpecId": 9, "specCode": "SL-SM355-250x1500x10000", "requiredQty": 1, "confirmedQty": 0, "neededQty": 1,
  "recommendedLots": [ { "lotId": 32, "lotNo": "HT-2-260922-001-05", "lotType": "SLAB", "heatNo": "HT-2-260922-001", "producedAt": "2026-09-22T04:05:00.000Z", "yardName": "슬래브 야드", "isEarmarked": false } ],
  "shortageQty": 0, "candidateLots": [ "… 2건 (가용 매수만큼)" ], "confirmedAllocations": [] }
```

## 4. `POST /allocations` — 배정 확정 (변경 포함)

```ts
// 요청
interface ConfirmAllocationBody extends AllocationTarget {
  lotIds: number[];                 // 확정할 LOT (1개 이상, 중복 없이). neededQty보다 적게 나눠서 확정해도 된다
  releaseAllocationIds?: number[];  // 배정 변경: 같은 대상의 기존 확정 배정 중 먼저 해제할 id (해제와 새 확정이 한 트랜잭션)
  reason?: string;                  // 추천과 다르게 고르거나 바꾸는 사유 (500자 이하, 작업 로그에 남는다)
}
// 응답 201
interface AllocationConfirmView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  allocations: ConfirmedAllocationView[];   // 이번에 확정한 배정
  releasedAllocationIds: number[];
  recommendedLotNos: string[];      // 확정 시점의 FIFO 추천 LOT 번호 (작업 로그에도 남는다)
  isRecommendationFollowed: boolean;        // 추천(앞에서부터 고른 개수만큼)과 같은 LOT을 골랐는지
  neededQty: number;                // 확정 뒤 남은 배정 필요 매수
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;   // 출하 배정일 때만
  shipmentRequestStatus: ShipmentRequestStatus | null;
}
```

- LOT마다 잠근 뒤 다시 확인한다: 적격(자기 검사 + 상위 히트), 미소진, 다른 CONFIRMED 배정 없음, 규격 일치.
- 하나라도 실패하면 전부 되돌린다 (`releaseAllocationIds`의 해제 포함).
- 출하: 품목의 배정 수가 `requestQty`에 이르면 품목 `ALLOCATED`, 모든 품목이 `ALLOCATED`면 출하요청 `ALLOCATED` + 물류 역할에 "출고 대기" 알림(`/goods-issues?request=:id`).
- 열연: 재고 풀의 여재를 고르면 그 슬래브는 코일 수주 품목에 귀속되어 재고 풀(`onHandQty`)에서 1매 빠진다.
- 작업 로그: 요청 1번에 `ALLOCATION_CONFIRMED` 1건(사유 코드 `FIFO_RECOMMENDATION`, `afterData.recommendedLotNos`에 추천 내용). 추천과 다르게 골랐거나 `releaseAllocationIds`가 있으면 `ALLOCATION_CHANGED` 1건 더(사유 코드 `ALLOCATION_CHANGE`, `reason`).

| 상황 | HTTP | code | message 예 |
|---|---|---|---|
| 남은 필요 매수보다 많은 LOT | 400 | `INV-001` | 배정할 수 있는 매수(2)보다 많은 LOT을 골랐습니다 |
| 열연 배정이 판매 예약분을 침범 | 400 | `INV-001` | 다른 수주에 예약되어 열연에 투입할 수 있는 슬래브가 부족합니다 |
| 제품 또는 상위 히트 미합격 | 400 | `INV-002` | HT-…: 제품 또는 상위 히트가 미합격입니다 |
| 이미 배정된 LOT (판매·열연 중복 포함) | 400 | `INV-003` | HT-2-260922-001-05: 이미 배정된 LOT입니다 |
| 이미 투입·출고된 LOT | 400 | `INV-004` | HT-…: 이미 투입·출고된 LOT입니다 |
| 규격이 다른 LOT | 400 | `COM-003` | HT-…: 강종·규격이 일치하지 않는 LOT입니다 (필요 규격 …) |
| 출고 확정·취소된 출하요청, 완료·취소된 생산계획, 취소된 수주 품목 | 409 | `COM-005` | 출고 확정되었거나 취소된 출하요청은 배정을 바꿀 수 없습니다 |
| 코일 규격에 슬래브 매핑 없음 | 400 | `MST-001` | …: 대응 슬래브 규격(규격 매핑)이 없습니다 |
| 대상·LOT 없음 | 404 | `COM-004` | 출하요청 품목을(를) 찾을 수 없습니다 |
| `lotIds` 누락·빈 배열·중복 등 | 400 | `COM-003` | 배정할 LOT을 1개 이상 골라 주세요 (어긴 항목의 안내가 쉼표로 이어져 온다) |

```bash
curl -X POST :8803/api/v1/allocations -H 'Authorization: Bearer …' -H 'Content-Type: application/json' \
  -d '{"purpose":"SHIPMENT","shipmentRequestItemId":44,"lotIds":[16,17]}'
```

```json
{ "purpose": "SHIPMENT", "shipmentRequestItemId": 44, "shipmentRequestId": 43, "productionPlanId": null,
  "allocations": [
    { "id": 96, "lotId": 16, "lotNo": "HT-1-260921-001-05", "lotType": "SLAB", "heatNo": "HT-1-260921-001", "producedAt": "2026-09-21T04:05:00.000Z", "status": "CONFIRMED", "confirmedAt": "2026-09-30T11:30:52.268Z" },
    { "id": 97, "lotId": 17, "lotNo": "HT-1-260921-001-06", "lotType": "SLAB", "heatNo": "HT-1-260921-001", "producedAt": "2026-09-21T04:06:00.000Z", "status": "CONFIRMED", "confirmedAt": "2026-09-30T11:30:52.270Z" } ],
  "releasedAllocationIds": [], "recommendedLotNos": ["HT-1-260921-001-05", "HT-1-260921-001-06"],
  "isRecommendationFollowed": true, "neededQty": 0,
  "shipmentRequestItemStatus": "ALLOCATED", "shipmentRequestStatus": "ALLOCATED" }
```

```json
// 배정 변경: {"purpose":"SHIPMENT","shipmentRequestItemId":48,"lotIds":[58],"releaseAllocationIds":[109],"reason":"야드 작업 순서"}
{ "purpose": "SHIPMENT", "shipmentRequestItemId": 48, "shipmentRequestId": 47, "productionPlanId": null,
  "allocations": [ { "id": 111, "lotId": 58, "lotNo": "HT-1-260923-001-12", "lotType": "SLAB", "heatNo": "HT-1-260923-001", "producedAt": "2026-09-23T04:12:00.000Z", "status": "CONFIRMED", "confirmedAt": "2026-09-30T11:34:17.945Z" } ],
  "releasedAllocationIds": [109], "recommendedLotNos": ["HT-1-260923-001-10"],
  "isRecommendationFollowed": false, "neededQty": 0,
  "shipmentRequestItemStatus": "ALLOCATED", "shipmentRequestStatus": "ALLOCATED" }
```

```json
// 열연: {"purpose":"ROLLING","productionPlanId":70,"lotIds":[32]}
{ "purpose": "ROLLING", "shipmentRequestItemId": null, "shipmentRequestId": null, "productionPlanId": 70,
  "allocations": [ { "id": 103, "lotId": 32, "lotNo": "HT-2-260922-001-05", "lotType": "SLAB", "heatNo": "HT-2-260922-001", "producedAt": "2026-09-22T04:05:00.000Z", "status": "CONFIRMED", "confirmedAt": "2026-09-30T11:32:25.805Z" } ],
  "releasedAllocationIds": [], "recommendedLotNos": ["HT-2-260922-001-05"], "isRecommendationFollowed": true, "neededQty": 0,
  "shipmentRequestItemStatus": null, "shipmentRequestStatus": null }
```

## 5. `POST /allocations/:id/release` — 배정 해제 (출고·투입 전)

```ts
// 요청
interface ReleaseAllocationBody { reason?: string }
// 응답 200
interface AllocationReleaseView {
  id: number;
  purpose: AllocationPurpose;
  status: AllocationStatus;         // 'RELEASED'
  lotId: number;
  lotNo: string;
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;   // 출하 배정이면 'WAITING_ALLOCATION'
  shipmentRequestStatus: ShipmentRequestStatus | null;           // 출하 배정이면 'REQUESTED'
}
```

- 출하 배정을 해제하면 품목은 배정 대기, 출하요청은 `REQUESTED`로 돌아간다 (다시 다 채워야 출고 확정 가능).
- 열연 배정을 해제하면, 여재에서 끌어왔던 슬래브는 다시 재고 풀로 돌아간다.
- 작업 로그 `ALLOCATION_RELEASED`(사유 코드 `ALLOCATION_CHANGE`, `reason`).

| 상황 | HTTP | code | message |
|---|---|---|---|
| 이미 해제됨 | 409 | `COM-005` | 이미 해제된 배정입니다 |
| 이미 출고·투입됨(CONSUMED) | 409 | `COM-005` | 이미 투입·출고된 배정은 변경할 수 없습니다 |
| 없는 배정 | 404 | `COM-004` | 배정을(를) 찾을 수 없습니다 |

```json
{ "id": 99, "purpose": "SHIPMENT", "status": "RELEASED", "lotId": 21, "lotNo": "HT-1-260921-001-10",
  "shipmentRequestItemStatus": "WAITING_ALLOCATION", "shipmentRequestStatus": "REQUESTED" }
```

## 실시간 주제

배정 확정·해제 뒤 `changed` 이벤트로 `allocations`, `lots`, `shipment-requests`, `production-plans`, (열연 귀속 시) `inventories`가 나간다.
