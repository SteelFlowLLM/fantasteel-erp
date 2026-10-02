# lot — LOT 조회·정·역추적

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

LOT을 **만드는** 일은 production(용선·히트·슬래브·코일)과 purchasing(원료)이 한다. 불합격 처리 상태 지정(`lots/:id/disposition`)은 quality 모듈이다. 이 모듈은 조회와 추적만 맡는다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-LOT-005(역추적·정추적). REQ-LOT-001~003의 구조를 조회로 보여 준다 |
| BP | BP-LOT-01 LOT 정·역추적([04] 6장) |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 쓰는 것 |
| --- | --- | --- |
| 읽기 | `lot` | `lot_no`, `lot_type`, `item_id`, `steel_grade_id`(히트), `production_result_id`, `goods_receipt_id`, `yard_id`, `lot_status`, `initial_ton`·`remaining_ton`, `produced_date`, `disposition_status`·`disposition_reason` |
| 읽기 | `lot_relation` | `parent_lot_id`(투입) → `child_lot_id`(산출), `lot_relation_evidence`, `input_ton`, `input_started_at`·`input_ended_at` |
| 읽기 | `quality_inspection` | 판정(`inspection_result`) — 적격 계산 |
| 읽기 | `allocation`(CONSUMED·SHIPMENT) → `shipment_request_item` → `shipment_request` → `sales_order_item` → `sales_order`, `mill_sheet` | 정추적 끝의 출하·수주 |
| 읽기 | `item`, `steel_grade`, `yard`, `production_result`, `goods_receipt` | 표시 |
| 쓰기 | 없음 | |

[ERD] 규칙:
- 합격 여부 컬럼(`is_passed`)이 없다([04] 11장과 다름). 판정은 `quality_inspection.inspection_result`, 적격 = 자기 검사 PASS + 상위 히트 PASS(쿼리로 계산).
- 관계: 원료→용선 PERIOD_BASED(FIFO로 차감된 LOT만, 기간 = 제선 실적 시작~종료), 용선→히트 N:M, 합금철→히트 ACTUAL_INPUT, 히트→슬래브 1:N, 슬래브→코일 1:1. CHECK `lot_relation_self_check`(자기 연결 금지), unique `(parent_lot_id, child_lot_id)`.
- **LOT 번호를 파싱해 계보를 만들지 않는다.** `lot_relation`의 내부 id로만 조회([ERD] lot_relation Note, [04] BP-LOT-01).
- 여재 = 적격 + AVAILABLE + CONFIRMED 배정 없는 SLAB LOT(저장 안 함).
- 출하 LOT 연결 테이블은 없다: `shipment_request → shipment_request_item → allocation(CONSUMED) → lot`([ERD] mill_sheet Note).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `lots` | LOT 목록 | 로그인만(LOT 추적은 전 역할) | |
| GET | `lots/:id` | LOT 상세 | 로그인만 | |
| GET | `lots/:id/trace` | LOT 정·역추적 | 로그인만 | 12.2 명시 `?direction=`. `lot_relation` 내부 id로 조회, 번호 파싱 금지 |

- 목록 필터(권장): `lotType`, `itemId`, `lotStatus`, `lotNo`(앞부분 검색), 페이징 `page`·`size`·`sort`([05] 5장).
- `:id`에는 `ParseIntPipe`를 붙인다.

## 4. 업무 규칙

**역추적**(TRM-072): 코일 → 슬래브 → 히트 → 용선 → 원료. 슬래브 출하는 코일 단계를 생략하고, 제강에 직접 투입된 합금철도 보여 준다(BP-LOT-01).

**정추적**(TRM-073): 원료·히트 → 영향받은 하위 LOT → 대상 수주·출하. N:M 용선 연결, 히트당 다수 슬래브, 슬래브당 코일 1개를 그대로 보존한다(REQ-LOT-005). 불합격 영향 범위 확인에 쓴다.

**구현**
- 3개 이상 테이블 조인·재귀라 TypedSQL로 둔다([05] 8장 "LOT 정·역추적"). 예: `prisma/sql/traceLotBackward.sql`, `traceLotForward.sql` — `WITH RECURSIVE`로 `lot_relation`을 따라가고, 방문한 id를 기록해 같은 LOT을 두 번 펼치지 않는다(`UNION` 사용). 정추적 끝에서 CONSUMED SHIPMENT 배정을 따라 출하요청·수주·밀시트를 붙인다.
- `npm run generate:sql -w @fantasteel/server`(로컬 DB 필요) 후 repository에서 `tx.$queryRawTyped(traceLotBackward(lotId))`.
- 응답의 각 연결에 근거 유형을 표시한다. PERIOD_BASED는 `input_started_at ~ input_ended_at`을 함께 보여 "정확한 실투입량"처럼 보이지 않게 한다(BP-PRD-02 기간 연결, BP-LOT-01 예외).
- `input_ton`·`remaining_ton` 등 톤은 소수 3자리 문자열.

**상세**: LOT 기본값 + 검사 판정·기준 버전 + 적격 여부(계산) + 불합격 처리 상태·사유 + 현재 CONFIRMED 배정 + 원료·용선 잔량.

**적격 계산 공용화**(권장): 적격 여부는 inventory(예약·배정), quality(자동 예약 트리거), shipment(출고 재검증), lot(조회)가 모두 쓴다. 한 곳에 TypedSQL(`getLotEligibility.sql`)과 함수를 두고 export한다. 이 모듈에 두면 다른 모듈이 `LotModule`을 import해 쓴다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-003 | 없는 LOT |
| COM-004 | `id`·`direction` 형식 오류 |

작업 로그: 기록하지 않는다(조회만). LOT 타임라인(REQ-LOG-003)은 business-event 모듈이 `business_event_lot`으로 조회한다.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| production·purchasing | LOT·관계를 만든다(이 모듈은 읽기만) |
| quality | `lots/:id/disposition`, `lots/rejected`(같은 `lots` 경로 공간을 씀 → 8장 경로 충돌) |
| inventory·shipment·quality | 적격 판단 함수를 공유(위 4장) |
| business-event | LOT 타임라인 |

## 7. 테스트

[05] 11장 필수 대상은 아니다. [04] 14.1-10 "LOT 정·역추적" 시연을 기준으로 권장:

- 코일 역추적: 코일 → 슬래브 → 히트 → 용선(여러 개) → 원료(PERIOD_BASED) + 합금철(ACTUAL_INPUT).
- 슬래브 출하 역추적: 코일 단계 없음.
- 원료 정추적: 같은 원료가 여러 용선·히트로 퍼지고, 출하된 LOT은 출하요청·수주까지 나온다.
- 같은 LOT이 여러 경로로 닿아도 한 번만 나온다.

실행: `npm test -w @fantasteel/server -- lot`(묶음 DB `fs_log`). 실적·입고 데이터를 테스트에서 직접 만든다(시드에 거래 데이터 없음).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| `/lots/rejected` 경로 충돌 | quality의 `GET lots/rejected`와 이 모듈의 `GET lots/:id`가 겹친다. `app.module.ts`에서 LotModule이 QualityModule보다 먼저 등록돼 `rejected`가 `:id`로 잡혀 `ParseIntPipe`에서 COM-004가 날 수 있다. [CSV]는 대안 경로 `/quality-inspections/rejected-lots`를 함께 제안했다 | [CSV] 불합격 LOT 목록 비고, `app.module.ts` |
| `direction` 값 | `?direction=`의 값(예: `backward`·`forward`)이 정의돼 있지 않다 | [04] 12.2 |
| 출하요청 번호로 추적 | BP-LOT-01 입력에 "출하번호"(SPEC 기본값: "출하요청 번호")가 있지만 API는 LOT id만 받는다 | [04] BP-LOT-01, `SPEC.md` 5장 |
| 번호 검색 | LOT 번호로 찾는 검색(목록 `lotNo` 필터 vs 별도 API) 미정 | [CSV] |
| 순환 방지 | CHECK는 자기 연결만 막는다. 긴 순환(A→B→A)은 생성 쪽(production)이 막아야 하고, 추적 쿼리도 방문 기록으로 방어한다 | [04] BP-LOT-01 예외, [ERD] |
| 정추적 범위 | 수주 해제된 계획 산출물(여재)·불합격 처리 상태를 결과에 어떻게 표시할지 정해지지 않았다 | [04] BP-LOT-01 |
