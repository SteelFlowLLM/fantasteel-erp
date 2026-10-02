# sales-order — 수주 등록·충족 현황·수주 취소

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-SO-001~006. 등록 트랜잭션에서 REQ-INV-001~003(재고 우선 예약)과 REQ-PRD-001(부족분 생산계획)을 함께 일으킨다 |
| BP | BP-SO-01 수주 등록·우선 예약·생산계획, BP-SO-02 부분 출하 상태·수주 취소([04] 6장), 4.1 매수·톤, 4.5 부족·진행률, 13.1·13.2 의사코드 |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `sales_order` | `sales_order_no`(SO-YYMM-NNN) unique, `customer_id`, `owner_employee_id`(담당 영업). **헤더 상태는 저장하지 않고 품목 상태로 계산** |
| 쓰기 | `sales_order_item` | `item_id`(슬래브·코일 규격), `ordered_qty` Int — CHECK `sales_order_item_ordered_qty_check`(≥ 1), `due_date`(품목 납기), `sales_order_item_status`(OPEN·PARTIALLY_SHIPPED·SHIPPED·CANCELLED). **톤은 저장하지 않음** |
| 같은 tx에서 다른 모듈이 씀 | `reservation`·`inventory`(inventory), `production_plan`(production), `allocation`(inventory) | 아래 6장 |
| 읽기 | `item`, `customer`, `reservation`, `shipment_request(_item)`, `production_plan`, `lot`, `quality_inspection` | 충족 현황·취소 검사 |

[ERD] 설계 결정: 납기는 수주 품목 단위(`sales_order_item.due_date`). [04] BP-SO-01 입력은 "고객사, 납기, 품목별 …"로 헤더 납기처럼 읽히지만 ERD를 따른다. 누적 출고 매수 컬럼도 없다 → CONVERTED 예약 합계로 계산한다.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `sales-orders` | 수주 목록 | `SALES_ORDER_CREATE` VIEW | 헤더 상태는 품목 상태에서 계산 |
| POST | `sales-orders` | 수주 등록 | `SALES_ORDER_CREATE` USE | 품목별 `itemId`·`orderedQty`만. SO-001·SO-002·INV-001. 하나의 트랜잭션 |
| GET | `sales-orders/:id` | 수주 상세 | `SALES_ORDER_CREATE` VIEW | 톤 = 매수 × 이론중량(서버 계산) |
| POST | `sales-orders/:id/cancel` | 수주 취소 | `SALES_ORDER_CANCEL` USE | SO-003·SO-004 |
| GET | `sales-orders/:id/fulfillment` | 수주 충족 현황 | `SALES_ORDER_CREATE` VIEW | 단계별 중복 없는 집계(4.5) |
| GET | `sales-orders/:id/reservations` | 수주 예약 조회 | `SALES_ORDER_CREATE` VIEW | [CSV] 도메인은 "재고·배정". 이 모듈 경로에 두고 조회는 inventory 서비스를 부른다 |

다른 초안 행: `PATCH /api/sales-orders/:id/cancel`(2행 중복). [05] 5장 "상태 변경은 `POST /:id/동작`"에 따라 POST로 만든다.
[권한표]: 영업 USE, 생산·물류·관리자는 `SALES_ORDER_CREATE` VIEW. 취소는 영업만 USE(관리자 VIEW).

## 4. 업무 규칙·계산

**등록**([04] 13.1·13.2)

1. 수량: `orderedQty`가 정수가 아니거나 1 미만이거나 없으면 `SO-002`("수량은 1 이상의 정수로 입력해 주세요"). 반올림·톤 → 매수 환산 금지(4.1).
   - 전역 ValidationPipe 실패는 `COM-004`가 된다. 14.3이 `SO-002`를 요구하므로 수량은 DTO에서 `@Allow()` 정도만 두고 service에서 검사해 `AppException('SO-002')`를 던진다.
2. `itemId`가 없거나 SLAB·COIL이 아니면 `SO-001`. `customerId` 없으면 `COM-003`. 담당 영업 = 로그인 사원.
3. `NumberingService.nextDocumentNumber(tx, 'SALES_ORDER')`로 번호를 받고 수주·품목 저장(톤 저장 안 함).
4. 품목마다(잠금 순서를 고정하려고 `itemId` 오름차순) inventory 서비스로 예약: `reserveQty = min(orderedQty, max(0, 가용))`, 부분 예약 허용(REQ-SO-003).
5. `orderedQty − reserveQty > 0`이면 production 서비스로 부족분 생산계획 생성(REQ-PRD-001).
6. 작업 로그 기록 후 응답. 톤(표시값) = `calcWeightTon(orderedQty, item.theoreticalWeightTon)`.

```
수주 톤(표시값) = 주문 수량 × 선택 규격의 1매 이론중량   (저장하지 않음)   [04] 4.1
```

**상태·충족 현황**([04] 4.5, REQ-SO-004·005)

```
미출하 매수        = 주문 매수 − 누적 출고 확정 매수            (누적 출고 = CONVERTED 예약 합계)
현재 미확보 매수   = max(0, 미출하 매수 − ACTIVE 예약 매수)
추가 계획 필요 매수 = max(0, 현재 미확보 매수 − 동일 수주 품목의 진행 계획 잔여 목표 매수)
```

- 생산중·검사합격·예약은 같은 제품의 다른 단계일 수 있으므로 더해서 주문보다 큰 "충족 매수"로 보이지 않는다. 지표의 포함 관계와 진행률 분모를 응답에 명시한다(4.5 구현 제안).
- 품목 상태: OPEN → PARTIALLY_SHIPPED → SHIPPED(출고 확정 때 갱신), 취소 시 CANCELLED([04] 10장). 헤더 상태는 품목 상태에서 계산(전부 CANCELLED면 취소, 전부 SHIPPED면 출하완료, 하나라도 출고가 있으면 부분출하 등).

**취소**(BP-SO-02, 9.3)

1. 출고된 매수가 있으면(CONVERTED 예약 존재) `SO-003`. 진행 중 출하요청(REQUESTED·ALLOCATED)에 이 수주 품목이 있으면 `SO-004`.
2. 한 트랜잭션에서: 품목 CANCELLED → ACTIVE 예약 RELEASED와 `reserved_qty − ACTIVE 합계`(inventory) → PLANNED 생산계획 CANCELLED(production) → IN_PROGRESS 계획은 `sales_order_item_id = null`로 해제해 산출물을 여재로(production, [ERD] 설계 결정) → 그 계획들의 CONFIRMED 열연 배정 해제(inventory).
3. 출고 완료분은 삭제하거나 재고를 되돌리지 않는다(BP-SO-02 예외).

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| SO-001 | 등록되지 않은 규격(없음·제품 아님) |
| SO-002 | 수량이 1 이상 정수가 아님(소수·0·음수·누락) |
| SO-003 (409) | 출고된 매수가 있는 수주 취소 |
| SO-004 (409) | 진행 중인 출하요청이 있는 수주 취소 |
| INV-001 | 예약 조건부 UPDATE 경합(아래 8장) |
| MST-001 | 생산계획 생성 시 수율·매핑 누락(production이 던짐) |
| COM-003 | 고객사·수주 id 없음 |

| 이벤트 | 기록 주체 | actor | target | salesOrderId | lotIds | 사유 |
| --- | --- | --- | --- | --- | --- | --- |
| SALES_ORDER_CREATED | 이 모듈 | USER | `sales_order` | 채움 | - | |
| RESERVATION_CREATED | inventory | USER | `reservation` | 채움 | - | STOCK_FIRST |
| PRODUCTION_PLAN_CREATED | production | USER | `production_plan` | 채움 | - | ORDER_SHORTAGE |
| SALES_ORDER_CANCELLED | 이 모듈 | USER | `sales_order` | 채움 | - | 입력 사유 |
| RESERVATION_RELEASED | inventory | USER | `reservation` | 채움 | - | ORDER_CANCELLED |
| PRODUCTION_PLAN_CANCELLED | production | USER | `production_plan` | 채움 | - | ORDER_CANCELLED |
| SURPLUS_CONVERTED | production | USER | `production_plan` | 채움 | - | SURPLUS_CONVERSION |
| ALLOCATION_RELEASED | inventory | USER | `allocation` | 채움 | 해제 LOT | ORDER_CANCELLED |

기록은 `businessEventRecorder.record(tx, {...})`로 본 거래와 같은 tx에서 한다([05] 6장). 사유 코드는 [04] 9.3 제안값 + 사람이 읽을 문장.

## 6. 다른 모듈과의 경계

| 방향 | 상대 | 함수(권장 이름, 모두 `tx` 첫 인자) |
| --- | --- | --- |
| 호출 | inventory | `reserveForSalesOrderItem`, `releaseForSalesOrderItem`, `listReservations` |
| 호출 | production | `createPlanForShortage`, `detachOrCancelPlansForSalesOrderItem` |
| 호출 | master-data | 품목·이론중량 조회 |
| 호출됨 | shipment | 출고 확정 후 `recalcItemStatus(tx, salesOrderItemId)` |
| 호출됨 | inventory(자동 예약)·production(재생산) | `getUnsecuredQty(tx, salesOrderItemId)`(현재 미확보 매수) |
| 읽힘 | messenger | 업무방 상단 수주 요약(REQ-MSG-001) |

트랜잭션은 이 모듈 service가 `this.prisma.$transaction(async (tx) => …)`로 열고 다른 모듈 service 함수에 `tx`를 넘긴다(중첩 트랜잭션 금지). 각 모듈은 service를 `exports`에 넣고, 이 모듈이 `imports`한다. 순환 의존이 생기면(예: inventory ↔ sales-order) 계산 함수를 한쪽에 두거나 `forwardRef`를 쓴다.

## 7. 테스트

[05] 11장: **예약 로직은 서버 단위 테스트 필수**. [04] 14.3·14.2 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 23.550t 규격 10매 입력 | 허용, 235.500t 계산 표시, 톤은 저장 안 됨 (REQ-SO-002) |
| 10.5매·0매·음수·누락 | 거부, SO-002 |
| 합격 가용 6매에 10매 수주 | ACTIVE 6매 예약, 부족 4매 생산계획 (14.1-1) |
| 동일 규격 동시 주문 | ACTIVE 예약 합계 ≤ 가용 재고 (REQ-INV-009) |
| 부분 출고 | 품목 PARTIALLY_SHIPPED, 헤더 부분출하 (REQ-SO-005, shipment와 함께) |
| 생산 시작 전 취소 | 계획 CANCELLED, 예약 RELEASED (14.2) |
| 연주 진행 중 취소 | 계획의 수주 연결 해제, 완료 후 여재 (14.2) |
| 출고 후 취소 / 출하요청 진행 중 취소 | SO-003 / SO-004 |

실행: `npm test -w @fantasteel/server -- sales-order`(묶음 DB `fs_sales`, inventory·shipment와 같은 DB).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 중복 등록 방지 | [04] 13.2 `claimRequestId`, [CSV] "Idempotency-Key 적용 후보"지만 ERD에 요청 키 테이블이 없고 헤더 이름·범위가 미정이다. [03]은 "멱등성"을 제외 용어로 뒀다 | [04] 12.2·13.2, [CSV], [ERD], 08 공통 규약 |
| 진행률 계산식 | 화면마다 다르다(출하 ÷ 주문 vs (예약+검사합격+출하) ÷ 주문). 하나로 정해야 한다 | [CSV] 수주 충족 현황 비고 |
| 등록 시 INV-001 | 부분 예약을 허용하므로 가용 부족은 오류가 아니다. 조건부 UPDATE가 경합으로 0행이면 가용을 다시 읽어 재시도할지, INV-001로 실패시킬지 정해야 한다 | [CSV] 수주 등록 비고, [ERD] Project Note |
| 진행 계획 잔여 목표 매수 | 4.5 식에 쓰지만 계산 방법(계획 부족 매수 − 이미 자동 예약된 매수 등)이 정의돼 있지 않다 | [04] 4.5 |
| 부분 출고 후 잔량 취소 | TBD. 지금 규칙(SO-003)은 출고가 하나라도 있으면 전체 취소를 막는다 | [04] 16장, 9.3 |
| 열연 시작 후 수주 취소 | TBD(미열연은 슬래브 여재, 열연 후 코일은 별도 결정) | [04] 16장 |
| 이미 취소된 수주 재취소 | 상태 전이 위반용 오류 코드가 9.3에 없다 | [04] 9.3 |
| 취소 사유 | `sales_order`에 사유 컬럼이 없다. 작업 로그 `reason`에만 남긴다 | [ERD] |
| 동시성 구현 | 예약 조건부 UPDATE는 컬럼 간 비교라 Prisma Client로 표현이 어렵다 → TypedSQL(`prisma/sql/*.sql`, `npm run generate:sql -w @fantasteel/server`, DB 필요)로 만든다 | [05] 8장 |
