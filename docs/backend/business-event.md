# business-event — 작업 로그 조회·이력 재현

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

**기록**은 이미 구현된 공통 서비스 `server/src/common/business-event/business-event.recorder.ts`(`BusinessEventRecorder`, CommonModule이 전역 제공)가 한다. 이 모듈은 **조회(이력 재현)** API를 만든다. 아래 4장 "기록 규칙"은 모든 모듈 담당자가 지킨다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-LOG-001(이벤트 기록), REQ-LOG-002(기록 대상), REQ-LOG-003(수주·LOT 타임라인) |
| BP | BP-LOG-01 작업 로그·이력 재현([04] 6장) |
| 등급 | P1 (AI 실행 카드·Agent 위험 감지 이벤트는 P2, 과거 사례 등록은 EX) |

## 2. 테이블

| 구분 | 테이블 | 핵심 컬럼 |
| --- | --- | --- |
| 읽기(이 모듈) / 쓰기(recorder) | `business_event` | `business_event_no`(EV-YYMMDD-NNN) unique, `business_event_type`(BUSINESS_EVENT_TYPE), `actor_type`(USER·SYSTEM), `actor_employee_id`(SYSTEM이면 null), `target_type`(대상 테이블명)·`target_id`, `sales_order_id`(수주 타임라인), `before_data`·`after_data` jsonb(**비밀번호 해시·토큰 저장 금지**), `reason`, `is_ai_assisted`, `action_draft_id`, `message_id`, `created_at`(발생 시각) |
| 〃 | `business_event_lot` | `(business_event_id, lot_id)` unique. 이벤트 1건에 LOT 여러 개(LOT 타임라인) |
| 읽기 | `employee`, `lot`, `sales_order` | 표시용 이름·번호 |

수정·삭제 함수는 두지 않는다(recorder 주석).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `business-events` | 작업 로그·이력 재현 조회 | 로그인만(작업 로그는 전 역할) | 12.2 명시 `?salesOrderId=`. 이벤트 유형은 BUSINESS_EVENT_TYPE |

- 쿼리(권장): `salesOrderId`(수주 타임라인), `lotId`(LOT 타임라인, REQ-LOG-003), `businessEventType`, `from`·`to`, 페이징 `page`·`size`. `lotId`는 [CSV]에 없지만 REQ-LOG-003 "수주·LOT 단위"를 위해 필요하다 🟡.
- 응답(권장): 번호, 유형 + 표시명(`BUSINESS_EVENT_TYPE_LABEL`), 주체 구분 + 사원 이름, 대상(테이블·id), 수주 번호, LOT 번호 목록, 변경 전·후, 사유, AI 경유, 원본 메시지·초안 id, 발생 시각.

## 4. 규칙

**조회**: 시간순(`created_at` 오름차순), 동률은 이벤트 id 순([04] BP-LOG-01). LOT 타임라인은 `business_event_lot`으로 조인한다. 3개 이상 조인이 되면 TypedSQL로 둔다([05] 8장).

**기록 규칙(모든 모듈)**

```ts
await this.businessEventRecorder.record(tx, {
  type: BUSINESS_EVENT_TYPE.SALES_ORDER_CREATED,
  actor: user,                         // 사람이면 AuthUser, 자동 예약·자동 판정 등은 'SYSTEM'
  target: { table: 'sales_order', id: salesOrder.id },   // ERD 테이블명
  salesOrderId: salesOrder.id,         // 수주 타임라인에 보이려면 채운다
  lotIds: [],                          // LOT 타임라인에 보이려면 채운다
  before, after,                       // 변경 전·후 (비밀번호 해시·토큰 금지)
  reason: 'STOCK_FIRST: 합격 재고 6매 예약',
});
```

- 본 거래와 **같은 트랜잭션의 `tx`**로 부른다. 이벤트 발행 방식은 쓰지 않는다([05] 6장 [강제]).
- 사용자가 확정한 일은 USER, 자동 예약·자동 판정 같은 시스템 처리는 SYSTEM([06] ACTOR_TYPE, BP-LOG-01).
- 사유는 [04] 9.3 제안 코드(STOCK_FIRST, FIFO_RECOMMENDATION, ORDER_SHORTAGE, ORDER_CANCELLED, QUALITY_FAILURE, SURPLUS_CONVERSION, ALLOCATION_CHANGE, DRAFT_CONFIRMED)와 사람이 읽을 문장을 함께 쓴다.
- Message → ERP로 생긴 기록은 `actionDraftId`·`messageId`를 채운다(REQ-LOG-001 "원본 메시지·Action Draft 연결"). `isAiAssisted`는 AI 초안 확정일 때만 true(REQ-AST-010, P2).

**이벤트 유형 ↔ 기록 모듈**([06] BUSINESS_EVENT_TYPE 29개)

| 유형 | 기록 모듈 | target | salesOrderId | lotIds |
| --- | --- | --- | --- | --- |
| SALES_ORDER_CREATED·CANCELLED | sales-order | `sales_order` | ● | |
| PRODUCTION_PLAN_CREATED·CANCELLED, REPRODUCTION_PLAN_CREATED, SURPLUS_CONVERTED | production | `production_plan` | 연결 시 ● | |
| PRODUCTION_STARTED, PRODUCTION_RESULT_REGISTERED | production | `production_result` | 연결 시 ● | 투입·산출 LOT |
| INSPECTION_REGISTERED, DISPOSITION_SET | quality | `quality_inspection` / `lot` | 연결 시 ● | 대상 LOT |
| RESERVATION_CREATED·CONVERTED·RELEASED | inventory | `reservation` | ● | 자동 예약·출고 시 LOT |
| ALLOCATION_RECOMMENDED·CONFIRMED·CHANGED·RELEASED | inventory | `allocation` 등 | 있으면 ● | 배정 LOT |
| PURCHASE_REQUISITION_CREATED·APPROVED·REJECTED, PURCHASE_ORDER_CREATED, GOODS_RECEIPT_CONFIRMED | purchasing | 각 테이블 | 계획이 수주에 연결되면 | 입고 원료 LOT |
| SHIPMENT_REQUEST_CREATED, GOODS_ISSUE_CONFIRMED, MILL_SHEET_ISSUED | shipment | 각 테이블 | ● | 출고 LOT |
| DRAFT_CREATED·CONFIRMED·REJECTED·EXECUTED | message-action | `action_draft` | | |

자동 예약은 RESERVATION_CREATED + SYSTEM, 불합격 판정은 INSPECTION_REGISTERED의 판정 결과로 구분한다([06]).

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-004 | 쿼리 형식 오류 |

이 모듈은 이벤트를 기록하지 않는다(조회만).

## 6. 다른 모듈과의 경계

- 모든 업무 모듈이 `BusinessEventRecorder`를 주입받아 기록한다(CommonModule이 `@Global`이라 import 불필요).
- notification: `notification.business_event_id`로 이벤트 기반 알림을 연결할 수 있다(부분 unique `notification_business_event_recipient_key`).
- (P3) 대시보드 "최근 작업 로그" 위젯이 이 조회를 쓴다.

## 7. 테스트

[05] 11장 필수 대상은 아니다. 권장:

- 같은 수주의 이벤트가 시간순·id순으로 나온다(REQ-LOG-003).
- `lotId` 필터가 `business_event_lot`으로 동작한다.
- recorder: 본 거래가 롤백되면 이벤트도 남지 않는다, `before`·`after`에 `passwordHash`가 없다.
- [04] 14.1-10: 수주 타임라인, 메시지 구매요청 초안·요청자 확정·부서장 승인 로그 확인.

실행: `npm test -w @fantasteel/server -- business-event`(묶음 DB `fs_log`).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 이벤트 번호 경합 | 모든 업무 tx가 기록할 때 `EV-YYMMDD-`의 "최댓값 + 1"을 받는다(카운터 테이블 없음). 동시에 두 tx가 기록하면 같은 번호 → unique 위반(P2002) → **본 거래 전체가 COM-001로 실패**한다. 업무 tx가 많을수록 자주 생긴다 | `common/numbering/numbering.service.ts`, [ERD] Project Note(번호 테이블 없음) |
| 하루 999건 한도 | EV 순번은 3자리(NNN)라 하루 1,000번째 이벤트에서 채번 함수가 Error를 던져 COM-999가 된다. 실적 시뮬레이션·시연 시드가 하루에 많은 이벤트를 만들 수 있다 | [04] 9.1, `number-format.ts` `seq` |
| `lotId` 필터 | [CSV]·12.2는 `salesOrderId`만 적었다 | [04] 12.2, REQ-LOG-003 |
| 빠진 이벤트 유형 | 구매요청 재요청, 출하요청 취소, 검사 측정값 수정, 히트 편성 확정에 맞는 유형이 없다. 추가하려면 REQ-LOG-002 → [06] 순서로 등록 | [06] BUSINESS_EVENT_TYPE, [CSV] 재요청 비고 |
| 여러 수주를 묶은 이벤트 | `sales_order_id`가 하나라 출하요청 이벤트를 수주별로 나눠 기록해야 한다(shipment.md 8장) | [ERD] |
| 조회 범위 | 작업 로그가 전 역할에 열려 있다. 권한 밖 데이터(예: 구매 금액이 생기면)를 거를지 | [CSV] 권한 |
