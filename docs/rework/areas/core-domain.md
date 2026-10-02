# 업무 규칙 핵심 (core-domain) — 수주·예약·생산·품질·구매·출하·Message → ERP 서비스와 시드

- 2026-10-01, 브랜치 `feature/screen-rework`(메인 체크아웃). 화면은 만들지 않았다. 이 문서는 **화면 영역 작업자가 쓰는 API 문서**다.
- 근거: 04 업무 프로세스 정의서(4.1~4.5, BP-SO-01/02, BP-PRD-01/02, BP-PUR-01/02, BP-QC-01, BP-INV-01/02, BP-SHP-01, BP-ACT-01, 8장, 9.1~9.3, 10장, 13장, 14.1~14.3), 02 요구사항 정의서(REQ-SO/INV/PRD/PUR/LOT/QC/SHP/LOG/ACT), ERD 최종본, `docs/rework/ks-values.md`, PLAN 4·6·7·8-1장. 6개 문서 밖에서 정한 것은 맨 아래 "가정값"에 모았다.

## 0. 쓰는 법 (화면 api 파일에서)

```ts
import { mockMutation, mockQuery } from '@/api/client';
import { requireActor } from '@/api/actor';
import { PERMISSION } from '@/codes';
import { createSalesOrder, listSalesOrders, userActor, type CreateSalesOrderInput } from '@/mock/services';

export const salesOrderApi = {
  list: () => mockQuery((tables) => listSalesOrders(tables)),
  create: (input: CreateSalesOrderInput) =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.SALES_ORDER_CREATE] }); // 권한은 api 층이 먼저 (COM-002)
      return createSalesOrder(tx, userActor(actor.employee.id), input);                // 규칙·이벤트·불변조건은 서비스
    }),
};
```

- **모든 서비스는 `@/mock/services`(index.ts) 하나에서 가져온다.** 파일은 `client/src/mock/services/*.ts`.
- 쓰기: `fn(tx, actor, input)` — `actor`는 `userActor(employeeId)`(사람). 서비스는 **역할 권한을 보지 않는다**(api 층이 `requireActor`). 단, 업무 주체 규칙(요청자만 확정, 요청 부서장만 승인)은 서비스가 본다(COM-002).
- 읽기: `fn(tables, input)` — `mockQuery(reader)` 안에서 부른다. 결과는 화면용 뷰 객체다(필요하면 테이블을 직접 읽어도 되지만 **규칙 계산은 다시 만들지 않는다**).
- 오류: 9.3 코드는 `ApiError(code, detail)`, 코드가 없는 입력 거부는 `InputError(message, fieldErrors)` (둘 다 `@/api/errors`). 오류가 나면 `mockMutation` 트랜잭션 전체가 취소된다.
- 수정 폼은 연 시점의 `updatedAt`을 `expectedUpdatedAt`으로 넘기면 바뀐 경우 COM-001.
- 날짜·시각: 날짜 `YYYY-MM-DD`, 시각 ISO. 톤은 문자열 소수 3자리(`'23.550'`), 수율 4자리.
- 이름(05 2장, 03 용어 사전): 1매(1개) 이론중량 `theoreticalWeightTon`(TRM-022), LOT 번호 필드는 히트 `heatNo`·슬래브 `slabNo`·코일 `coilNo`(목록은 `heatNos`·`slabNos`·`coilNos`, TRM-016~018). 채번 도우미는 `issueHeatNo`·`issueSlabNo`·`coilNoOf`·`issueHotMetalNo`·`issueRawMaterialLotNo`(mock/sequence.ts, 9.2). `heatLotId`·`heatLot`은 ERD `lot.heat_lot_id`(상위 히트 LOT id) 이름이라 그대로다.
- 작업 로그는 서비스가 같은 트랜잭션에서 `recordBusinessEvent`로 남긴다. 화면에서 따로 남기지 않는다. `target_type`은 테이블명, 수주 타임라인용 `sales_order_id`, LOT 타임라인용 `business_event_lot`을 빠짐없이 채운다.
- 사유 코드(`reason_code`)를 남길 때는 사람이 읽을 사유(`reason_text`)를 함께 남긴다(9.3): 실제 매수·LOT·수주 번호로, 단위는 슬래브 매·코일 개(`qtyUnitOfItem`). 예 "재고 우선 예약 6매 (수주 10매 중)", "품목 1 부족 4매로 생산계획 생성 (히트 1개)". 번호 뒤 조사는 `lib/josa.ts`로 맞춘다.

## 1. 순수 계산 (`client/src/lib/`, Vitest)

| 파일 | 내용 | 근거 |
|---|---|---|
| `decimal.ts` | BigInt 십진 계산: `decAdd/Sub/Mul/Div/Cmp/Sum/Round`, `decCeilDiv`(히트 수), `decFloorDiv`, `floorMulInt`(손실 매수). 반올림 0.5 올림 | 4.1 "십진수 연산" |
| `eligibility.ts` | `productEligibility(lot, heat)` → `ELIGIBLE / PENDING / FAILED / HEAT_FAILED / NOT_AVAILABLE`, `isQualityExcluded` | 4.3, INV-003·007 |
| `inventoryMath.ts` | `reservationAvailableQty`(4.2 식), `stockFirstSplit`, `shortageOf`(미출하·현재 미확보·추가 계획 필요), `reproductionNeedQty`, `progressOf`(분모 포함) | 4.2·4.5, SO-003, PRD-006 |
| `heatPlanning.ts` | `planHeats`(목표중량·누적 수율·필요 용강·히트 수·히트 톤·히트당 슬래브·예상 여재), `cumulativeYieldRate`, `maxSlabQtyFromHeat` | 4.4, PRD-002 |
| `mrp.ts` | `hotMetalTonFor`, `rawMaterialTonFor`, `ferroalloyTonFor`, `netRequirements`(시점별 순소요, 같은 공급 중복 차감 없음, 계획 몫 입고예정 우선) | 4.4, PRD-005 |
| `fifo.ts` | `compareFifo/sortFifo/pickFifo`(생산완료일 → LOT 번호), `planFifoDeduction`(입고일 순 차감, 모자라면 shortage) | INV-006, LOT-002·004 |
| `inspectionJudgment.ts` | `appliesToThickness`(초과~이하), `applicableItems`, `judgeValue`(이상·이하), `judgeInspection`(필수 누락·기준 없음 PENDING, 벗어나면 FAIL), `calcCarbonEquivalent`, `typicalPassValue`('기준 안 값으로 채우기') | QC-003 |
| `simulationLoss.ts` | `createSeededRandom`(mulberry32), `drawSampleLossRate`(0.0000~0.0500), `lossQtyOf`=floor | PRD-007, 8장 |
| `salesOrderStatus.ts` | `itemStatusOf`, `headerStatusOf`, `isDueRisk`, `daysBetween`, `addDays` | SO-005, 공통 코드 비고(납기 위험) |
| `weight.ts`(기존) | 이론중량·톤 — 그대로 재사용 | 4.1 |

## 2. 공통·재고 풀

### `context.ts`
- `userActor(id)`, `SYSTEM_ACTOR`, `PersonActor`, **`SYSTEM_SENDER_ID = 0`**(시스템 메시지의 `message.sender_id`, 화면은 '시스템'으로 보인다 — 가정값).
- `mustGet(tables, table, id, label)` → 없으면 COM-003. `refreshInventory(tx, itemId)`: `on_hand_qty` = 미소진(AVAILABLE) LOT 매수, `reserved_qty` = ACTIVE 예약 합계 (예약·LOT를 바꾸는 모든 서비스가 같은 트랜잭션에서 부른다).
- 기준정보: `theoreticalWeightOf(item)`(1매 이론중량, 없으면 MST-001), `routingYieldOf`(없으면 MST-001), `slabSpecOfCoil`(매핑 없으면 MST-001), `hotRollingYieldOf`, `castingSlabSpecOf`, `currentStandardOf(process, gradeId)`, `inspectionProcessOf(lotType)`.

### `inventoryPool.ts` (4.2·4.3, INV-003·007·008·009)
- `lotEligibility(tables, lot)`, `eligibleLotsOf(tables, itemId)`, `confirmedAllocationOf(tables, lotId)`, `activeReservedQtyOfItem`.
- **`reservationPoolOf(tables, itemId)`** → `{ eligibleQty, activeReservedQty, hotRollingConfirmedQty, shipmentConfirmedQty, availableQty }`.
  - 예약 가용 = 미소진 합격 − ACTIVE 예약 − 열연용 CONFIRMED 배정. 열연 배정은 생산계획에 연결되고 열연 추천이 판매 예약 몫을 넘지 않으므로 "예약으로 커버되는 열연 배정"은 없다 → 모두 뺀다. 출하 배정은 ACTIVE 예약의 일부라 다시 빼지 않는다.

### `invariants.ts`
- `checkInvariants(tables): string[]` — reserved_qty = ACTIVE 합계, on_hand = 미소진 LOT, reserved ≤ on_hand, 예약 가용 ≥ 0, LOT당 CONFIRMED 배정 1건(그리고 적격·미소진), CONVERTED 합계 = shipped_qty, 출하 배정 ≤ ACTIVE 예약, 잔량 ≥ 0, 입고예정 = 발주 − 입고, 밀시트 (출하요청×수주) unique, LOT 번호·LOT 관계 unique. 모든 시나리오 테스트가 단계마다 `[]`를 확인한다(P2 정합성 보정 화면도 쓸 수 있다).

## 3. 수주 (`salesOrders.ts`) — REQ-SO-001~006, BP-SO-01·02, 13.1·13.2

| 함수 | 입력 → 출력 | 규칙·오류 | 작업 로그 |
|---|---|---|---|
| `previewSalesOrder(tables, items)` | `[{itemId, orderedQty, dueDate}]` → 줄마다 `{weightTon(표시값), availableQty, reserveQty, shortageQty, formation}` | 같은 규격 앞 줄이 먼저 예약한 뒤의 가용으로 계산. SO-001/002, MST-001 | 없음 |
| `createSalesOrder(tx, actor, {customerId, items})` | → `{salesOrder, items, reservations, productionPlans}` | 규격 = 등록된 슬래브·코일만(SO-001), 매수 1 이상 정수(SO-002, `'10.5'`·`0`·`-1`·`''`·`'3매'` 거부, 글자를 지우지 않음), 품목별 납기(입력 오류), 고객사 COM-003. 톤 저장 안 함. 품목마다 예약 가용만큼 ACTIVE 예약(부분 허용), 부족분은 **품목 라우팅대로** 생산계획(히트 편성 계산·저장). 수율·배합·매핑 누락이면 저장 전에 MST-001 | SALES_ORDER_CREATED(USER) · RESERVATION_CREATED(SYSTEM, STOCK_FIRST) · PRODUCTION_PLAN_CREATED(SYSTEM, ORDER_SHORTAGE; created_employee_id = 등록자) |
| `cancelBlockOf(tables, soId)` | → `null`(가능) / `'SO-003'` / `'SO-004'` / `'CANCELLED'` | 출고 있으면 SO-003, 진행 중(REQUESTED·ALLOCATED) 출하요청에 품목이 있으면 SO-004 | — |
| `cancelSalesOrder(tx, actor, {salesOrderId, cancelReason, expectedUpdatedAt?})` | → sales_order | SO-003/004, 사유 필수(200자). ACTIVE 예약 → RELEASED, CONFIRMED 배정 → RELEASED, PLANNED 계획 → CANCELLED, **IN_PROGRESS 계획 → sales_order_item_id null + is_surplus_on_completion**(열연 배정 해제, 이미 나온 적격 슬래브는 바로 여재), COMPLETED 계획의 적격 미배정 슬래브는 여재 표시. 품목 CANCELLED | SALES_ORDER_CANCELLED(ORDER_CANCELLED, after_data에 품목별 `releasedReservedQty`·`cancelledPlanNos`·`unlinkedPlanNos` → `salesOrderDetail.cancellation`) · RESERVATION_RELEASED(ORDER_CANCELLED) · ALLOCATION_RELEASED · PRODUCTION_PLAN_CANCELLED(ORDER_CANCELLED) · SURPLUS_CONVERTED(SURPLUS_CONVERSION, before = 옛 수주 연결) |
| `cancelPurchaseImpactOf(tables, soId)` | → `CancelPurchaseImpactLine[]` | 취소 창의 구매 진행 영향(BP-PRD-01): PLANNED(취소)·IN_PROGRESS(연결 해제) 계획에 `production_plan_id`로 연결된 구매요청 품목(상태)과 발주(번호·상태). **표시만**, 수주 취소는 구매요청·발주를 바꾸지 않는다 | — |
| `listSalesOrders(tables, {today?})` | → `SalesOrderSummary[]` (헤더 상태 계산값, 품목 수·유형, 총 매수·톤, 출고·예약 합계, 가장 이른 납기, `isDueRisk`, `hasReproductionNeed`, `workRoomId`) | today 기본 = 오늘(서울). 납기 위험 = 미출하 남음 && 납기까지 ≤ `delivery_risk_days` | — |
| `salesOrderDetail(tables, id, {today?})` | → summary + `items: ItemFulfillment[]`, `reservations`, `shipmentRequests`(줄별 배정 수), `millSheets`, `cancelBlock`, `cancellation`(취소된 수주: 취소 작업 로그 after_data의 실제 결과, 아니면 null) | — | — |
| `fulfillmentOf(tables, soItem, today?)` | → `ItemFulfillment` (SO-004 충족 현황) | 아래 표 | — |

**충족 현황(SO-004)과 분모(4.5)** — `ItemFulfillment.measures`

| 지표 | 값 | 분모 |
|---|---|---|
| 예약 `reserved` | ACTIVE 예약 | 미출하 매수 |
| 생산중 `inProduction` | 진행중·완료 연결 계획의 잔여 목표(아직 합격 전) | 수주 매수 |
| 검사합격 `passed` | `securedQty` = ACTIVE 예약 + 출고 (예약은 모두 합격 제품이다) | 수주 매수 |
| 출하 `shipped` | shipped_qty | 수주 매수 |

- 함께 주는 값: `plannedQty`(시작 전 계획 잔여), `shortage` = `{unshippedQty, unsecuredQty, additionalPlanQty, activeReservedQty, openPlanRemainingQty, reservationAvailableQty, reproductionNeedQty}`, `plans[]`(계획 번호·상태·재생산·잔여 목표). 지표를 더해 수주보다 큰 "충족 매수"를 만들지 않는다.

## 4. 예약·배정 (`reservations.ts`, `allocations.ts`) — REQ-INV-002·004~007·009, BP-INV-01·02

| 함수 | 규칙·오류 | 작업 로그 |
|---|---|---|
| `createReservation(tx, actor, {salesOrderItemId, qty, reasonCode?, reasonText?, lotIds?})` | 예약 가용 초과 INV-001 | RESERVATION_CREATED |
| `reserveUpToShortage(tx, actor, {salesOrderItemId, reasonTextOf?, …})` | **INV-004 자동 예약 도우미**: min(현재 미확보, 예약 가용). 같은 규격 여재(같은 히트 포함)로 먼저 채운다(14.1-5). 취소·출하완료 품목은 0. 사유 문구는 `reasonTextOf('3매')`로 예약한 매수를 넣어 만든다 | RESERVATION_CREATED (자동 예약은 SYSTEM, 사람이 '여재로 채우기'를 누르면 USER) |
| `releaseReservationsOfItem(tx, actor, soItemId, reasonCode, cause)` | 수주 취소용. 사유 = `${cause} 예약 n매 해제` | RESERVATION_RELEASED |
| `convertReservations(tx, actor, soItemId, qty, lotIds)` | 오래된 ACTIVE부터 CONVERTED, 부분이면 행 분할(ACTIVE 10 → 4 출고 → CONVERTED 4 + ACTIVE 6). 모자라면 SHP-002 | RESERVATION_CONVERTED (USER) |
| `rebalancePool(tx, itemId, {affectedSalesOrderItemIds, lotIds})` | 품질 불합격 뒤 예약 가용 < 0일 때만 부족분 조정: ① 불합격 LOT을 만든 계획의 수주 예약(최근 것부터) ② 열연 CONFIRMED 배정(최근 것부터) ③ 그 밖의 예약. 예약보다 많은 출하 배정은 최근 것부터 해제 | RESERVATION_RELEASED·ALLOCATION_RELEASED (SYSTEM, QUALITY_FAILURE) |
| `assertAllocatableLot(tables, lotId, itemId)` | 규격 다름 → 입력 오류, 소진·출고 INV-004, 이미 CONFIRMED INV-003, 미합격(제품·상위 히트) INV-002 | — |
| `recommendFifoLots(tables, itemId, count)` | 적격·미소진·미배정 LOT을 FIFO로 (저장 안 함) | — |
| `recordRecommendation(...)` | 확정 직전 FIFO 추천을 남긴다(13.2) | ALLOCATION_RECOMMENDED (FIFO_RECOMMENDATION, 추천·선택 LOT, 같은지) |
| `insertConfirmedAllocation(...)` | CONFIRMED 배정 1건 | ALLOCATION_CONFIRMED (LOT마다) |
| `changeAllocation(tx, actor, {allocationId, newLotId, reasonText})` | 사유 필수, 기존 RELEASED + 새 CONFIRMED 한 트랜잭션, 소진 배정 INV-004 | ALLOCATION_CHANGED (ALLOCATION_CHANGE, 전후 LOT) |
| `releaseAllocation(tx, actor, {allocationId, reasonText?})` | CONFIRMED만, 소진 INV-004 | ALLOCATION_RELEASED |
| `refreshShipmentRequestStatus(tx, id)` | 모든 줄이 요청 매수만큼 배정 → ALLOCATED, 아니면 REQUESTED | — |

## 5. 생산계획·히트 편성·재생산 (`productionPlans.ts`) — REQ-PRD-001·002·006, BP-PRD-01

- 상태: **PLANNED → IN_PROGRESS(그 계획의 첫 작업 실적, 시작만 해도) → COMPLETED**. CANCELLED는 PLANNED에서만. CONFIRMED 없음.
- **COMPLETED 조건(정의)**: 편성한 히트 수만큼 제강·연주가 끝났고, 코일 계획이면서 수주 연결이 있으면 만든 코일(불합격·히트 불합격 제외 = 합격 + 판정 대기) 수 ≥ 부족 매수. (연결이 끊긴 코일 계획은 연주까지만 — 수주 취소로 연결이 끊기는 순간에도 다시 확인한다.) 코일 계획이 완료되면 열연하지 않고 남은 그 계획의 적격 슬래브를 여재로 표시한다(완료 뒤 합격한 슬래브도 합격 때 여재).
- **진행 계획 잔여 목표(4.5)** `planProgressOf(...).remainingTargetQty`: 취소·수주 연결 없음 → 0. 연주할 히트가 남았으면 `부족 매수 − 합격 매수`. 모두 연주했으면 그 값과 "아직 합격할 수 있는 매수" 중 작은 값. 아직 합격할 수 있는 매수 = 판정 대기 + (완료 전 코일 계획만) 열연 배정 + `ownAllocatableSlabQty`(판정 대기 자기 슬래브 + min(적격 미배정 자기 슬래브, 슬래브 규격 예약 가용)). 다른 수주가 예약으로 가져간 자기 슬래브, 완료 계획의 남은 슬래브는 세지 않는다 → 그만큼 '추가 계획 필요'가 생겨 재생산할 수 있다.

| 함수 | 입력 → 출력 | 규칙·오류 | 작업 로그 |
|---|---|---|---|
| `planHeatsFor(tables, item, shortageQty)` | → `HeatPlan` | 수율·배합(철광석·석탄·석회석 공통, 강종 합금철)·매핑 누락 MST-001 | — |
| `createProductionPlan(tx, actor, {salesOrderItemId, itemId, shortageQty, isReproduction, createdEmployeeId})` | 수주 등록·재생산이 부른다. shortage_qty·cumulative_yield_rate·required_steel_ton·heat_count 저장 | | PRODUCTION_PLAN_CREATED / REPRODUCTION_PLAN_CREATED (ORDER_SHORTAGE) |
| `cancelProductionPlan(tx, actor, {productionPlanId, reasonText?, expectedUpdatedAt?})` | PLANNED가 아니면 입력 오류. 열연 배정 해제 | | PRODUCTION_PLAN_CANCELLED |
| `createReproductionPlan(tx, actor, {salesOrderItemId})` | → `{reservedFromSurplusQty, plan}` | **사람이 만든다(자동 없음)**. 먼저 같은 규격 여재로 미확보 예약, 그래도 '추가 계획 필요'가 남을 때만 is_reproduction 계획. 남는 것이 없으면 입력 오류 | RESERVATION_CREATED(USER) · REPRODUCTION_PLAN_CREATED |
| `itemShortageOf(tables, soItem)` | → `ItemShortage` (재생산 필요 = max(0, 추가 계획 필요 − 예약 가용)) | 14.1-6 | — |
| `planProgressOf(tables, plan)` | 히트 수·제강·연주한 히트·슬래브·코일·합격·판정 대기·불합격·열연 배정·잔여 목표·완료 여부 | | — |
| `refreshPlanStatus(tx, planId)` | 실적 서비스가 부른다 | | (완료 시 SURPLUS_CONVERTED) |
| `productionPlanView(tables, id)` | **편성표**: `formation{shortageQty, targetWeightTon(수주 목표), cumulativeYieldRate, requiredSteelTon, heatCount, heatCapacityTon, heatTon(히트 전체 톤), slabQtyPerHeat, plannedSlabQty, expectedSurplusSlabQty}`, `heats[]`(순번·히트 번호·판정·연주 여부·슬래브 수), `results[]`(작업 실적, 시뮬레이션 값 포함), `salesOrder`, `slabSpec`, `progress`, `canCancel` | | — |
| `listProductionPlans(tables)` | 목록용 요약 (재생산·완료 후 여재 배지, 진행 수치) | | — |

## 6. 작업 실적 (`productionResults.ts`) — REQ-PRD-003, REQ-LOT-001~004, BP-PRD-02

- 작업 상태값 없음: `started_at` / `completed_at`(null = 진행 중). **한 번에 등록**(시작·완료 함께)하거나 **`startWork`로 시작만** 기록한 뒤 같은 `productionResultId`로 완료할 수 있다.
- **진행 중 작업(시작만 한 실적)**: 같은 공정에 있으면 새 실적·새 `startWork`를 입력 오류로 막고 '작업 완료'(`productionResultId`)로만 마친다. 연주 작업 완료는 시작 때 기록한 히트(PRODUCTION_STARTED `afterData.heatLotId`, `startedHeatLotIdOf`)로만 한다. 실적 등록(열연 포함)으로 계획이 COMPLETED가 되는데 다른 공정에 시작만 한 실적이 남으면 거부한다(`assertNoOpenWorkOnCompletion`, 트랜잭션 취소). 조회용 `openResultsOf(tables, planId, processType?)`. (2026-10-02 ext에서 core로 옮김)
- 모든 LOT 번호는 기존 채번 도우미(9.2, 완료 일시의 서울 날짜). 제품 LOT 야드 = 규격 기본 야드. 원료·용선 잔량은 음수가 되지 않는다(모자라면 입력 오류, 아무것도 저장 안 됨). 잔량 0 → LOT CONSUMED.

| 함수 | 입력 | 처리 | LOT 관계 | 작업 로그 |
|---|---|---|---|---|
| `startWork(tx, actor, {productionPlanId, processType, startedAt, blastFurnaceCode?, converterCode?, heatLotId?})` | 고로·전로 코드 형식 `[A-Z0-9]{2,10}` | production_result(completed_at null), 계획 IN_PROGRESS | — | PRODUCTION_STARTED |
| `registerIronmaking(tx, actor, {productionPlanId, blastFurnaceCode, startedAt, completedAt, outputTon, productionResultId?})` | 고로 코드, 작업일시, 용선량 | 철광석·석탄·석회석 = 용선량 × t/t, **완료일까지 입고된** 원료 LOT에서 입고일 FIFO 차감 → 용선 `HM-고로-YYMMDD-NN` | 원료→용선 **PERIOD_BASED**(input_ton = 차감량, period = 실적 시작~종료, 차감된 LOT만) | PRODUCTION_STARTED · PRODUCTION_RESULT_REGISTERED (LOT: 용선 + 원료) |
| `registerSteelmaking(tx, actor, {productionPlanId, converterCode, startedAt, completedAt, inputHotMetalTon, …})` | 전로 코드, 투입 용선량(용선 LOT은 생산 순 FIFO 자동) | 히트 톤 = 투입 용선 × 제강 계획 수율, 합금철 = 히트 톤 × kg/t ÷ 1,000 입고일 FIFO → 히트 `HT-전로-YYMMDD-NNN`(계획 강종), **성분 검사 대상(PENDING 검사 행)**. 편성 히트 수를 넘으면 입력 오류 | 용선→히트 **ACTUAL_INPUT(N:M)**, 합금철→히트 **ACTUAL_INPUT** | 위와 같음 (`afterData.heatSeq` = 편성 안 순번) |
| `registerCasting(tx, actor, {productionPlanId, heatLotId, outputQty, startedAt, completedAt, itemId?, …})` | 히트, 규격(생략 가능), 슬래브 매수, 작업일시 | **최대 매수 = floor(히트 톤 × 연주 수율 ÷ 슬래브 1매 이론중량)**(넘으면 입력 오류), 같은 히트 두 번 연주 불가 → 슬래브 `히트번호-SS`, 표면·치수 검사 대상. 완료 후 여재 계획이어도 연주 때는 surplus_at을 넣지 않는다(검사로 적격이 되면 여재) | 히트→슬래브 ACTUAL_INPUT (input_ton = 슬래브 1매 이론중량) | 위와 같음 |
| `maxCastingQtyOf(tx, plan, heat)` | 화면 안내용 | | | |

## 7. 실적 시뮬레이션 (`simulation.ts`) — REQ-PRD-007, BP-SEED-01

`simulatePlan(tx, actor, {productionPlanId, randomSeed?, blastFurnaceCode?='BF2', converterCode?='BOF1'})` → `{randomSeed, steps[], skippedRolling}`
- 남은 공정 전부: 연주 전 히트부터 연주 → 남은 히트마다 (용선이 모자랄 때만) 제선 → 제강 → 연주 → 코일 계획은 열연.
- 고정 수율: 용선 = 히트 용량 ÷ 제강 수율, 계획 슬래브 = 히트에서 나올 수 있는 최대 매수. 연주에서만 샘플 손실률(0~5%) → `lossQty = floor(계획 × 손실률)`, 열연은 추가 손실 없음.
- `random_seed`·`sample_loss_rate`·`loss_qty`·`is_simulated`를 저장한다. 시드를 안 주면 실행 시각으로 정하고 결과로 돌려준다(화면에 보인다). **같은 시드·같은 상태 → 같은 결과**.
- 검사값은 넣지 않는다 → 갓 연주한 슬래브는 판정 대기라 열연할 수 없다. 적격 슬래브(여재 포함)가 있으면 FIFO 추천을 확정하고 열연한다. 없으면 `skippedRolling`에 이유. **검사 합격 뒤 다시 실행하면 남은 열연을 한다.**
- 시각: 모두 지금(tx 시각)에 끝나도록 거꾸로 배치(제선 4h·제강 1h·연주 2h·열연 2h, 가정값).
- 원료가 모자라면 제선·제강처럼 입력 오류(구매·입고 먼저).
- 작업 시작만 한 실적이 있으면 실행하지 않는다(`assertNoOpenWorkForSimulation`, 입력 오류). '작업 완료'로 먼저 마친다.

## 8. 열연 (`rolling.ts`) — REQ-PRD-004, BP-INV-01

| 함수 | 내용 |
|---|---|
| `rollingPlans(tables)` / `rollingPlanView(tables, planId)` | 코일 계획(계획·진행중): 코일 규격·대응 슬래브 규격, 부족 매수, 만든 코일(`rolledQty` = 불합격 제외)·불합격 코일(`failedCoilQty`), 배정 수, **필요 매수 = 부족 − 코일(불합격 제외) − 배정**, 슬래브 풀(예약 가용), `recommendableQty = min(필요, 예약 가용)`, 배정 목록, `rollable`(수주 연결 없으면 false + 이유) |
| `rollingRecommendation(tables, planId)` | FIFO 추천(저장 안 함). **판매 ACTIVE 예약 몫을 뺀 예약 가용 안에서만** → 판매 예약을 침범하지 않는다(14.2) |
| `confirmRollingAllocations(tx, actor, {productionPlanId, lotIds})` | HOT_ROLLING CONFIRMED (production_plan_id). LOT 확인(INV-002·003·004, 규격) 후 필요·예약 가용 초과 INV-001. 이벤트 ALLOCATION_RECOMMENDED + ALLOCATION_CONFIRMED |
| 변경·해제 | `changeAllocation` / `releaseAllocation` (4장) |
| `registerHotRolling(tx, actor, {productionPlanId, allocationIds?, startedAt, completedAt})` | 배정 슬래브 소비(배정 CONSUMED, LOT CONSUMED) → 코일 `C+슬래브번호`(HT- 제외), 코일 규격·상위 히트·코일 야드, 슬래브→코일 1:1 ACTUAL_INPUT, **코일 검사 대상**. 미소진 INV-004, 미합격 INV-002, 수주 연결 없으면 입력 오류. 작업 로그 PRODUCTION_STARTED·PRODUCTION_RESULT_REGISTERED. 이 실적으로 계획이 완료되는데 시작만 한 실적이 남으면 거부. 열연 실적은 이 함수 하나(작업 실적 화면이든 열연 화면이든 이것을 부른다) |

## 9. 검사·불합격 (`inspections.ts`) — REQ-QC-001~004, BP-QC-01

| 함수 | 내용 |
|---|---|
| `inspectionQueue(tables)` | 히트·슬래브·코일 LOT: 판정 대기 먼저(생산완료일 → LOT 번호), 그다음 최근 판정. 공정·강종·두께·상위 히트 판정·기준 코드/버전·검사자·`locked` |
| `inspectionFormOf(tables, lotId)` | 입력 폼: **판정에 쓰는 기준 버전**(`standard`, 값을 넣은 적이 없으면 현재 버전) + `currentStandard`, **두께 구간으로 거른 항목**(코일 두께 밴드, 샤르피는 SM 강종·6mm 초과만), 항목별 현재 값·판정, `updatedAt`, 잠금 |
| `registerInspection(tx, actor, {lotId, values:[{inspectionStandardItemId, measuredValue}], expectedUpdatedAt?})` | 같은 검사 행을 등록·수정. 넘긴 항목만 바꾼다(빈 값 = 지움). 판정: 경계 포함, 필수 누락 PENDING, 벗어나면 FAIL. `lot.is_passed` 반영. **밀시트에 들어간 LOT(제품·그 히트)은 입력 오류로 막는다**. 기준 없음 MST-001. 결과 `{inspection, autoReservedQty, surplusLotNos, excludedLotQty}` |
| `setDisposition(tx, actor, {lotId, dispositionStatus, dispositionReason, expectedUpdatedAt?})` | 불합격 LOT 또는 히트 불합격 하위 LOT만, 사유 필수(500). 후속 처리 없음. DISPOSITION_SET |
| `rejectedLots(tables)` | 불합격 관리 목록: `reason` FAILED(이 LOT) / HEAT_FAILED(상위 히트 때문에 제외), 벗어난 항목, 처리 상태 |
| `isInspectionLocked`, `millSheetNosContainingLot`, `ensurePendingInspection`, `lotThicknessOf` | 도우미 |

판정 뒤 처리(같은 트랜잭션):
- **적격이 된 제품**(슬래브 = 히트+슬래브 합격, 코일 = 히트+코일 합격): 계획의 원래 수주 품목(같은 규격)에 미확보만큼 **자동 예약(SYSTEM)**. 예약하지 못한 슬래브 계획(또는 연결 끊긴 계획)의 합격 슬래브는 여재(surplus_at, SURPLUS_CONVERTED). 코일 계획의 슬래브는 자동 예약·여재 표시를 하지 않는다(열연 대상, 계획이 끝나면 여재).
- **적격에서 빠진 제품**(제품 불합격, 히트 불합격이면 하위 슬래브·코일 전부): CONFIRMED 배정 RELEASED(QUALITY_FAILURE) + `rebalancePool`.
- 작업 로그: INSPECTION_REGISTERED(before/after 값·판정, 기준 코드·버전, 누락·불합격 항목).

## 10. MRP (`mrp.ts`) — REQ-PRD-005, BP-PRD-01

`computeMrp(tables, {from, to})` → `MrpView` (저장 안 함, 바로 계산) — 필요일이 from~to인 계획을 보인다.

`computeMrpForPeriod(tables, {from, to})` → `MrpPeriodView` — MRP 화면(`api/mrp.ts`)용. 필요일 ≤ to인 계획을 보이고 from 전 계획은 밀린 소요(`plans[].beforePeriod`)로 함께 보인다. 기간 뒤 계획은 보이지 않지만 차감(계획 몫 입고예정 보호)에는 들어간다. 두 함수는 계산 한 벌(`mrpViewOf`)을 같이 쓰고 보일 범위만 다르다(2026-10-02 `ext/purchasing.ts`에서 옮김).
- 순소요 계산: 계획·진행중이고 아직 만들지 않은 히트가 있는 **모든** 계획을 필요일 순으로 차감한다(기간 앞의 못 만든 계획이 먼저 잔량을 쓴다). **기간은 결과(plans·materials·requisitionLines)를 보여 줄 때만** 거른다. 필요일(가정값) = 연결 수주 품목 납기, 없으면 계획 등록일.
- `plans[]`: 남은 히트 수·히트 톤·필요 용선·예상 슬래브 여재·원료별 총소요/순소요.
- `materials[]`: 원료별 총소요, 원료 LOT 잔량, 입고예정(확정 발주 미입고량 합계), 잔량·입고예정으로 채운 톤, **순소요**, 첫 부족 필요일, 원단위 단위(t/t, kg/t).
  - 표 한 줄의 숫자가 맞도록 공급을 보이는 계획 기준으로 나눈다(2026-10-02, `mrpMaterialRows` + lib `supplyBreakdownOf`): `usableOnHandTon`(표 '원료 LOT 잔량' 칸 = 합계 − `onHandEarlierPlansTon`), `coveredScheduledTon`(표 '입고예정' 칸 = 필요일까지 받아 쓰는 몫), 쓰지 않은 입고예정의 이유별 톤 `scheduledOtherPlansTon`(다른 열린 계획 몫, REQ-PRD-005)·`scheduledAfterNeedDateTon`(필요일 뒤 도착·납기 없음)·`scheduledEarlierPlansTon`(표에 없는 앞선 계획이 씀)·`scheduledSpareTon`(소요가 채워져 남음). 합: 입고예정 = 칸 + 이유별 톤, 순소요 = max(0, 총소요 − 잔량 칸 − 입고예정 칸). 차감 규칙은 그대로다.
  - `mrpSuppliesOf(tables)`(공급 목록)와 `mrpMaterialRows(tables, 소요 전부, 공급, 보이는 소요)`는 `computeMrp`·`computeMrpForPeriod`가 같이 쓴다.
- `requisitionLines[]`: 순소요 > 0인 (계획, 원료) 줄 = "구매요청 만들기" 미리 채움. 같은 계획·원료 구매요청이 있으면 `existingPurchaseRequisitionNo`(만들 때도 입력 오류로 막는다).
- 입고예정: 필요일까지(이하) 도착하는 확정 발주만, 시점별로 한 번만 쓴다. 구매요청 품목에 계획이 연결된 입고예정은 그 계획이 먼저 쓰고, 그 계획에 남은 소요가 없을 때만 다른 계획이 쓴다. 용선 잔량은 빼지 않는다.

## 11. 구매 (`purchasing.ts`) — REQ-PUR-001~004, REQ-AUTH-004, BP-PUR-01·02

| 함수 | 규칙·오류 | 작업 로그·알림 |
|---|---|---|
| `createPurchaseRequisition(tx, actor, {desiredReceiptDate?, requestReason?, items:[{itemId, requiredTon, productionPlanId?}], actionDraftId?, messageId?})` | 등록 = WAITING_APPROVAL. 요청자 = actor, 부서 = 요청 시점 소속. 부서장 없음 PUR-001. 원료만·톤 > 0(소수 3자리)·같은 원료 두 줄 불가·같은 (계획, 원료) 중복 불가(입력 오류). 같은 초안으로 두 번 불가 | PURCHASE_REQUISITION_CREATED(action_draft_id·message_id) · 부서장에게 **APPROVAL_REQUESTED** (`/approvals?pr=id`) |
| `resubmitPurchaseRequisition(tx, actor, {purchaseRequisitionId, desiredReceiptDate?, requestReason?, items, expectedUpdatedAt?})` | REJECTED만, 요청자만(COM-002). 줄 교체 → WAITING_APPROVAL (반려 사유 지움). 요청 부서를 재요청 시점 소속으로 바꾼다(알림 대상 = 승인권자) | PURCHASE_REQUISITION_CREATED(reasonText '반려 후 고쳐 다시 요청', before/after) · APPROVAL_REQUESTED |
| `canApproveRequisition(tables, employeeId, pr)` | 요청 부서(department_id)의 부서장 && 승인 대기 | — |
| `approvePurchaseRequisition` / `rejectPurchaseRequisition(…, {rejectReason})` | 승인 대기만, 요청 부서 부서장만(COM-002), 부서장 없음 PUR-001, 반려 사유 필수 | PURCHASE_REQUISITION_APPROVED/REJECTED · 요청자에게 **APPROVAL_RESULT** |
| `createPurchaseOrders(tx, actor, {purchaseRequisitionItemIds, dueDate?})` | 승인된 요청만(PUR-002), 이미 발주한 줄 입력 오류, 품목 **기본 공급업체별 발주 1건**(여러 줄), 발주량 = 요청 톤, 납기 = 입력값 또는 가장 이른 희망 입고일. 요청의 모든 줄을 발주하면 ORDERED | PURCHASE_ORDER_CREATED (발주마다) |
| `receiveGoods(tx, actor, {purchaseOrderItemId, receivedTon, receiptDate})` | 등록 = 확정(수정 없음). 미입고량 초과 PUR-003. 야드 = 품목 기본 야드. 원료 LOT `RM-원료코드-YYMMDD(입고일)-NNN`, 잔량 = 입고량. 발주 줄 received/scheduled, 발주 상태 PARTIALLY_RECEIVED/RECEIVED | GOODS_RECEIPT_CONFIRMED (LOT 연결) |
| 조회 | `listPurchaseRequisitions`, `requisitionView`(출처 MESSAGE/MRP/DIRECT 계산), `approvalInbox(tables, employeeId)`, `orderableRequisitionItems`(공급업체 포함), `listPurchaseOrders`/`purchaseOrderView`(줄별 입고·LOT), `receivablePurchaseOrders`, `listGoodsReceipts` | — |

## 12. 출하요청·출고·밀시트 (`shipments.ts`, `goodsIssues.ts`, `millSheets.ts`) — REQ-SHP-001~004

| 함수 | 규칙·오류 | 작업 로그 |
|---|---|---|
| `shippableItemsOf(tables, customerId)` | 그 고객사의 진행중·부분출하 품목, **출하 가능 잔량 = ACTIVE 예약 − 진행 중 출하요청 매수** | — |
| `createShipmentRequest(tx, actor, {customerId, requestedShipDate, items:[{salesOrderItemId, requestQty}]})` | 같은 고객사만(입력 오류), 매수 SO-002, 잔량 초과 SHP-002, 출하 요청일 필수. 요청자 = actor. **결과에 FIFO 추천(`recommendation`)을 바로 담는다** | SHIPMENT_REQUEST_CREATED (수주마다 한 건) |
| `shipmentRecommendation(tables, requestId)` | 줄마다 요청·배정·배정 대기, `recommendedLots`(배정 대기만큼 FIFO), `candidateLots`(고를 수 있는 전부, FIFO) | — |
| `confirmShipmentAllocations(tx, actor, {shipmentRequestId, lines:[{shipmentRequestItemId, lotIds}]})` | LOT 확인 후 배정 대기·ACTIVE 예약 초과 INV-001. 상태 ALLOCATED(모든 줄 완료) | ALLOCATION_RECOMMENDED + ALLOCATION_CONFIRMED |
| `changeShipmentAllocation` / `releaseShipmentAllocation` | 출고·취소된 요청은 입력 오류 | ALLOCATION_CHANGED / RELEASED |
| `cancelShipmentRequest(tx, actor, {shipmentRequestId, expectedUpdatedAt?})` | ISSUED면 SHP-003. CONFIRMED 배정 해제, 예약은 ACTIVE 유지 | ALLOCATION_RELEASED (출하요청 취소 이벤트 유형은 29개에 없다) |
| `listShipmentRequests` / `shipmentRequestDetail` | 요약(수주 번호들, 요청·배정·배정 대기, 톤) / 줄·배정 LOT·밀시트 | — |
| `goodsIssueCheck(tables, requestId)` | 출고 전 재검증 결과(`ready`, `problems[{code, message, lotNo}]`) | — |
| `confirmGoodsIssue(tx, actor, {shipmentRequestId, expectedUpdatedAt?})` | 이미 출고 COM-001(중복 없음), 배정 대기 INV-001, 소진 INV-004, **미검사·불합격 INV-002**, 잔량 초과 SHP-002 → 배정 CONSUMED, LOT SHIPPED, 예약 CONVERTED(분할), shipped_qty·품목 상태, 재고, `issued_at`·`issued_employee_id`, ISSUED, **밀시트(출하요청 × 수주)** | GOODS_ISSUE_CONFIRMED(수주마다, LOT 전부) · RESERVATION_CONVERTED · MILL_SHEET_ISSUED(SYSTEM) |
| `goodsIssueQueue(tables)` | 배정 확정 → 배정 대기 → 출고 완료 순, 출고 가능 여부 | — |
| `listMillSheets` / `millSheetDetail(tables, id)` | `{row, snapshot}` — `MillSheetSnapshot`(고객사·수주·출하요청·품목(규격·적용 규격 번호·치수·이론중량·매수·톤)·LOT(생산완료일·히트·코일이면 슬래브 번호·제품 검사값과 기준 버전)·히트(성분 검사값과 기준 버전)·발행일·`lotIds`) | — |
| `markMillSheetPdfGenerated(tx, actor, {millSheetId})` | 'PDF 생성'(인쇄) 뒤 `pdf_path = mill-sheets/<번호>.pdf`. 이미 있으면 그대로. 렌더 실패는 화면이 SHP-001로 알리고 부르지 않는다 | (해당 이벤트 유형 없음) |

밀시트 번호: `MS-{출하요청 일련}-N`, N = 출하요청 안의 수주별 순번(예: DR-2610-0002 → MS-2610-0002-1).

## 13. Message → ERP (`actionDrafts.ts`) — REQ-ACT-001~004, BP-ACT-01, 13.4

| 함수 | 규칙·오류 | 작업 로그 |
|---|---|---|
| `ACTION_TYPE_REGISTRY` | 유형 → `{label, grade, fields, execute}`. PURCHASE_REQUISITION_CREATE만 `execute` 있음(P1), 나머지 5개는 `execute: null` = **준비 중** | — |
| `createDraftFromMessage(tx, actor, {messageId, actionType?})` | 그 방 멤버만(COM-002), 시스템 메시지는 불가. **요청자 = 메시지 보낸 사람**. AI_GENERATED로 만들고 바로 WAITING_APPROVAL(AI 추출 없음). 같은 메시지·유형의 반려되지 않은 초안이 있으면 그것을 돌려준다(`created: false`) | DRAFT_CREATED(message_id·action_draft_id, 업무방이면 sales_order_id) |
| `updateDraft(tx, actor, {actionDraftId, payload:{itemId?, requiredTon?, desiredReceiptDate?, requestReason?}})` | 요청자만, 확인 대기일 때만, 형식 오류는 입력 오류 | (유형 없음) |
| `confirmDraft(tx, actor, {actionDraftId, expectedUpdatedAt?})` | 요청자만(COM-002). 원료 품목·수량(톤)·희망 입고일이 비거나 기준정보와 안 맞으면 **ACT-001**(detail = 칸 이름). APPROVED → 등록부 핸들러가 구매요청 생성(action_draft_id, WAITING_APPROVAL, 부서장 승인 필요) → EXECUTED. 핸들러가 실패하면 APPROVED 그대로, `execution_result = {attempts, errorCode, message}`, 결과 `executed: false` | DRAFT_CONFIRMED(DRAFT_CONFIRMED) · PURCHASE_REQUISITION_CREATED · DRAFT_EXECUTED · 방에 시스템 메시지 |
| `executeDraft(tx, actor, {actionDraftId})` | APPROVED(실행 실패)만 다시. 이미 만든 구매요청이 있으면 입력 오류(중복 실행 방지) | 위와 같음 |
| `rejectDraft(tx, actor, {actionDraftId, rejectReason})` | 요청자만, 사유 필수 → REJECTED | DRAFT_REJECTED |
| `actionDraftView` / `listActionDrafts({requesterId?})` / `draftPayloadOf` / `unresolvedDraftFields` | 원본 메시지·방·요청자·미확정 칸·만든 구매요청 | — |

초안은 업무 번호가 없다(9.1·ERD) → 화면은 "초안 #id".

## 14. 업무방 (`workRooms.ts`) — REQ-MSG-001

- `openWorkRoom(tx, actor, {salesOrderId, memberEmployeeIds})` → `{chatRoom, created}`: 수주당 WORK 방 1개. 이미 있으면 그 방(새 멤버만 더함). 멤버 = 연 사람 + 고른 사원(없는 사원 COM-003, 사용 안 함 사원은 제외). 방 이름 `SO-… 고객사명`. 시스템 메시지 "…님이 수주 SO-… 업무방을 열었어요"(연 사람은 읽음 처리).
- `postSystemMessage(tx, chatRoomId, content)`, `workRoomOfSalesOrder(tables, soId)`.
- DIRECT·GROUP 방, 채팅 화면, 알림(WORK_ROOM_MESSAGE)은 메신저 영역이 만든다.

## 15. 재고·타임라인 조회 (`inventoryViews.ts`, `timelines.ts`)

- `productInventory(tables)`: 규격별 재고(미소진)·합격·판정 대기·불합격·예약·열연 배정·출하 배정·**가용(4.2)**·톤(재고·합격·가용).
- `lotList(tables, {lotType?, lotStatus?, itemId?})`: 모든 LOT(유형·규격·생산완료일·품질(제품은 적격 판정, 히트는 성분)·CONFIRMED 배정 목적·야드·잔량·히트·계획·여재·처리 상태).
- `rawMaterialInventory(tables)`: 원료별 LOT 잔량 합계 + 입고예정, LOT(입고일·잔량·공급업체·입고 번호).
- `surplusSlabs(tables)`: 미배정 합격 슬래브가 있는 슬래브 규격마다 미배정 합격 수·ACTIVE 예약·가용재고(`availableQty`, 예약 가용)와 **여재(TRM-048)** `surplusQty` = min(여재 전환(surplus_at) LOT 수, 가용재고), 여재 슬래브 `lots`(FIFO 순, 최근 여재 전환 LOT부터 여재 매수만큼 — lib `surplus.ts` `pickSurplusLots`). 재고 화면 여재 탭·LOT 목록 꼬리표·대시보드 여재 위젯이 이 결과를 그대로 쓴다(2026-10-02: 전에는 `surplusQty`가 예약 가용이라 대시보드가 코일 계획의 열연 대기 슬래브까지 여재로 셌다).
- `salesOrderTimeline(tables, soId)` / `lotTimeline(tables, lotId)`: 시간순(동률은 이벤트 id), 주체 이름('시스템'), 사유, 전후, 메시지·초안, LOT 번호. (작업 로그 화면 전체는 다른 영역.)
- `eventTargetTextOf(tables, event)` → 화면에 보일 대상(`TimelineEvent.targetText`, 작업 로그 api도 같은 함수): 대상 번호, 없으면 예약 = `SO-… 품목 1 · 6매`(after_data), 초안 = `초안 #id`, 그 밖 = `#id`.

## 16. 시드 (`client/src/mock/seeds/`)

등록 순서(`seeds/index.ts`, 내가 관리): `inspectionStandards` → `core` → (병합 단계에서 그 아래에 seedAdmin·seedMaster·seedCollab … 등록). `MOCK_DB_VERSION`은 2로 올렸다(2026-10-02 원료 입고량을 바꿔 5, 밀시트 스냅샷 키 이름(`heatNo`·`slabNo`)을 바꿔 지금은 6).

### 16-1. 검사 기준 (`inspectionStandards.ts`, 버전 1·현재)

| 코드 | 공정 | 항목 (모두 필수) |
|---|---|---|
| `QS-{SS275,SM355A~D,SPHC}-ST` (6개) | 제강(히트 성분, %) | C·Si·Mn·P·S 상한(KS). SM 계열 탄소당량 Ceq 0.47(50mm 이하 값). SPHC는 Si 없음. SM355C·D는 규격 시드가 없지만 KS 값이 있어 제강 기준만 넣었다 |
| `QS-{SS275,SM355A,SM355B,SPHC}-CC` | 연주(슬래브, mm) | **가정값**: 두께 편차 −5~+5, 폭 편차 −10~+10, 길이 편차 −10~+30, 표면 결함 깊이 0~2.00 |
| `QS-{SS275,SM355A,SM355B,SPHC}-HR` | 열연(코일) | 항복강도(두께 구간, SPHC 없음)·인장강도·연신율(두께 구간) KS, 샤르피 27J 이상(SM355A 20℃·B 0℃, 두께 6 초과), 두께 허용차(KS D 3500 표 5, 시드 코일 2.3/4.5/9.0mm 행: ±0.20/±0.28/±0.42, 구간 (2,2.5]/(4,5]/(8,10]), 너비 허용차 0~+25, 캠버 길이 2000mm당 5 이하. 코일 길이·표면 없음 |

- 검사 기준 화면의 버전 만들기 서비스는 검사 기준 영역이 만든다(`mock/services/inspectionStandards.ts`는 만들지 않았다). 판정은 `lib/inspectionJudgment.ts`. `INSPECTION_ITEM_SOURCE`(항목 코드 → 'KS' | 'ASSUMED')를 화면 표시에 쓸 수 있다.

### 16-2. 거래 시드 (`core.ts`, 서비스를 불러 만듦 — 2026년 9월, 고정 난수 시드)

| 대상 | 기록 | 상태 |
|---|---|---|
| 원료 확보 (**가정값**, 아래 "원료 입고량") | PR-2609-0001(직접) 승인 → PO-2609-0001~0004(공급업체별) → GR 5건 → RM-ORE01-260902-001(1800t)·260903-001(3200t), RM-COL01-260902-001(1900t), RM-LIM01-260902-001(480t), RM-SMN01-260903-001(20t) — 양은 `SEED_CORE.rawMaterialReceipts` | 모두 입고 완료 |
| **14.1 시작 재고** | SO-2609-001 가람중공업 SS275 슬래브 250×1200×10000 **4매** → PP-2609-0001(1히트) → 시뮬레이션(시드 1001) HM-BF2-260905-01 → **HT-BOF1-260905-001**(성분 C 0.18 등 합격) → 슬래브 -01~-10 합격 → 자동 예약 4·여재 6 → DR-2609-0001 FIFO 배정(-01~-04) → 출고 → **MS-2609-0001-1**(PDF 생성됨) | 남은 **HT-BOF1-260905-001-05 ~ -10 = 합격·미예약 6매**(예약 가용 6, surplus_at 있음) |
| 나래조선 | SO-2609-002 SM355A 슬래브 250×1500 **12매**(납기 10-15) → PP-2609-0002(2히트, 시드 2002) → 16매, **HT-BOF1-260914-001-03 표면 불합격(처리 상태 비어 있음)** → 예약 12, 여재 3 | 완료 |
| 다온건설(혼합) | SO-2609-003: ① SM355B 코일 4.5mm **6개** ② SM355B 슬래브 250×1200 **5매**(납기 10-14) | — |
| └ 코일 계획 | PP-2609-0003(1히트, 시드 3003) → 슬래브 8매(SL-SM355B-250x1500) 중 6매 합격·**2매 판정 대기** → 3매 열연 → 코일 3개 합격·자동 예약 3 | **진행중**, 열연할 적격 슬래브 3매 남음(필요 3) |
| └ 슬래브 계획 | PP-2609-0004: 제선(HM-BF2-260918-01)·제강(**HT-BOF1-260918-001, 판정 대기**)만 | **진행중, 연주 전** |
| └ 업무방 | "SO-2609-003 다온건설" 멤버 김도윤(연 사람)·박서영·정다은·강민석·오지훈, 시스템 메시지 + 메시지 3개(마지막: 정다은 "**실리코망가니즈 20톤 10월 20일까지 필요합니다**") | 안 읽은 메시지 있음 |
| └ 합금철 | PR-2609-0002(MRP, PP-2609-0004 연결) 승인 → PO-2609-0005(하람합금철, 납기 10-28) → GR 4.5t | **부분 입고**(입고예정 3.5t) |
| 여재 사용 | SO-2609-004 나래조선 SM355A 슬래브 **3매**(납기 **10-02**, 납기 위험) → 여재로 재고 우선 예약, 계획 없음 | 예약 3 |
| 배정 대기 | DR-2609-0002 SO-2609-002 6매(요청일 10-05) | REQUESTED, 배정 0 |
| 히트 불합격 | SO-2609-005 보람강관 SPHC 슬래브 220×1400 **8매** → PP-2609-0005(시드 5005) → 슬래브 10매 표면 합격, **HT-BOF1-260924-001 성분 불합격(P 0.058)** → 10매 히트 불합격 제외 | 계획 완료, **재생산 필요 8** |
| 구매요청 | PR-2609-0003 철광석 500t **승인(미발주)**, PR-2609-0004 석회석 80t **승인 대기**(최준혁 승인함) | — |

- 원료 잔량(시드 끝): 철광석 2,333.330t, 석탄 899.998t, 석회석 229.998t, 실리코망가니즈 1.000t(+ 입고예정 3.5t, 10-28).
- **원료 입고량 (가정값, 2026-10-02)**: 철광석 5,000t(09-02 1,800 + 09-03 3,200)·석탄 1,900t·석회석 480t·실리코망가니즈 20t. 시드 히트 6개가 철광석 2,666.670t·석탄 1,000.002t·석회석 250.002t를 쓰고 남은 양이 위 잔량이다. 히트 1개 = 용선 277.778t = 철광석 444.445·석탄 166.667·석회석 41.667t라서 **14.1 히트 1개 뒤에도 철광석·석탄·석회석을 사지 않고 히트 4개를 더 만든다**(14.1 뒤 1,888.885 / 733.331 / 188.331t). 이유: 예전 양(3,300·1,250·320t)으로는 14.1 뒤 189 / 83 / 28t만 남아 14.2를 돌리려면 MRP → 구매요청 3건 → 승인 → 발주 → 입고를 먼저 해야 했다(2026-10-02 브라우저 점검). 실리코망가니즈는 14.1 3단계 MRP(합금철만 순소요 1.500t, 나머지 충분 — 04 14.1)를 지키려고 20t 그대로라, 14.1 뒤 합금철은 구매하거나 PO-2609-0005 남은 3.5t를 입고해야 한다. 시드 히트의 LOT 관계(어느 원료 LOT을 얼마 썼는지)는 그대로다(늘린 것은 09-03 철광석 LOT과 석탄·석회석 LOT의 양뿐). 시험 `tests/seedRawMaterials.test.ts`.
- **14.1을 그대로 하면**: SO-2610-001 10매 → 6매 ACTIVE + PP-2610-0001(부족 4, 1히트, 필요 용강 96.122t, 히트 톤 250t, 예상 여재 6) → MRP(10월) 실리코망가니즈만 순소요 1.500t(입고예정은 10-28 도착이라 10-20 필요일에 못 씀), 철광석·석탄·석회석은 충분 → … (테스트 `scenario141.test.ts`가 끝까지 재현).
- **14.2**: 코일·혼합 수주는 시드에 없는 SS275 코일(4.5mm)·슬래브 250×1500으로 시험. 철광석·석탄·석회석은 시드 잔량으로 충분하고(위 원료 입고량), 합금철(실리코망가니즈)만 구매·입고가 필요하다.
- 시드 사원(테스트 `EMPLOYEE_NO`): 영업 박서영 2103003 / 영업 부서장 김도윤 1608002 / 구매 정다은 2207005 / 구매 부서장 최준혁 1702004 / 생산 부서장 강민석 1401006 / 제선 윤성호 1709007 / 제강 장혜린 1804008·조은서 2402011 / 열연 한승우 2001010 / 품질 서민지 2205013 / 물류 권예진 2304015.
- 다른 영역 시드는 core 뒤에 실행된다. 위 기록(특히 SS275 6매, 메시지)을 바꾸지 않는다.

## 17. 테스트

- `client/src/lib/*.test.ts`(계산 9개 파일), `client/src/mock/services/tests/`:
  - `scenario141.test.ts` — 14.1 1~10단계 전부(23.550/235.500, 6 ACTIVE + 4 계획, 히트 편성, MRP 부족·입고예정, PR → 승인 → PO → 부분 입고 → RM LOT, 시뮬레이션·LOT 관계, 검사 → 자동 예약·여재, 재생산 불필요, FIFO 10 LOT, 출고 4 → CONVERTED 4/ACTIVE 6 → 6 → SHIPPED, 밀시트 2장·다른 히트 값·잠금, 정·역추적, 수주 타임라인, Message → ERP → 요청자 확정 → 부서장 승인).
  - `scenario142.test.ts` — 혼합 수주 라우팅, 코일 누적 수율, 판매 예약 비침범(INV-001), 배정 변경(사유), 슬래브 1 → 코일 1, 코일 검사 → 자동 예약, 시작 전 취소·진행 중 취소 → 완료 후 여재, 히트 연주 한도.
  - `seedRawMaterials.test.ts` — 시드 원료 잔량, 14.1 히트 뒤 철광석·석탄·석회석 구매 없이 히트 4개(14.1 3단계 MRP는 합금철만 1.500t 부족).
  - `quality.test.ts` — 두께 구간·경계·필수 누락, 기준 버전 유지, 수정 로그, 잠금, 히트 불합격 연쇄(배정 해제·부족분만 조정), 불합격 처리, 재생산(여재 먼저).
  - `errors.test.ts` — SO-001~004, MST-001, PUR-001~003, SHP-002·003, INV-001~004, COM-001~003, ACT-001(14.1), 반려·재요청, 공급업체별 발주, 원료 음수 차감 차단, 시뮬레이션 재현성, 업무방.
  - `tests/kit.ts` — `createKit()`(새 시드 + 시각별 tx + 사원·품목 찾기 + `inspect` + `expectClean`), `stockRawMaterials`.

## 가정값 (6개 문서에 값이 없어 정한 것 — 사용자 확인 필요)

| 항목 | 값 | 이유·근거 |
|---|---|---|
| 시스템 메시지 보낸 사람 | `message.sender_id = 0` (`SYSTEM_SENDER_ID`) | ERD message에 시스템 표시 칸이 없고 sender_id NN. 실제 DB에서는 시스템 사원 행 또는 nullable이 필요 |
| 검사 기준 코드 공정 약어 | ST 제강 · CC 연주 · HR 열연 | 예시는 QS-SM355A-HR 하나뿐 |
| 연주(슬래브) 검사 항목·범위 | 두께 편차 ±5, 폭 편차 ±10, 길이 편차 −10~+30, 표면 결함 깊이 ≤ 2.00 mm | KS 없음("사내 규격"), PLAN 8-1 #1 |
| 히트 성분 판정 두께 | SM355 C·Ceq는 50mm 이하 값 | PLAN 8-1 #3 |
| 두께 허용차 구간 저장 | 표 5(이상~미만)를 초과~이하로 저장, 시드 코일 두께 행만 | 시드 두께가 경계가 아니라 결과가 같다(PLAN 8-1 #4) |
| 판정: 필수 누락과 불합격이 같이 있을 때 | FAIL | 벗어난 값이 이미 있으면 합격할 수 없다 |
| 기준 버전 선택 | 값을 한 번이라도 넣은 검사는 그 버전 유지, 값 없는 PENDING 행은 현재 버전으로 바꿔 판정 | "판정에 쓴 기준 버전 표시" + "새 버전" (QC-002·003) |
| 검사 대상 행 | 제강·연주·열연 실적 때 현재 기준으로 PENDING 행을 만든다 | 검사 대상 목록 |
| 생산계획 COMPLETED | 히트 수만큼 제강·연주 완료 + (코일·수주 연결) 불합격을 뺀 코일 수 ≥ 부족 매수 | 10장 "완료" 조건이 문서에 없음 |
| 진행 계획 잔여 목표 | 5장 정의 | 4.5 "진행 계획 잔여 목표"의 계산 방법이 없음 |
| 생산계획 생성 주체 | 이벤트는 SYSTEM(수주 등록 규칙), created_employee_id는 수주 등록자 | 자동 생성 |
| 여재 표시(surplus_at) | 합격했지만 원래 수주가 이미 채워져 예약하지 못한 슬래브, 연결 끊긴 계획의 슬래브, 완료된 코일 계획의 남은 슬래브, 취소로 예약이 풀린 합격 슬래브 | REQ-INV-008 "미배정 합격 슬래브" — 예약이 매수 단위라 LOT 단위 표시 기준을 정함 |
| 충족 현황 '검사합격' | ACTIVE 예약 + 출고 (분모 수주 매수) | 4.5 "분모 명시". 예약은 모두 합격 제품 |
| 품질 불합격 뒤 예약 조정 순서 | 불합격 LOT 계획의 수주 예약 → 열연 배정 → 그 밖의 예약 (모두 최근 것부터) | BP-QC-01 "부족분만 조정"의 순서가 없음 |
| 열연 배정과 예약 가용 | 열연 CONFIRMED 배정은 모두 "예약으로 커버되지 않는" 배정 | 열연 추천이 판매 예약 몫을 넘지 않음(BP-INV-01) |
| MRP 필요일 | 연결 수주 품목 납기(없으면 계획 등록일) | 리드타임 기준이 문서에 없음 |
| MRP 계획 몫 입고예정 | 그 계획에 남은 소요가 있을 때만 그 계획 전용, 아니면 누구나 | REQ-PRD-005 "다른 수주의 입고예정에서 제외" |
| 발주 | 요청 품목 1줄 = 발주 1줄, 발주량 = 요청 톤(나눠 발주 없음), 납기 기본 = 가장 이른 희망 입고일 | BP-PUR-01 "배분량 보존" |
| 구매요청 재요청 | 반려된 요청만 요청자가 고친다. 이벤트는 PURCHASE_REQUISITION_CREATED + reasonText | 재요청 이벤트 유형이 없음 |
| 부서장 자기 요청 승인 | 막지 않는다 (16장 TBD) | 문서에 대체 경로가 확정되지 않음 |
| 같은 MRP 줄 중복 | (계획, 원료) 구매요청이 상태와 관계없이 하나라도 있으면 새로 못 만든다(반려면 고쳐 재요청) | BP-PRD-01 "중복 생성 안 함" |
| 실적 시뮬레이션 시각 | 지금 끝나도록 거꾸로: 제선 4h·제강 1h·연주 2h·열연 2h | 시연용 |
| 시뮬레이션 제선 | 사용 가능한 용선이 히트 1개 몫보다 적을 때만 | 용선 재고를 먼저 쓴다 |
| 고로·전로 코드 형식 | 대문자·숫자 2~10자 (기본 BF2·BOF1) | 설비 마스터 없음 |
| 히트 LOT 잔량 | null (initial_ton = 히트 톤). 연주 한도는 initial_ton으로 계산 | ERD "원료·용선 잔량" |
| 히트→슬래브·슬래브→코일 input_ton | 슬래브 1매 이론중량 | 추적 화면 표시용 |
| 출하 작업 로그 | 출하요청 등록·출고 확정은 수주마다 한 건 | 수주 타임라인(REQ-LOG-003) |
| 원료 투입 LOT 범위 | 실적 완료일까지 입고(생산)된 LOT만 | 시점이 뒤인 LOT을 쓰지 않게 |
| 초안 중복 생성 | 같은 메시지·유형에 반려되지 않은 초안이 있으면 그 초안을 돌려준다 | BP-ACT-01 중복 방지 |
| 초안 원료 필드 | `payload = {itemId, requiredTon, desiredReceiptDate, requestReason, sourceText}` | REQ-ACT-001 |
| 시드 측정값 | 기준 안 대표값(`typicalPassValue`) + 히트별 성분 값, 불합격 사례 값(표면 3.50mm, P 0.058) | PLAN 8-1 #5 |
| 시드 날짜·사람·수량 | 16-2 표 | 시연용 |
| 시드 원료 입고량 | 철광석 5,000t(1,800 + 3,200)·석탄 1,900t·석회석 480t·실리코망가니즈 20t → 시드 끝 잔량 2,333.330 / 899.998 / 229.998 / 1.000t | 14.1 히트 뒤에도 원료 구매 없이 히트 4개를 더 만들어 14.2를 바로 돌리게(2026-10-02 브라우저 점검). 실리코망가니즈는 14.1 3단계 MRP 결과(합금철만 1.500t 부족)를 지키려고 그대로 |
| MRP 원료 줄의 공급 나누기 | '원료 LOT 잔량' 칸 = 표에 보이는 계획이 쓸 수 있는 잔량(표에 없는 앞선 계획이 먼저 쓴 몫 제외), '입고예정' 칸 = 보이는 계획이 필요일까지 받아 쓰는 몫. 나머지 입고예정은 다른 계획 몫 · 필요일 뒤 도착(납기 없음 포함) · 앞선 계획 몫 · 남는 몫으로 나눈다. 순소요가 남은 줄이 있으면 그 줄들이 쓰지 못한 까닭으로 이유를 정한다 | 4.4 "필요일까지 도착하는 확정 발주만", REQ-PRD-005 "다른 수주의 입고예정에서 제외". 한 줄의 숫자를 어떻게 보일지는 문서에 없음 — 표 한 줄이 "총소요 − 잔량 − 입고예정 = 순소요"로 읽히게 |

## 공유 파일 변경

- `client/src/mock/store.ts`: `MOCK_DB_VERSION` 1 → **2** (시드가 바뀜).
- `client/src/mock/seeds/index.ts`: `inspectionStandards`, `core` 등록, 병합 자리 주석.
- `client/src/mock/seed.test.ts`: "거래 데이터는 아직 없다" → "거래 시드는 불변조건을 지키고 모든 수주에 작업 로그" (시드가 생겼으므로).
- `client/src/mock/businessEvents.test.ts`: 거부 시험에서 이벤트 수를 0이 아니라 "시험 전과 같음"으로 비교.
- 새 파일만: `client/src/lib/{decimal,eligibility,inventoryMath,heatPlanning,mrp,fifo,inspectionJudgment,simulationLoss,salesOrderStatus}.ts`(+테스트), `client/src/mock/services/*.ts`(notifications.ts는 그대로), `client/src/mock/seeds/{core,inspectionStandards}.ts`.

## 확인이 필요한 것 / 남은 일

1. **시스템 메시지 표시**: 메신저 영역은 `senderId === SYSTEM_SENDER_ID(0)`을 '시스템'으로 그려야 한다(안 읽은 수에도 들어간다). DB 설계 때 시스템 사원 또는 sender_id nullable 결정 필요.
2. 검사 기준 화면 영역이 seed한 기준(16-1)을 그대로 쓰는지, 별도 시드를 만들었다면 병합 때 하나로 합쳐야 한다(코드 `QS-*-ST/CC/HR`).
3. 9.3에 없는 거부(밀시트 발행 뒤 측정값 수정, 원료 잔량 부족, 이미 취소·완료된 대상 등)는 InputError(코드 없음)로 던진다. 코드를 새로 둘지 팀 결정 필요.
4. 시드 마스터의 히트 용량(250t)·슬래브 중량에서는 히트당 슬래브가 8~10매라 손실 매수는 늘 0이다(floor). 문서("소량 히트에서는 0매일 수 있다") 그대로이며, 화면은 샘플 손실률·손실 매수(0)를 보여 준다.
5. 열연이 시작된 코일 계획의 수주 취소(16장 TBD): 이미 만든 코일은 미예약 코일 재고로 남는다.
6. 부분 출고 뒤 잔량 취소(16장 TBD)는 9.3대로 SO-003으로 막는다.
