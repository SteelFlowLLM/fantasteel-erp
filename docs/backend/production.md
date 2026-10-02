# production — 생산계획·히트 편성·작업 실적·실적 시뮬레이션·재생산

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.
> 이름: "공정 실적"은 [03] TRM-047의 사용 금지 동의어다. 코드·화면 모두 "작업 실적"(`productionResult`)으로 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-PRD-001~004·006·007, REQ-LOT-001~004(실적으로 LOT 생성·관계·잔량 차감) |
| BP | BP-PRD-01 히트 편성, BP-PRD-02 제선·제강·연주 실적, BP-INV-01 열연 실적, BP-QC-01 재생산 부분([04] 6장), 4.4 계산식, 8장 BP-SEED-01 실적 시뮬레이션 |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `production_plan` | `production_plan_no`(PP-YYMM-NNNN), `sales_order_item_id`(수주 취소 시 null → 산출물은 여재), `item_id`(생산 규격), `shortage_qty`, `heat_count`(not null), `is_reproduction`, `production_plan_status`(PLANNED → IN_PROGRESS → COMPLETED, **PLANNED에서만 CANCELLED**). **MRP 소요량은 저장하지 않음** |
| 쓰기 | `production_result` | `production_plan_id`(**제선은 null**), `process_type`, `blast_furnace_code`·`converter_code`(CHECK `production_result_equipment_code_check`: 제선은 고로, 제강은 전로 필수), `started_at`, `completed_at`(null = 작업 중), `simulated_loss_rate`(시뮬레이션만, 0~0.05) |
| 쓰기 | `lot` | HOT_METAL·HEAT·SLAB·COIL 생성, RAW_MATERIAL·HOT_METAL `remaining_ton` 차감. CHECK `lot_type_columns_check`(유형별 필수값), `lot_remaining_ton_check`(≥ 0) |
| 쓰기 | `lot_relation` | unique `(parent_lot_id, child_lot_id)`, CHECK `lot_relation_self_check`. 원료→용선 PERIOD_BASED + `input_started_at`·`input_ended_at`, 나머지 ACTUAL_INPUT. `input_ton`은 원료→용선·용선→히트·합금철→히트 |
| 다른 모듈 경유 | `allocation`·`inventory` | 열연 투입 시 inventory 서비스로 CONSUMED·`on_hand −1`·`rolling −1` |
| 읽기 | `routing`, `spec_mapping`, `specific_consumption`, `production_setting`, `item`, `sales_order_item` | 계산 기준 |

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `production-plans` | 생산계획 목록 | `PRODUCTION_PLAN_CONFIRM` VIEW | |
| GET | `production-plans/:id` | 생산계획 상세 | `PRODUCTION_PLAN_CONFIRM` VIEW | |
| POST | `production-plans` | 재생산 계획 생성 | `PRODUCTION_PLAN_CONFIRM` USE | 일반 계획은 수주 등록 때 자동 생성. 여재·진행 계획 확인 후 생성 |
| POST | `production-plans/:id/heat-preview` | 히트 편성 미리보기 | `PRODUCTION_PLAN_CONFIRM` USE | 저장하지 않음 |
| POST | `production-plans/:id/confirm` | 히트 편성 확정 | `PRODUCTION_PLAN_CONFIRM` USE | 수율·배합·기준 누락 시 MST-001 |
| POST | `production-plans/:id/cancel` | 생산계획 취소 | `PRODUCTION_PLAN_CONFIRM` USE | PLANNED에서만 |
| GET | `production-results` | 작업 실적 목록 | `PRODUCTION_RESULT_CONFIRM` VIEW | |
| POST | `production-results` | 작업 실적 등록 | `PRODUCTION_RESULT_CONFIRM` USE | 🟡 작업 시작을 따로 기록할지 확인 |
| POST | `production-plans/:id/simulate-results` | 실적 시뮬레이션 | `PRODUCTION_RESULT_CONFIRM` USE | 난수 시드·손실률 저장 |

다른 초안 행(경로 `/api/…`): `POST production-plans`(생성, "수동 생성 필요한지 확인"), `PATCH :id/cancel`, `GET·POST :id/heat-plan`, `POST production-plans/reproduction`, `GET production-results/:id`, `POST production-results`(작업 시작) + `PATCH production-results/:id/complete`(완료·실적 등록), `POST :id/simulation`, 열연 후보·배정(`:id/hot-rolling/*`, inventory.md 3장).
[권한표]: 생산 USE, 영업·구매·품질·관리자는 계획 VIEW, 품질·관리자는 실적 VIEW.

## 4. 업무 규칙·계산

**히트 편성**([04] 4.4 그대로, REQ-PRD-002)

```
목표중량(t)   = 부족 매수 × 제품 1매 이론중량
필요 용강(t)  = 목표중량 ÷ 누적 계획수율(연주 × 열연)   (슬래브 수주는 연주 수율만, 열연 수율은 규격 매핑 계산값)
히트 수       = ceil(필요 용강 ÷ 히트 용량)
히트 톤(t)    = 히트 수 × 히트 용량   (초기 250t, 용강 기준, 설정값)
필요 용선(t)  = 히트 톤 ÷ 제강 계획 수율
```

- 열연 수율 = 코일 이론중량 ÷ 대응 슬래브 이론중량(저장 안 함). 같은 수율을 두 번 적용하지 않는다(4.4 구현 제안).
- `Prisma.Decimal`로 계산(Float·JS number 금지, [05] 7-2). 계산은 순수 함수(예: `heat-plan.calculator.ts`)로 두고 mrp 모듈이 같은 함수를 쓴다.
- 예(시드 수율 연주 0.98·제강 0.90, [04] 14.1): 부족 4매 × 23.550 = 94.200t ÷ 0.98 = 96.122t → 히트 1개, 히트 톤 250t, 필요 용선 277.778t.
- 수율·매핑·히트 용량이 없으면 `MST-001`(BP-PRD-01: 수율·배합·기준 단위가 없으면 확정하지 않는다).

**생산계획**

- 수주 등록 tx 안에서 sales-order가 `createPlanForShortage(tx, salesOrderItem, shortageQty, actor)`를 부른다. `item_id` = 수주 품목 규격, `heat_count`는 위 계산값(컬럼이 not null), PLANNED.
- `heat-preview`: 계산만. `confirm`: 다시 계산해 `heat_count` 저장. 상태 "편성 확정"은 두지 않는다(SPEC.md 5장 기본값).
- 취소: PLANNED만 → CANCELLED, 이 계획의 CONFIRMED 열연 배정 해제(inventory). 첫 실적 등록 후(IN_PROGRESS)는 취소 불가([06] PRODUCTION_PLAN_STATUS).
- 수주 취소 연동: PLANNED는 취소, IN_PROGRESS는 `sales_order_item_id = null`(여재 전환, SURPLUS_CONVERTED). 조업 중 물량은 연주·검사 후 적격 슬래브 여재가 된다(BP-SO-02 여재 전환 해석).
- 재생산(REQ-PRD-006): 수주 품목의 `추가 계획 필요 매수 = max(0, 현재 미확보 − 진행 계획 잔여 목표)`([04] 4.5)가 0보다 클 때만 `is_reproduction = true` 계획 생성. 여재로도 부족하고 진행 계획도 없을 때만 만든다(14.1-6).

**작업 실적**(BP-PRD-02 표, REQ-LOT-002·003)

| 공정 | 입력 | 처리 | LOT·관계 |
| --- | --- | --- | --- |
| 제선 | 고로 코드, 작업일시, 용선량(t) | 원료별 투입량 = 용선량 × 원단위(t/t)를 입고일(`goods_receipt.received_date`) FIFO로 원료 LOT에서 차감 | 용선 LOT `nextLotNumber(tx,'HOT_METAL',고로)`(HM-고로-YYMMDD-NN), 원료→용선 PERIOD_BASED(투입 기간 = 실적 시작~종료, 차감된 LOT만) |
| 제강 | 전로 코드, 계획, 투입 용선량 | 용선 LOT을 생산 순 FIFO로 차감. 합금철 = 히트 톤 × 원단위(kg/t) ÷ 1,000을 입고일 FIFO로 차감 | 히트 LOT `nextLotNumber(tx,'HEAT',전로)`(HT-전로-YYMMDD-NNN), 용선→히트 N:M·합금철→히트 ACTUAL_INPUT + `input_ton`. 성분 검사 대상 |
| 연주 | 히트, 규격, 슬래브 매수, 작업일시 | 매별 슬래브 생성, `produced_date` = 완료일(서울, `seoulDateOnly`) | 슬래브 `formatSlabNumber(heatNo, n)`(히트번호-SS), 히트→슬래브 1:N. 표면·치수 검사 대상 |
| 열연 | 계획(코일), CONFIRMED 열연 배정 | 배정 CONSUMED, 슬래브 LOT CONSUMED, `on_hand −1`·`rolling −1`(inventory) | 코일 `formatCoilNumber(slabNo)`(C + 슬래브번호), 슬래브→코일 1:1. 코일 검사 대상 |

- LOT의 `yard_id`는 품목 기본 야드(REQ-MST-008). 원료·용선 잔량은 음수가 될 수 없다(CHECK). 동일 실적 중복, 슬래브 번호 중복, 히트 생산량 초과 산출을 막는다(BP-PRD-02 예외).
- 한 tx에서 슬래브를 여러 매 만들 때는 첫 번호를 받은 뒤 순번을 직접 늘린다(`numbering.service.ts` 주석).
- 계보는 내부 LOT id로만 연결하고 번호를 파싱하지 않는다(BP-LOT-01).
- 첫 실적 등록 시 계획 PLANNED → IN_PROGRESS([06]).
- 히트 미판정 상태에서도 연주는 허용하되 미합격 히트 하위 제품의 예약·열연·출고는 막는다(16장 제안, inventory·shipment가 적격 검사).

**실적 시뮬레이션**(REQ-PRD-007, [04] 8장): 생산계획을 골라 실행. 계획 수율 고정, 재현 가능한 난수 시드, 연주에서만 0~5% 손실을 슬래브 매수 감소로 표현, 필요한 슬래브만 열연, 슬래브 1매 = 코일 1개(열연 추가 손실 없음).

```
손실 매수 = floor(계획 슬래브 매수 × 샘플 손실률)      실적 매수 = 계획 매수 − 손실 매수
```

샘플 손실률은 `production_result.simulated_loss_rate`에 저장. 랜덤 손실과 품질 불합격은 다른 이벤트로 기록한다(8장).

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| MST-001 | 수율·매핑·원단위·히트 용량 누락 |
| INV-001 | 열연 배정·투입 시 가용 부족(inventory) |
| INV-002 / INV-004 | 미합격 슬래브 투입 / 이미 투입된 슬래브 |
| COM-003 | 계획·히트·LOT 없음 |

| 이벤트 | actor | target | salesOrderId | lotIds |
| --- | --- | --- | --- | --- |
| PRODUCTION_PLAN_CREATED | USER(수주 등록자) | `production_plan` | 연결 시 채움 | - |
| PRODUCTION_PLAN_CANCELLED | USER | `production_plan` | 채움 | - |
| REPRODUCTION_PLAN_CREATED | USER | `production_plan` | 채움 | - |
| SURPLUS_CONVERTED | USER(수주 취소자) | `production_plan` | 채움(해제 전 수주) | - |
| PRODUCTION_STARTED | USER | `production_result` | 계획 연결 시 | - |
| PRODUCTION_RESULT_REGISTERED | USER | `production_result` | 계획 연결 시 | 투입 LOT + 산출 LOT |

## 6. 다른 모듈과의 경계

| 방향 | 상대 | 내용 |
| --- | --- | --- |
| 호출됨 | sales-order | `createPlanForShortage`, `detachOrCancelPlansForSalesOrderItem` (같은 tx) |
| 호출 | inventory | 열연 투입 소진, 계획 취소 시 열연 배정 해제 |
| 호출 | master-data | 라우팅·매핑·원단위·설정·기본 야드 |
| 읽힘 | mrp | 계획 목록 + 히트 계산 함수(export) |
| 읽힘 | inventory(자동 예약) | LOT → 실적 → 계획 → 수주 품목 |
| 읽힘 | quality | 검사 대상 LOT(히트·슬래브·코일) |

`ProductionService`(또는 계산기)를 `exports`에 넣는다.

## 7. 테스트

[05] 11장 필수: 이론중량·히트 계산(MRP와 같은 함수), 배정 소진. [04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 합금철 소요 계산 | 히트 톤 × kg/t ÷ 1,000 (MST-006, PRD-005) |
| 연주 시드 손실 | 계획 수율 고정, 0~5%, 열연 추가 손실 없음 (PRD-007) |
| 14.1-2 예시 | 4매 → 히트 1, 250t, 필요 용선 277.778t |
| 원료 잔량 | 제선 후 FIFO 순서로 차감, 음수 없음 |
| 계획 취소 | IN_PROGRESS면 거부 |

실행: `npm test -w @fantasteel/server -- production`(묶음 DB `fs_prod`).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 작업 시작 분리 | v1 행은 `POST production-results` 하나, 초안 행은 시작(POST)·완료(PATCH `:id/complete`)로 나눴다. ERD(`completed_at` null = 작업 중)와 PRODUCTION_STARTED 이벤트는 분리를 뒷받침한다 | [CSV], [ERD], [06] |
| 히트 편성 확정의 의미 | `heat_count`가 생성 때 이미 not null로 저장된다. confirm이 무엇을 바꾸는지(재계산 저장만?), 이벤트가 없음 | [ERD], [06] BUSINESS_EVENT_TYPE |
| 계획 슬래브 매수 | 시뮬레이션 손실식·연주 상한에 쓰는 "계획 슬래브 매수"의 정의가 없다(부족 매수? 히트 톤 × 연주 수율 ÷ 슬래브 중량?) | [04] 8장, BP-PRD-02 예외 |
| 히트 LOT `initial_ton` | 히트 톤(용량) vs 투입 용선 × 제강 수율 | [ERD] lot.initial_ton |
| 계획 COMPLETED 조건 | 언제 완료로 바꾸는지 정의 없음 | [06] PRODUCTION_PLAN_STATUS |
| 원료 부족 오류 코드 | 제선·제강 FIFO 차감 시 원료·용선 잔량 부족에 쓸 코드가 없다(INV-001은 제품 매수) | [04] 9.3 |
| 시뮬레이션 범위·주체 | 8장은 "검사·출하·로그 시계열 생성"까지 말하지만 검사·출하는 다른 모듈이다. 주체를 USER로 둘지 SYSTEM으로 둘지 미정([06] ACTOR_TYPE SYSTEM 예시에 없음) | [04] 8장, [06] |
| 재생산 전 여재 사용 | "가용 여재 확인 후 재생산"에서 여재를 먼저 예약할지(자동? 수동?) 정해지지 않았다 | [04] 3장 흐름, 14.1-5·6 |
| 제선과 계획 | `production_plan_id`가 제선은 null인데 시뮬레이션은 계획 단위로 제선부터 만든다 | [ERD], [04] 8장 |
| 수주 등록 중 MST-001 | 라우팅이 없으면 수주 등록 전체가 실패한다. 의도인지 확인 | [04] BP-PRD-01 |
| 계획 수동 생성 | 초안 행 "생산계획 생성(수동)"은 "확인 필요"로 남아 있다. v1 행은 재생산 전용 | [CSV] |
| 권한 표시명 | `PERMISSION_LABEL.PRODUCTION_RESULT_CONFIRM` = "공정 실적(…)"(06 그대로), 권한표·용어 사전은 "작업 실적". 06 표시명 수정 필요 | `shared/src/codes/index.ts`, [권한표] 6장, [03] TRM-047 |
