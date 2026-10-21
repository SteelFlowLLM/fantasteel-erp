# message-action — Message → ERP 업무 초안(Action Draft)

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-ACT-001~004. REQ-ACT-005 확장 유형(P2)은 2026-10-15 결정으로 만들었다(10장, 구현 11장) |
| BP | BP-ACT-01 Message → ERP 구매요청([04] 6장), BP-ACT-02 업무 유형 확장([04] 7장), 10장 Action Draft 상태, 12.3 업무 유형 등록 예시·유형 표, 13.4 의사코드 |
| 등급 | P1 (확장 유형은 P2) |
| AI | 2026-10-15 결정(SPEC.md 5장 결정 2): 초안을 만들 때 LLM이 메시지에서 고른 유형의 칸을 채운다(10장). LLM이 없거나 실패하면 지금처럼 요청자가 직접 입력한다. 아래 1~9장은 AI 추출 전의 구매요청 구현 기준이다 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `action_draft` | `action_type`(P1은 PURCHASE_REQUISITION_CREATE), `draft_status`(AI_GENERATED → WAITING_APPROVAL → APPROVED → EXECUTED, 반려 시 REJECTED), `payload` jsonb(추출 스키마 값), `message_id`(원본), `requester_id`(확정 주체 = 메시지 작성자), `confirmed_at`, `reject_reason`, `execution_error_code`, `execution_attempt_count` |
| 다른 모듈 경유 | `purchase_requisition` | `action_draft_id` **unique**로 결과를 연결(purchasing이 저장) |
| 읽기 | `message`, `chat_room_member`, `item` | 원본·방 멤버·원료 마스터 검증 |

- 부분 unique `action_draft_open_message_type_key`: `(message_id, action_type) WHERE draft_status IN ('AI_GENERATED','WAITING_APPROVAL','APPROVED')` — 같은 메시지·유형의 미처리 초안은 1건.
- CHECK `action_draft_status_check`: DRAFT_STATUS 5개 값.
- 실행 실패는 상태를 추가하지 않고 `execution_error_code`·`execution_attempt_count`로 남긴다([04] 10장).

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| POST | `messages/:id/action-drafts` | 메시지에서 구매요청 초안 생성 | 방 멤버 | 요청자는 메시지 작성자(AI가 지정하지 않음). 유형은 ACTION_TYPE. 확장 유형은 요청 본문 `actionType`(10장) |
| GET | `action-drafts` | 초안 목록 | 확정 주체 본인 | 상태는 DRAFT_STATUS |
| GET | `action-drafts/:id` | 초안 상세 | 확정 주체 본인 | |
| PATCH | `action-drafts/:id` | 초안 수정 | 확정 주체 본인 | 본문 `{ payload, expectedUpdatedAt }`. `payload` 칸은 유형 정의가 검증한다(2026-10-15) |
| POST | `action-drafts/:id/confirm` | 초안 확정·실행 | 구매요청 초안은 요청자 | 필수값 미확정 시 ACT-001. `actionDraftId`로 중복 실행 차단 |
| POST | `action-drafts/:id/reject` | 초안 반려 | 확정 주체 본인 | |
| POST ➕ | `action-drafts/:id/execute` | 확정했지만 실행에 실패한 초안 다시 실행 | 확정 주체 본인 | 명세에 없음(9장) |

기능 권한 데코레이터 대신 service에서 "방 멤버"·"`requester_id` = 로그인 사원"을 확인하고 아니면 `COM-002`.

## 4. 업무 규칙

**추출 스키마**(REQ-ACT-001, TRM-095): 원료 품목, 수량(톤), 희망 입고일, 요청자. payload 필드는 ERD 구매요청 컬럼에 맞춰 `itemId`, `requestedTon`, `desiredReceiptDate`로 둔다(12.3 예시는 `rawMaterialId`·`requiredTon`이지만 `required_ton`은 MRP 소요량 용어라 [ERD]가 `requested_ton`으로 구분했다). 요청자는 payload가 아니라 `requester_id` 컬럼.

**생성**
1. 메시지가 있고 로그인 사원이 그 방 멤버인지 확인(messenger 서비스).
2. `requester_id` = 메시지 `sender_id`(AI·생성자가 지정하지 않음, BP-ACT-01). `message_id` 연결.
3. 같은 메시지에 미처리 초안이 있으면 새로 만들지 않는다(부분 unique). 기존 초안을 돌려줄지 오류로 할지는 8장 🟡.
4. 상태: [04] 10장 흐름대로 AI_GENERATED로 만들고 요청자 확인 대기 WAITING_APPROVAL로 넘긴다. AI가 없으므로 payload는 비어 있을 수 있다(10장에서 바뀜: LLM이 칸을 채우고, 없거나 실패하면 비어 있다).

**수정**(PATCH): 요청자만, 확정 전(AI_GENERATED·WAITING_APPROVAL)만. 원료 마스터 매핑·단위(TON)·날짜를 검증하고, 상대 날짜는 메시지 작성일 기준 절대 날짜로 바꾼다(BP-ACT-01 예외). 모호·누락 값은 미확정 필드로 두고 실행하지 않는다.

**확정·실행**([04] 13.4)

```
confirm(draftId, actor):
  require(actor == draft.requester)                                  // 아니면 COM-002
  require(draft.status in (AI_GENERATED, WAITING_APPROVAL))           // 아니면 COM-004
  require(noUnresolvedFields)                                        // 아니면 ACT-001
  require(purchasing.canRequest(actor))                              // 승인권자 없음 → PUR-001 (9장)
  validatePayloadAgainstCurrentMaster()                              // 원료 품목·톤 > 0·날짜
  draft.status = APPROVED, confirmed_at = now
  pr = purchasing.createRequisition(tx, payload, actor, { actionDraftId, messageId })  // WAITING_APPROVAL
  draft.status = EXECUTED
```

- 확정(APPROVED·DRAFT_CONFIRMED)과 실행(구매요청 생성·EXECUTED)은 트랜잭션을 나눈다. 실행이 실패하면 실패 코드·시도 횟수를 남기고 APPROVED로 둔다(9장). 생성된 구매요청은 별도로 요청자 소속 부서장 승인을 거친다(REQ-ACT-003 "두 승인의 구분"). 부서장이 없으면 핸들러가 `PUR-001`.
- 중복 실행은 상태 검사 + `purchase_requisition.action_draft_id` unique로 막는다.

**반려**: 요청자만, 확정 전만. `reject_reason` 저장, REJECTED로 끝([06] DRAFT_STATUS).

**업무 유형 등록 구조**(REQ-ACT-004, 12.3): 유형별로 `{ type, schema(검증기), confirmer, handler }`를 등록하는 레지스트리를 둔다. 구현은 `action-types/`: 유형 정의 `ActionDefinition`(payload 읽기·빈 값·수정 칸 검증·미확정 칸·실행 가능 확인·확정 사유·실행·결과)과 등록부 `ActionTypeRegistry`. 서비스는 상태 흐름·작업 로그만 맡는다. 등록부에 없는 유형으로 만들면 COM-004. 지금은 `PURCHASE_REQUISITION_CREATE` 1종(`confirmer: MESSAGE_SENDER`, `handler: purchasing.createRequisition`). 실행 핸들러는 해당 모듈 담당자(purchasing)가 구현한다(BP-ACT-01). AI에 DB 쓰기 권한을 주지 않고, 실행은 사용자 권한과 업무 검증을 거친다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| ACT-001 | 초안 필수값 미확정(품목·톤·희망일) |
| COM-002 | 방 멤버가 아님, 요청자가 아닌 사람의 수정·확정·반려 |
| COM-003 | 메시지·초안·원료 품목 없음 |
| PUR-001 | (핸들러) 요청자 부서의 부서장 미지정 |
| COM-001 | 같은 메시지로 동시에 초안을 만들 때(부분 unique 위반, P2002). 차례로 만들면 기존 초안을 돌려준다(9장). 10장 AI 추출부터는 P2002가 나면 다시 확인해 먼저 만든 초안을 돌려준다 |

| 이벤트 | actor | target | 기타 |
| --- | --- | --- | --- |
| DRAFT_CREATED | USER(생성한 멤버) | `action_draft` | `actionDraftId`, `messageId` |
| DRAFT_CONFIRMED | USER(요청자) | `action_draft` | 사유 DRAFT_CONFIRMED |
| PURCHASE_REQUISITION_CREATED | USER(요청자) | `purchase_requisition` | purchasing이 기록, `actionDraftId`·`messageId` |
| DRAFT_EXECUTED | USER(요청자) | `action_draft` | `after`에 만든 업무 `resultTable`·`resultId`·`resultNo` (2026-10-15부터, 그 전 기록은 `purchaseRequisitionId`·`purchaseRequisitionNo`) |
| DRAFT_REJECTED | USER(요청자) | `action_draft` | `reason` = 반려 사유 |

`isAiAssisted`: P1은 AI 추출이 없으므로 false(10장에서 바뀜: AI가 채운 칸이 있던 초안의 DRAFT_CONFIRMED·핸들러 로그·DRAFT_EXECUTED는 true). AI 실행 카드 확정(REQ-AST-010)은 P2.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| messenger | 원본 메시지 조회·방 멤버 확인 |
| purchasing | 실행 핸들러 `createRequisition(tx, …)` — 실행 트랜잭션 안에서 부른다. unique 위반(P2002)이 나면 `retryOnNumberConflict`로 다시 시도한다(번호는 채번 잠금으로 겹치지 않는다) |
| master-data | 원료 품목 검증 |
| notification | 부서장 승인 요청 알림 🟡(유형 미확정) |

`imports: [MessengerModule, PurchasingModule]`(각 모듈이 service를 export해야 한다).

## 7. 테스트

[04] 14.3 관련 행:

| 검증 | 기대 결과 |
| --- | --- |
| 메시지 초안 확정 | 구매요청 WAITING_APPROVAL 생성 후 부서장 승인 (ACT-001~003) |
| 메시지 초안 반려 | REJECTED |
| 필수값 누락 확정 | ACT-001, 구매요청 없음 |
| 요청자가 아닌 사원 확정 | COM-002 |
| 같은 초안 두 번 확정 | 구매요청 1건만 |
| 같은 메시지로 초안 두 번 생성 | 미처리 초안 1건 |
| 14.1-10 | 메시지 구매요청 초안·요청자 확정·부서장 승인 로그 확인 |

실행: `npm test -w @fantasteel/server -- message-action`(묶음 DB `fs_pur`, purchasing과 같은 DB).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 요청자 권한 | 구매요청 등록 권한(`PURCHASE_REQUISITION_CREATE` USE)은 구매만 가진다. 영업·생산 사원이 쓴 메시지 초안을 확정할 때 이 권한을 요구하면 막히고, 요구하지 않으면 권한 밖 업무가 생긴다. BP-ACT-01은 "실행은 사용자 권한과 업무 검증을 거치는 명령 API로" 라고 적었다 | [04] BP-ACT-01, [권한표] |
| 생성 직후 상태 | AI가 없을 때 AI_GENERATED를 거칠지, 바로 WAITING_APPROVAL로 만들지 | [04] 10장, `SPEC.md` 5장 |
| 중복 생성 응답 | 미처리 초안이 있으면 기존 초안을 돌려줄지, 오류(COM-001)로 할지 | [ERD] 부분 unique, [04] BP-ACT-01 "중복 실행은 원본 메시지·유형·초안 ID로 막는다" |
| 실행 실패 기록 | 핸들러가 실패하면 tx가 롤백돼 `execution_error_code`·`execution_attempt_count`도 사라진다. 실패 기록을 별도 tx로 남기는 방식이 필요하다 | [ERD] action_draft, [04] 10장 |
| 요청 고유키 | 13.4는 `actionDraftId + 요청 고유키`로 중복 생성을 막자고 했지만 키 저장소가 없다 | [04] 13.4, 08 공통 규약 |
| 목록 범위 | "확정 주체 본인"만 보는지, 초안을 만든 멤버도 보는지 | [CSV] |
| payload 이름 | 12.3 예시(`rawMaterialId`, `requiredTon`, `requesterId`)와 ERD 컬럼(`item_id`, `requested_ton`, `requester_id`)이 다르다. 이 문서는 ERD 이름을 권장 | [04] 12.3, [ERD] |
| 확정 후 부서장 알림 | 13.4 `notify(departmentHeadOf(actor))`에 쓸 알림 유형(APPROVAL_REQUESTED)이 제안 상태 | [06] 3장 |

이 표의 항목은 모두 9장에서 정했다.

## 9. 구현 기준 (2026-10-12)

8장의 확인 필요 항목과 생성·조회·수정·확정·실행·반려 규칙을 정했다.

| 항목 | 정한 값 |
| --- | --- |
| 권한 | 3장대로 기능 권한 데코레이터 없이 service가 확인한다. 생성은 방 멤버, 수정·확정·반려는 요청자 본인, 목록은 요청자 본인(방 목록은 방 멤버), 상세는 요청자 본인 또는 원본 메시지 방 멤버. 아니면 COM-002. 다른 방 대화가 초안 상세로 새지 않게 상세도 막는다 |
| 요청자 권한 | 메시지 작성자가 사용 중이고 구매요청 등록 USE 권한이 있어야 초안을 만든다(아니면 COM-002). 확정할 수 없는 초안이 확인 대기에 영영 남지 않게 한다 |
| 승인권자 | 요청자에게 구매요청 승인권자(소속 부서의 부서장, 본인이 아님)가 없으면 생성과 확정을 PUR-001로 막는다(`purchasing.assertCanRequest`, 구매요청 등록과 같은 규칙). 확정 전에 막아 APPROVED에서 실행이 늘 실패하는 초안이 생기지 않게 한다 |
| 만들 수 있는 메시지 | 사원이 보낸 일반 메시지(USER, 삭제 안 됨)만. 아니면 COM-004 |
| 생성 직후 상태 | AI_GENERATED로 만들고 DRAFT_CREATED를 남긴 뒤 같은 트랜잭션에서 WAITING_APPROVAL로 바꾼다 |
| 중복 생성 응답 | 같은 메시지·유형에 미처리 초안이 있으면 그 초안을 돌려준다(`{ id, created: false }`) |
| 목록 범위 | `GET action-drafts`는 내가 요청자인 초안(API-252). 메시지 메뉴의 '초안 보기'를 위해 `GET action-drafts?chatRoomId=`로 그 방 메시지의 초안도 준다(방 멤버만, 아니면 COM-002). 최근 것 먼저 |
| payload 이름 | ERD 이름 `itemId`·`requestedTon`·`desiredReceiptDate`, 선택 입력 `requestReason`, 원본 글 복사 `sourceText`, AI가 채운 칸 `aiFilledFields`(10장) |
| 수정 | 요청자만, 확정 전(AI_GENERATED·WAITING_APPROVAL)만. `payload`의 보내지 않은 칸은 그대로, null이면 비운다. 원료가 아닌 품목·0 이하 톤·없는 날짜·그 유형에 없는 칸은 COM-004, `expectedUpdatedAt`이 다르면 COM-001. 맞는 작업 로그 유형이 없어 수정은 로그를 남기지 않는다 |
| 상대 날짜 | AI 추출이 없어 요청자가 날짜를 직접 넣으므로 바꾸지 않는다(10장에서 바뀜: LLM이 메시지 작성일 기준으로 바꾸고 서버가 다시 검증한다) |
| 미확정 칸 | 응답의 `unresolvedFields`: 원료 품목·수량(톤)·희망 입고일 중 비었거나 맞지 않는 칸 |
| 확정 권한 | 요청자 본인이고 구매요청 등록 USE 권한이 있어야 수정·확정·반려한다(실행은 사용자 권한을 거친다, BP-ACT-01). 아니면 COM-002 |
| 확정·실행 | `POST action-drafts/:id/confirm`: 미확정 칸이 있으면 ACT-001. APPROVED·`confirmed_at`·DRAFT_CONFIRMED(사유 `DRAFT_CONFIRMED: …`)를 한 트랜잭션에 남기고, 다음 트랜잭션에서 등록부 핸들러(`purchasing.createRequisition`, 요청자 = 로그인 요청자)로 구매요청을 만든 뒤 EXECUTED·DRAFT_EXECUTED(`after`에 구매요청 id·번호)를 남긴다. 응답은 `{ draft, executed, errorCode, errorMessage }` |
| 실행 실패 기록 | 핸들러가 실패하면(예: 부서장 없음 PUR-001) 실행 트랜잭션은 롤백되고, 별도 트랜잭션으로 `execution_error_code`·`execution_attempt_count`를 남긴다. 상태는 APPROVED 그대로다. 성공하면 오류 코드를 비우고 시도 횟수를 하나 올린다 |
| 다시 실행 | 명세에 없는 `POST action-drafts/:id/execute`: APPROVED 초안을 같은 핸들러로 다시 실행한다(화면의 '다시 실행') |
| 중복 실행 | 상태 확인 + 읽은 `updatedAt` 조건 갱신 + `purchase_requisition.action_draft_id` unique로 막는다. 요청 고유키 저장소는 쓰지 않는다 |
| 반려 | `POST action-drafts/:id/reject { rejectReason }`: 요청자만, 확정 전만(2026-10-21부터 실행에 실패한 APPROVED도, 11.7), 사유 필수(500자). REJECTED·DRAFT_REJECTED(사유 = 반려 사유) |
| 확정 후 부서장 알림 | 구매요청을 만드는 purchasing이 같은 트랜잭션에서 보낸다(구매요청 승인 요청 알림과 같다) |

## 10. 확장 유형과 AI 추출 (2026-10-15 결정)

근거: [04] BP-ACT-02·12.3 유형 표, [02] REQ-ACT-003·005, [06] ACTION_TYPE, `SPEC.md` 5장 결정 2. 구매요청은 1~9장 규칙을 그대로 쓰고, 아래는 모든 유형에 더하는 규칙이다.

| 항목 | 정한 값 |
| --- | --- |
| 유형 | 구매요청 생성(P1)·수주 등록·출하요청 생성·배정 확정·재생산 계획 생성. 생산계획 생성은 메시지에서 만들지 않는다(일반 계획은 수주 등록 때 자동 생성) |
| 생성 요청 | `POST messages/:id/action-drafts { actionType? }`. 없으면 PURCHASE_REQUISITION_CREATE(지금 화면이 그대로 동작) |
| 확정 주체 | 구매요청 = 메시지 작성자(9장). 확장 유형 = 초안을 만든 사원(`requester_id`). 만들 때와 수정·확정·반려할 때 그 유형의 사용 권한([04] 12.3 표)을 확인하고, 없으면 COM-002 |
| 유형 고르기 | 사람이 메시지 메뉴에서 고른다. 화면은 확정할 수 있는 유형만 보여 준다. AI는 유형을 고르지 않는다 |
| AI 추출 | 생성 때 llm 모듈로 메시지 본문·작성 시각을 보내 고른 유형의 칸을 JSON으로 받는다. LLM 호출은 DB 트랜잭션 밖에서 한다. 모델 미설정·연결 실패·형식 오류면 빈 칸으로 만든다(초안 생성은 실패하지 않는다) |
| 이름 → id | 원료·규격(품목 코드·이름), 고객사 이름, 수주번호·출하요청 번호를 서버가 기준정보·업무 데이터와 맞춘다. 하나로 정해지지 않으면 비워 두어 미확정 칸으로 보인다 |
| 날짜 | 상대 날짜는 메시지 작성일(Asia/Seoul) 기준 절대 날짜로 바꾸고, 서버가 YYYY-MM-DD를 다시 검증한다 |
| 배정 LOT | ALLOCATION_CONFIRM의 `lotIds`는 AI가 아니라 출하 배정 추천(inventory)으로 채운다 |
| 같은 메시지·유형 | 미처리 초안은 메시지·유형마다 1건이다(ERD 부분 unique, 9장 중복 생성 응답). 다른 사원이 만든 미처리 초안이 있으면 새로 만들지 않고 그 초안을 돌려준다(`created: false`). 화면은 "○○님이 만든 초안이 이미 있어요"를 보여 준다. 방 멤버라 상세는 볼 수 있지만 고치고 확정·반려하는 것은 만든 사원만 한다. 그 초안이 실행되거나 반려되면 다시 만들 수 있다 |
| 결과 연결 | 구매요청은 `purchase_requisition.action_draft_id`. 나머지는 핸들러가 남기는 업무 작업 로그(SALES_ORDER_CREATED 등)의 `action_draft_id`와 DRAFT_EXECUTED `after`(결과 테이블·id·번호). ERD는 바꾸지 않는다(ERD `action_draft` Note의 "생성된 업무 테이블의 action_draft_id로 연결"은 구매요청에만 해당한다) |
| 중복 실행 | 지금처럼 상태 확인 + `updatedAt` 조건부 갱신. 실행 트랜잭션 안에서 초안을 EXECUTED로 바꾸므로 동시에 두 번 실행하면 한쪽이 COM-001로 롤백된다 |
| AI 경유 | 생성 때 AI가 채운 칸이 있던 초안을 확정·실행하면 DRAFT_CONFIRMED·DRAFT_EXECUTED와 핸들러 작업 로그에 `is_ai_assisted = true`(REQ-AST-010) |
| 다른 모듈 | 핸들러는 각 모듈 service의 트랜잭션을 받는 함수를 부른다. sales-order는 tx를 받는 `createInTx`가 있지만 `private`이라 공개로 바꾸고, shipment·inventory·production은 tx를 받는 함수로 나눈다(동작은 그대로) |
| 같이 쓰는 곳 | AI 어시스턴트 실행 카드(AST-005, ai-assistant.md 단계 ③)와 회의록 업무 등록(VOC-004)도 이 등록부의 핸들러를 쓴다 |

구현 순서: 등록부 일반화(REQ-ACT-004, 2026-10-15 완료) → AI 추출(2026-10-15 완료) → 화면(유형 고르기·유형별 칸) → 수주 등록 / 출하요청·배정 확정 / 재생산 계획 (화면부터 모두 2026-10-21 완료, 11장).

- AI 추출 구현: `DraftExtractor`가 llm 모듈에 저장된 모델로 메시지 글, 작성일(요일 포함), 유형 정의의 칸 설명(`extractionGuide`, 구매요청은 원료 코드·이름 목록)을 보내 JSON 하나를 받는다. 제한 시간은 30초다.
  - 유형 정의 `fromExtraction`이 값을 다시 확인해 맞는 칸만 채운다. 구매요청은 원료(코드나 이름이 정확히 1건), 톤(0 초과, 소수 3자리까지), 희망 입고일(실제 있는 YYYY-MM-DD)을 본다.
  - 채운 칸 이름은 payload `aiFilledFields`에 남긴다. 수정 요청으로 바꿀 수 없고, 사람이 값을 고쳐도 지우지 않는다(AI 경유 근거).
  - LLM을 부르기 전에 방 멤버·확정 주체·미처리 초안을 확인한다(미처리 초안이 있으면 부르지 않는다). 저장 트랜잭션에서 같은 확인을 다시 한다.
  - 메시지 초안의 DRAFT_CREATED는 AI 경유로 남기지 않는다(위 표의 AI 경유는 확정·핸들러·실행 로그).
  - 회의록(VOC-004)에서 만든 구매요청 초안은 AI가 회의에서 뽑은 값이라 채워진 칸을 `aiFilledFields`로 남긴다. 생성부터 확정·실행까지 모두 AI 경유다.
- 응답의 실행 결과는 `result { table, id, no, status }`다(구매요청 전용 `purchaseRequisition` 칸을 바꿈).
- `GET action-drafts`(내 초안)는 메시지·회의록(VOC-004)에서 만든 초안만 준다. 확정한 Agent 대응 후보는 `?source=agent`(factory-agent)에서 본다.
- AI Factory Agent(factory-agent.md)는 같은 `action_draft`를 쓰지만 실행 핸들러는 따로 있다. 같은 유형이라도 Agent의 배정 확정(ALLOCATION_CONFIRM)은 추천 확인 기록이고 실행하지 않는다. 메시지 배정 확정을 만들 때 둘을 맞출지 정한다.

## 11. 확장 유형 구현 (2026-10-21, 이슈 #463)

10장 결정을 이렇게 구현했다. 🟡 = 문서에 정한 값이 없어 구현에서 정한 가정값(팀 확인 대상).

### 11.1 유형 정의 (`action-types/`)

| 유형 | 파일 | payload 칸 | 미확정 칸 이름 | 확정 전 추가 확인 | 실행 핸들러 | 결과(`result.table`) |
| --- | --- | --- | --- | --- | --- | --- |
| SALES_ORDER_CREATE | `sales-order.action.ts` | `customerId`, `items[]`(`itemId`, `orderedQty`, `dueDate`) | 고객사, 품목, 품목 n 규격·매수·납기 | 없음 | `salesOrders.createInTx` (private → 공개) | `sales_order` |
| SHIPMENT_REQUEST_CREATE | `shipment-request.action.ts` | `customerId`, `shipDate`(선택), `items[]`(`salesOrderItemId`, `requestQty`) | 고객사, 품목, 품목 n 수주 품목·매수 | 출하 가능 매수 초과면 SHP-002 | `shipments.createInTx` (`create`에서 나눔) | `shipment_request` |
| ALLOCATION_CONFIRM | `allocation.action.ts` | `shipmentRequestItemId`, `lotIds` | 출하요청 품목, 배정 LOT | 배정 확정과 같은 LOT 검사 (11.7) | `inventory.confirmShipmentAllocationsInTx` (`confirmAllocations`에서 나눔) | `shipment_request` |
| REPRODUCTION_PLAN_CREATE | `reproduction-plan.action.ts` | `salesOrderItemId` | 수주 품목 | 추가 계획이 필요 없으면 COM-001 | `production.createReproductionPlanInTx` (이미 공개) | `production_plan`, 여재 예약만으로 채워지면 `sales_order_item` 🟡 |

- 모든 확장 유형 payload에 `sourceText`·`aiFilledFields`가 있다. 확정 주체 `DRAFT_CREATOR`, 권한은 12.3 표(수주 등록 SALES_ORDER_CREATE, 출하·배정 SHIPMENT_REQUEST_MANAGE, 재생산 PRODUCTION_PLAN_CONFIRM).
- 유형 정의에 `assertPayloadExecutable`(선택)·`payloadLabels`를 더했다. 앞은 칸은 다 찼지만 지금 데이터로 실행이 늘 실패할 값을 확정 전에 막고(APPROVED에 갇히지 않게), 뒤는 id 칸을 이름으로 바꿔 응답 `payloadLabels`(칸 경로 → 이름, 예: `items.0.itemId`)에 준다.
- 핸들러 함수는 동작을 바꾸지 않고 tx를 받게 나눴고, 마지막 인자 `origin`(`actionDraftId`·`messageId`·`isAiAssisted`)을 받으면 본 작업 로그(SALES_ORDER_CREATED·SHIPMENT_REQUEST_CREATED·ALLOCATION_CONFIRMED·REPRODUCTION_PLAN_CREATED)에 남긴다. 권한은 초안 서비스가 확인한다.
- AI가 채운 초안을 실행하면 실행 트랜잭션을 `runAsAiAssisted`로 감싸 핸들러 안에서 이어 남는 로그(자동 예약·생산계획 등)도 AI 경유가 된다.
- 결과 연결: 구매요청 밖의 유형은 마지막 DRAFT_EXECUTED `after`(resultTable·resultId·resultNo)에서 읽는다. 그래서 응답 `result.status`는 null이다(지금 상태는 그 업무 화면에서 본다).
- 품목 줄은 초안 한 장에 20줄까지 🟡(LLM이 긴 목록을 지어내지 않게). 수정은 줄 목록을 통째로 바꾼다.
- 수주 등록 초안의 매수는 정수만 받는다. 톤만 말한 메시지는 매수를 비워 둔다(톤을 매수로 바꾸지 않는다, 4.1).
- 실행 트랜잭션 제한 시간을 30초로 늘렸다(수주 등록과 같은 값). 수주 등록은 품목마다 예약·계획·로그가 돈다.

### 11.2 AI 추출과 이름 → id

| 유형 | LLM에 보내는 후보 | LLM이 주는 값 | 서버가 맞추는 법 |
| --- | --- | --- | --- |
| 수주 등록 | 고객사 전체, 제품 규격(이론중량 있는 슬래브·코일) 전체 | `customerName`, `items[]{itemCode, orderedQty, dueDate}` | 이름·코드가 정확히 하나와 맞을 때만(대소문자·앞뒤 공백 무시) |
| 출하요청 | 고객사, 진행 중 수주 품목 최근 80줄 🟡 | `customerName`, `shipDate`, `items[]{salesOrderNo, lineNo, itemCode, requestQty}` | 수주번호 → 줄 번호 → 규격 코드 순. 고객사를 말하지 않았어도 고른 수주 품목이 모두 한 고객사면 그 고객사 |
| 배정 확정 | 배정 대기·배정 확정 출하요청 품목 최근 80줄 🟡 | `shipmentRequestNo`, `lineNo`, `itemCode` | 출하요청 번호 → 줄 번호 → 규격 코드. LOT은 `inventory.recommendedShipmentLotIds`(FIFO, 미배정 매수만큼, 로그 없음)로 채운다. AI가 LOT을 줘도 쓰지 않는다 |
| 재생산 계획 | 진행 중 수주 품목 최근 80줄 🟡 | `salesOrderNo`, `lineNo`, `itemCode` | 수주 품목과 같은 방식 |

- 줄 번호는 수주·출하요청 안의 id 순서(1부터).
- 배정 확정 초안에서 출하요청 품목을 바꾸면 LOT을 그 품목의 추천으로 다시 채운다. LOT만 보내면 사람이 고른 LOT으로 바꾼다(화면은 '추천 다시 받기'만 둔다).
- 매수는 `20`, `'20매'`, `'1,200'`을 받고 소수·0·`'6t'`는 버린다.

### 11.3 생성 응답·화면

- `POST messages/:id/action-drafts` 응답에 `requesterId`·`requesterName`(확정 주체)을 더했다. 다른 사원이 만든 미처리 초안이 있으면 화면이 "○○님이 만든 초안이 이미 있어요"를 보인다.
- 메시지 메뉴(`MessageDraftAction.tsx`): 유형마다 한 줄. 구매요청은 늘 보이고, 확장 유형은 그 유형의 사용 권한이 있을 때만 보인다. 같은 메시지·유형의 미처리 초안이 있으면 '○○ 초안 보기 #id'(다른 사원 초안이면 이름 표시). 실행·반려된 초안만 있으면 새로 만든다.
- 초안 화면: 구매요청은 기존 카드, 확장 유형은 `TypedDraftFormCard`. 서버 `unresolvedFields` 이름으로 칸마다 '미확정'을 보이고(고치는 중인 칸은 뺀다), 확정 주체가 아니면 `payloadLabels`로 읽기만 한다. 실행하면 만든 업무 번호와 화면 링크를 보인다. AI가 채운 칸이 있으면 'AI 추출' 표시.
- `GET action-drafts?chatRoomId=` 목록 행(`RoomDraftView`)에 유형·확정 주체를 더했다(화면 변환만, 서버 응답은 그대로).

### 11.4 Agent와의 경계

- Agent 대응 후보는 payload `agent` 칸으로 가른다(`factory-agent.isCandidate`). 메시지 초안 payload에는 `agent` 칸이 없다.
- Agent의 배정 확정(ALLOCATION_CONFIRM)은 지금처럼 추천 확인 기록이고 실행하지 않는다. 메시지 배정 확정만 실제로 배정한다. 둘을 맞출지는 정하지 않았다(10장 끝 항목 그대로).

### 11.5 실제 LLM 확인 (2026-10-21, 개발 설정 `unsloth/Qwen3.8-Flash-Next-GGUF`)

| 메시지 (작성 10-21 수) | 결과 |
| --- | --- |
| A사 SS275 6t 20매 다음주 금요일 납기로 수주 넣어줘 | 고객사 비움(A사 없음), 규격 비움(6t로 하나로 안 정해짐), 20매·2026-10-30 |
| 가람중공업 SS275 250×1200×10000 슬래브 20매, 다음주 금요일 납기 | 모두 채움 |
| 나래조선 SM355A 슬래브 8매 11/20, SPHC 코일 2.5x1200 5개 11/27 | 2줄 모두 채움 |
| SO-… 4매 모레 출하요청 | 수주 품목·고객사·4매·2026-10-23 |
| DR-… 배정 확정 | 출하요청 품목 채움(합격 LOT이 없어 배정 LOT은 미확정) |
| SO-… 재생산 계획 | 수주 품목 채움 |

- 위 결과는 확인하는 동안만 추출 제한 시간을 180초로 늘려 얻었다. 한 건에 15~80초 걸렸고, 그때 제한 시간(30초)으로는 대부분 빈 초안이 됐다. 원인과 조정은 11.6.

### 11.6 추출 속도와 제한 시간 (2026-10-21, 이슈 #472)

**원인**: 초안 추출 프로필(`LLM_PROFILE.MESSAGE_EXTRACT`)은 이미 생각 끔(`reasoning: 'off'`)이다. 그런데 생각 설정(`reasoning_effort`)은 LM Studio가 모델 정보로 '받는다'고 알릴 때만 보낸다. Unsloth Studio는 그 정보가 없어 끔이 전달되지 않았고, 모델이 매번 생각한 뒤 답했다.

같은 샘플 6건(11.5 표, 같은 프롬프트·temperature 0)을 생각 설정만 바꿔 쟀다. 모델 서버에 직접 보냈다.

| 설정 | 한 건 시간 | 결과 |
| --- | --- | --- |
| 지금(생각 설정을 보내지 않음, 모델이 생각함) | 9.4~38.0초, 배정 확정 1건은 240초 안에 끝나지 않음 | 끝난 5건은 아래와 같음 |
| `reasoning_effort: "low"` | 6.5~33.6초 | 6건 모두 아래와 같음 |
| `reasoning_effort: "none"` | 1.8~4.2초 | 6건 모두 아래와 같음 |
| `enable_thinking: false` | 0.9~2.1초 | 6건 모두 아래와 같음 |

결과(모든 설정 공통): 'A사 … 6t 20매'는 고객사·규격 미확정에 20매·2026-10-30이다. 나머지 5건은 고객사·규격·매수·납기·수주 품목·출하요청 품목·날짜('모레' = 10-23)를 모두 맞게 채웠다. 생각을 꺼도 정확도는 떨어지지 않았다.

**조정**
- 생각을 끄는 전송은 PR #468(이슈 #465, Unsloth Studio 지원)이 맡는다. Unsloth `/v1/status`로 생각 지원을 알아내고, 끔이면 `reasoning_effort: "none"`과 `enable_thinking: false`를 보낸다. 같은 `llm.client.ts`를 고치므로 이 이슈에서는 고치지 않는다. 프로필은 이미 '끔'이라 바꾸지 않는다. #468이 머지되기 전에는 위 '지금' 시간이 그대로다.
- 제한 시간: 기본 90초 🟡(가정값). 생각이 켜진 지금 측정값(9~38초)을 덮고, 끈 뒤(1~4초)에는 넉넉하다. env `MESSAGE_EXTRACT_TIMEOUT_SECONDS`(1~600초, 그 밖이면 기본값)로 바꾼다.
- 빈 초안이 된 까닭을 payload `aiExtraction`에 남긴다: `FILLED` 칸을 채움, `NOTHING_FOUND` 답은 왔지만 맞는 값이 없음, `NO_MODEL` 모델 미설정, `TIMEOUT` 시간 초과, `NOT_JSON` JSON이 아님, `FAILED` 연결·서버 오류. 글이 없는 메시지와 이 이슈 전 초안은 없다(null). 스키마는 바꾸지 않는다(payload jsonb).
- 화면: 메시지 메뉴에서 만드는 동안 'AI가 메시지를 읽는 중…'을 보이고, 시작할 때 안내를 띄운다(메뉴를 닫아도 다 만들면 초안을 연다). 초안 카드 머리에 빈 초안이 된 까닭('AI 추출 안 됨' + 이유)을 보인다.

### 11.7 #471 리뷰 반영 (2026-10-21, 이슈 #472와 같은 PR)

| 항목 | 바꾼 것 |
| --- | --- |
| 배정 확정 전 LOT 검사 | 확정 전에 `inventory.assertShipmentAllocatable`(배정 확정과 같은 규칙: 출고 전 출하요청, 미배정 매수 이내, LOT마다 같은 규격·재고 상태·적격·확정 배정 없음, 잠그지 않음)로 본다. 막히면 확인 대기 그대로다(INV-001~004·COM-003·COM-004) |
| 같은 LOT 추천 겹침 | FIFO 추천에서 다른 미처리 메시지 초안(배정 확정)이 가진 LOT을 뺀다. '추천 다시 받기'는 이 초안의 지금 LOT을 다시 쓸 수 있다 |
| 실행 실패 초안 | 확정했지만 실행에 실패한(`execution_error_code` 있음) APPROVED 초안은 확정 주체가 반려할 수 있다(REJECTED·DRAFT_REJECTED). 실패하지 않은 APPROVED는 COM-004. 화면의 '다시 실행' 옆에 '반려' |
| 실행 경합과 업무 오류 | 동시 실행 경합은 초안 조건부 갱신 실패(전용 예외)와 결과 행 unique 위반(P2002)만으로 가린다. 핸들러의 업무 오류는 COM-001이라도 실패로 기록한다. AppException이 아닌 오류는 COM-999로 시도 기록을 남기고 서버 로그에 남긴다 |
| 매수 상한 | 초안 매수는 1~1,000,000매 🟡(가정값, DB int4 안). 넘으면 수정 요청은 COM-004, AI 값은 버린다 |
| 목록 읽기 | 목록·상세 응답 한 번 안에서 고객사·규격 목록을 한 번만 읽는다(유형 정의의 `unresolvedFields`·`payloadLabels`가 나눠 쓰는 기억) |
| 배정 사유 | payload `lotsChosenBy`(RECOMMENDATION·PERSON). 사람이 LOT을 고치면 DRAFT_CONFIRMED 사유가 'FIFO 추천'이 아니라 '사람이 고름'. 화면도 LOT 옆에 표시 |
