# inventory — 재고·예약·배정

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

이 모듈은 `inventory`·`reservation`·`allocation` 세 테이블을 **혼자** 바꾼다. 수주·품질·생산·출하 모듈은 이 모듈 service 함수를 `tx`와 함께 불러서 예약·배정·재고를 바꾼다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-INV-001~009 (REQ-INV-010 정합성 보정 배치는 P2라 제외) |
| BP | BP-INV-01 열연 배정(배정 부분), BP-INV-02 동시성 통제(P1 부분), 4.2 예약·배정, 4.3 합격 재고·여재, 13.2 `confirmAllocation` |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `inventory` | 제품(슬래브·코일)만, `item_id` unique. `on_hand_qty`(적격·미소진·미출고 매수), `reserved_qty`(ACTIVE 예약 합계), `rolling_allocated_qty`(열연 CONFIRMED 배정 합계). CHECK `inventory_available_qty_check`: `on_hand − reserved − rolling ≥ 0` |
| 쓰기 | `reservation` | `sales_order_item_id`, `item_id`, `reserved_qty` — CHECK `reservation_reserved_qty_check`(≥ 1), `reservation_status_check`(ACTIVE·CONVERTED·RELEASED). 만료 없음 |
| 쓰기 | `allocation` | `lot_id`, `allocation_purpose`(SHIPMENT·HOT_ROLLING), SHIPMENT면 `shipment_request_item_id`만·HOT_ROLLING이면 `production_plan_id`만(CHECK `allocation_purpose_columns_check`). 부분 unique `allocation_confirmed_lot_key`(LOT당 CONFIRMED 1건 → 전역 필터가 `INV-003`으로 바꿈). 추천은 저장하지 않음 |
| 읽기 | `lot`, `quality_inspection`, `lot_relation`, `item`, `spec_mapping`, `shipment_request_item`, `production_plan`, `production_result`, `sales_order_item` | 적격 계산·추천·자동 예약 대상 찾기 |

**[ERD] inventory 갱신 규칙**(본 거래와 같은 트랜잭션, 이 모듈 함수가 처리):

| 이벤트 | on_hand | reserved | rolling | 조건 | 부르는 모듈 |
| --- | --- | --- | --- | --- | --- |
| 수주 등록 예약 | | +n | | 가용 ≥ n | sales-order |
| 제품이 적격이 됨 | +1 | | | | quality |
| 자동 예약 | | +1 | | 가용 ≥ 1 | quality(적격 처리 안에서) |
| 적격 LOT이 FAIL로 바뀜 | −1 | 초과분 예약 축소 | 배정 있으면 −1 | 배정 RELEASED | quality |
| 열연 배정 확정 | | | +1 | 가용 ≥ 1 | 이 모듈 API |
| 열연 배정 해제·변경 | | | −1 | | 이 모듈 API, sales-order·production(계획 취소) |
| 열연 투입 | −1 | | −1 | | production |
| 출고 확정 | −n | −n | | 예약 CONVERTED 분할 | shipment |
| 수주 취소 | | −ACTIVE 합계 | | | sales-order |

조건부 UPDATE에서 바뀐 행이 0이면 `INV-001`. 불변조건: `on_hand_qty` = 적격 AVAILABLE LOT 수, `reserved_qty` = ACTIVE 예약 합계, `rolling_allocated_qty` = HOT_ROLLING CONFIRMED 배정 수([ERD] Project Note).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `inventories` | 재고 조회 | 로그인만(재고 메뉴는 전 역할) | `?itemId=`. 원료 재고는 원료 LOT 잔량 합계(TRM-054) |
| POST | `allocations/recommend` | 배정 추천 | 목적별 USE ↓ | 저장하지 않고 작업 로그(ALLOCATION_RECOMMENDED)만 |
| POST | `allocations` | 배정 확정 | 목적별 USE ↓ | INV-001~004. LOT당 CONFIRMED 1건 |
| POST | `allocations/:id/release` | 배정 해제·변경 | 목적별 USE ↓ | CONSUMED 배정은 변경 불가 |
| GET | `allocations` | 배정 조회 | 목적별 VIEW ↓ | |

- 목적별 권한: SHIPMENT = `SHIPMENT_REQUEST_MANAGE`(영업 USE, 물류·관리자 VIEW), HOT_ROLLING = `HOT_ROLLING_ALLOCATE`(생산 USE, 관리자 VIEW). 데코레이터 하나로 OR 조건을 표현할 수 없으므로 데코레이터 없이 service에서 `hasPermission(user, { permission, level })`(`common/auth/auth.guard.ts` export)로 확인하고 아니면 `COM-002`.
- 다른 초안 행: `GET /api/allocations/recommendations`, `PATCH /api/allocations/:id`(변경), `PATCH /api/allocations/:id/release`, 생산 쪽 `GET /api/production-plans/:id/hot-rolling/candidates`·`POST …/hot-rolling/allocations`. [CSV] 비고가 "같은 API를 쓸지 생산 쪽과 맞춰야 함"이라 했다. 이 문서는 12.2 명시 경로(`allocations/*`, `purpose` 구분)를 기준으로 한다 🟡.

## 4. 업무 규칙·계산

**가용 매수**([ERD] 설계 결정 — 04·05와 다름, ERD를 따른다)

```
가용 = on_hand_qty − reserved_qty − rolling_allocated_qty
```

- [04] 4.2 원식은 `미소진 합격 매수 − ACTIVE 예약 − ACTIVE 예약으로 커버되지 않는 열연용 CONFIRMED 배정`, [05] 8장 예시는 `on_hand − reserved`만 본다. ERD는 열연 배정을 모두 뺀다.
- 조건부 UPDATE는 TypedSQL로 만든다(컬럼 간 비교, [05] 8장). 예: `prisma/sql/reserveInventoryQty.sql`

```sql
-- 가용 매수 안에서 예약 매수를 늘린다. 반환 행이 없으면 INV-001
-- @param {Int} $1:itemId
-- @param {Int} $2:qty
UPDATE inventory SET reserved_qty = reserved_qty + $2, updated_at = now()
WHERE item_id = $1 AND on_hand_qty - reserved_qty - rolling_allocated_qty >= $2
RETURNING id;
```

`npm run generate:sql -w @fantasteel/server`(로컬 DB가 떠 있어야 함) 후 repository에서 `tx.$queryRawTyped(reserveInventoryQty(itemId, qty))`로 부른다. `$queryRaw` 인라인·`$queryRawUnsafe`는 금지([05] 8장).

**적격**([02] REQ-INV-003·007, [ERD] lot·quality_inspection Note): 슬래브 = 자기 검사 PASS + 부모 히트 PASS, 코일 = 자기 검사 PASS + 슬래브를 거친 히트 PASS. `lot.is_passed` 컬럼은 없다(04 11장과 다름) → `lot_relation` 조인 쿼리로 계산(TypedSQL 권장). 불합격 LOT과 불합격 히트 하위 LOT은 예약·배정 대상이 아니다.

**예약**(4.2)

- 수주 등록: `reserveQty = min(orderedQty, max(0, 가용))` → ACTIVE 예약 1행 + `reserved_qty += reserveQty`(같은 tx, [05] 6장 [강제]).
- 자동 예약(REQ-INV-004): LOT이 적격이 되면 `lot.production_result_id → production_result.production_plan_id → production_plan.sales_order_item_id`로 원래 수주 품목을 찾고([ERD] lot Note), 그 품목의 `item_id`가 LOT과 같고 현재 미확보 매수 > 0이면 1매 예약(가용 ≥ 1 조건). 계획이 수주에서 해제됐으면(null) 예약하지 않는다 → 여재. 주체 SYSTEM.
- 출고 전환(shipment가 부름): ACTIVE 10매 중 4매 출고 → ACTIVE 6 + CONVERTED 4로 행을 나눈다([04] 10장). `on_hand −n`, `reserved −n`.
- 해제(sales-order가 부름): ACTIVE → RELEASED, `reserved −합계`. CONVERTED 이력은 유지.

**배정**(REQ-INV-006, BP-INV-01, 13.2)

| 단계 | SHIPMENT | HOT_ROLLING |
| --- | --- | --- |
| 대상 규격 | 출하요청 품목의 `sales_order_item.item_id` | `spec_mapping.slab_item_id` (코일 = `production_plan.item_id`) |
| 필요 매수 | 미배정 매수 = `request_qty − 이 품목 CONFIRMED 배정 수`([ERD] shipment_request_item Note) | 계획의 필요 슬래브 매수 − 이미 CONFIRMED·CONSUMED된 열연 배정 🟡 |
| 후보 | 적격 + `lot_status = AVAILABLE` + CONFIRMED 배정 없음 | 같음 + 가용 매수 안에서(타 수주 예약 비침범) |
| 정렬(FIFO) | `produced_date` 오름차순, 동률은 `lot_no`(16장 제안) | 같음 |
| 확정 시 재고 | 변화 없음(예약 안에서 배정) | 조건부 UPDATE `rolling +1`(가용 ≥ 1) |

- 추천: 저장하지 않고 ALLOCATION_RECOMMENDED만 기록(`lotIds` = 추천 LOT, 사유 FIFO_RECOMMENDATION).
- 확정 재검증: 적격 아님 `INV-002`, 이미 CONFIRMED `INV-003`(부분 unique가 최종 방어), CONSUMED·SHIPPED `INV-004`. 같은 슬래브를 판매·열연에 동시에 배정할 수 없다.
- 출하 배정 후 출하요청의 모든 품목 미배정 = 0이면 출하요청 ALLOCATED(shipment 함수 호출).
- 해제: CONFIRMED → RELEASED(HOT_ROLLING이면 `rolling −1`). CONSUMED면 `INV-004`. 변경 = 기존 해제 + 새 확정을 같은 tx에서 → ALLOCATION_CHANGED.
- 소진(shipment·production이 부름): CONFIRMED → CONSUMED.

**재고 조회**(REQ-INV-001·008, 4.3): 제품 규격별 on_hand·reserved·rolling·가용 매수와 톤 계산값(`calcWeightTon`). 여재 = 적격 + AVAILABLE + CONFIRMED 배정 없는 SLAB LOT(저장 안 함). 원료는 RAW_MATERIAL LOT `remaining_ton` 합계(소수 3자리). 다른 수주에 ACTIVE 예약된 매수를 자유 재고로 보이지 않는다.

**재고 조회 구현 메모** (`GET inventories`, 로그인만, `?itemId=`)

- 응답은 `{ products, rawMaterials }`다(shared `InventoryOverview`). `products`는 제품 규격마다 한 줄(재고 행이 없으면 0매)이고, 대시보드 위젯과 같은 `productStock` 계산에 `unallocatedPassedQty`(미배정 합격 LOT 수)를 더한다. `rawMaterials`는 원료 규격마다 잔량이 남은 원료 LOT의 `remaining_ton` 합계와 LOT 수다.
- `unallocatedPassedQty` = 적격(자기 검사 PASS + 상위 히트 PASS) + AVAILABLE + CONFIRMED 배정 없음(`countUnallocatedPassedLotsByItem.sql`). 수주 예약 몫도 들어 있어서 "여재" 매수가 아니다.
- 🟡 여재 매수는 만들지 않았다. 스키마에 여재 전환 시각이 없고 "수주 예약에 쓰이지 않은 몫"의 계산식이 정의돼 있지 않다.
- 불합격·판정 대기 LOT 수, LOT 목록은 `lots` 모듈 몫이라 이 응답에 넣지 않았다.

**동시성**(REQ-INV-009, BP-INV-02): 예약 매수는 조건부 UPDATE 한 줄, LOT 중복 배정은 부분 unique, 여러 행을 함께 검증하는 처리는 `SELECT … FOR UPDATE`(TypedSQL)로 잠근다([05] 8장). 잠금 순서는 inventory(item_id 오름차순) → reservation → allocation → lot(id 오름차순)으로 고정한다(13.2 "고정 순서").

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| INV-001 | 조건부 UPDATE 0행(가용 부족), 추천 대상 부족 |
| INV-002 | 제품 또는 상위 히트 미합격 |
| INV-003 | 이미 CONFIRMED 배정된 LOT |
| INV-004 | 이미 투입·출고된 LOT, CONSUMED 배정 변경 |
| COM-002 | 배정 목적에 맞는 권한 없음 |
| COM-003 | LOT·출하요청 품목·계획 없음 |

| 이벤트 | actor | target | salesOrderId | lotIds | 사유 |
| --- | --- | --- | --- | --- | --- |
| RESERVATION_CREATED | 수주 등록 USER / 자동 예약 SYSTEM | `reservation` | 채움 | 자동 예약은 해당 LOT | STOCK_FIRST / 자동 예약 |
| RESERVATION_CONVERTED | USER(출고 확정자) | `reservation` | 채움 | 출고 LOT | |
| RESERVATION_RELEASED | USER / SYSTEM(불합격 축소) | `reservation` | 채움 | - | ORDER_CANCELLED / QUALITY_FAILURE |
| ALLOCATION_RECOMMENDED | USER | `shipment_request_item` 또는 `production_plan` | 있으면 채움 | 추천 LOT | FIFO_RECOMMENDATION |
| ALLOCATION_CONFIRMED | USER | `allocation` | 있으면 채움 | 배정 LOT | |
| ALLOCATION_CHANGED | USER | `allocation` | 있으면 채움 | 이전·새 LOT | ALLOCATION_CHANGE |
| ALLOCATION_RELEASED | USER / SYSTEM(불합격) | `allocation` | 있으면 채움 | 해제 LOT | |

## 6. 다른 모듈과의 경계

`InventoryService`를 export한다. 권장 함수(모두 `tx` 첫 인자):

| 함수 | 부르는 모듈 |
| --- | --- |
| `reserveForSalesOrderItem`, `releaseForSalesOrderItem`, `listReservations` | sales-order |
| `onLotsEligibilityChanged(tx, lotIds, actor)` (적격이 됨·FAIL로 바뀜 + 자동 예약) | quality |
| `consumeHotRollingAllocation(tx, allocationId)` (열연 투입) | production |
| `releaseHotRollingAllocationsOfPlan(tx, planId)` | production·sales-order(계획 취소) |
| `consumeShipmentAllocations` + `convertReservations(tx, salesOrderItemId, qty)` | shipment |
| `releaseShipmentAllocationsOfRequest` | shipment(출하요청 취소) |
| 적격 판단 쿼리 | quality·shipment·lot(조회) — lot 모듈과 한 곳에 두는 것을 권장 |

`inventory` 행이 없으면 조건부 UPDATE가 항상 0행이다. 시드는 재고 행을 만들지 않으므로 "적격이 됨" 처리에서 `upsert`로 행을 만들거나 품목 등록 때 만든다 🟡.

## 7. 테스트

[05] 11장: **예약·배정 로직은 서버 단위 테스트 필수**. [04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 동일 규격 동시 주문 | ACTIVE 예약 합계 ≤ 가용 재고 (INV-009) |
| 열연·판매가 같은 슬래브 선택 | CONFIRMED 배정 하나만 성공 (INV-006·009) |
| 미합격 히트 하위 제품 | 예약·배정 차단 (INV-003·007) |
| 합격 생산분 | 원래 수주 부족분만 자동 예약 (INV-004) |
| 부분 출고 4매 | ACTIVE 6 + CONVERTED 4 (INV-005) |
| 판매 슬래브 예약을 열연 배정이 침범하지 않음 | 가용 0이면 열연 배정 INV-001 (14.2) |

실행: `npm test -w @fantasteel/server -- inventory`(묶음 DB `fs_sales`). 동시성은 같은 tx 밖에서 `Promise.all`로 두 요청을 보내 확인한다.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 가용 계산식 3종 | 04 4.2(커버되지 않는 열연 배정만 뺌), 05 8장(열연 배정 안 뺌), ERD(모두 뺌)가 다르다. ERD를 따르고 04·05 수정이 필요 | [04] 4.2, [05] 8장, [ERD] |
| 코일 계획용 슬래브 보호 | 코일 계획으로 만든 슬래브가 적격이 되면 공용 풀(`on_hand`)에 들어가 열연 배정 전에 다른 슬래브 수주가 예약할 수 있다. ERD에 이를 막는 컬럼이 없고 04는 "열연 배정이 판매 예약을 침범하지 않는다"만 정했다 | [04] 4.2·BP-INV-01, [ERD] |
| FAIL 시 줄일 예약 | "초과분 예약 축소"에서 어느 수주 품목의 예약을 줄일지(최근 예약부터? 해당 LOT 계획의 수주부터?) 정해지지 않았다 | [ERD] 갱신 규칙, [04] BP-QC-01 |
| 재고 행 생성 시점 | 시드에 `inventory` 행이 없다. 품목 등록 시 생성 vs 이 모듈 upsert | `seed.ts`, [ERD] |
| 열연 필요 매수 | 계획의 필요 슬래브 매수 정의(= `shortage_qty`? 손실 반영?)가 없다 | [04] BP-INV-01 |
| 배정 변경 API | v1 행은 `release`만, 초안 행은 `PATCH allocations/:id`. 변경 요청 모양(새 LOT id)을 정해야 한다 | [CSV] |
| 오류 코드 | LOT 규격 불일치, 미배정 매수 초과 배정에 쓸 코드가 없다(SHP-002는 "출하 가능 매수") | [04] 9.3 |
| 중복 요청 | 배정 확정 재시도 방지 키 미정(부분 unique가 LOT 중복은 막음) | 08 공통 규약 |
