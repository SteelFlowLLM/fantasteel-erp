# message-action — Message → ERP 구매요청 초안(Action Draft)

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-ACT-001~004 (REQ-ACT-005 확장 유형은 P2, 만들지 않음) |
| BP | BP-ACT-01 Message → ERP 구매요청([04] 6장), 10장 Action Draft 상태, 12.3 업무 유형 등록 예시, 13.4 의사코드 |
| 등급 | P1 |
| AI | SPEC.md 5장 결정: **AI 추출은 나중에 넣는다.** 지금은 요청자가 초안 값을 직접 입력하고, 메시지 → 초안 → 확정 → 구매요청 → 부서장 승인 흐름을 만든다. LLM 호출을 넣지 않는다 |

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
| POST | `messages/:id/action-drafts` | 메시지에서 구매요청 초안 생성 | 방 멤버 | 요청자는 메시지 작성자(AI가 지정하지 않음). 유형은 ACTION_TYPE |
| GET | `action-drafts` | 초안 목록 | 확정 주체 본인 | 상태는 DRAFT_STATUS |
| GET | `action-drafts/:id` | 초안 상세 | 확정 주체 본인 | |
| PATCH | `action-drafts/:id` | 초안 수정 | 확정 주체 본인 | |
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
4. 상태: [04] 10장 흐름대로 AI_GENERATED로 만들고 요청자 확인 대기 WAITING_APPROVAL로 넘긴다. AI가 없으므로 payload는 비어 있을 수 있다.

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

**업무 유형 등록 구조**(REQ-ACT-004, 12.3): 유형별로 `{ type, schema(검증기), confirmer, handler }`를 등록하는 레지스트리를 둔다. P1은 `PURCHASE_REQUISITION_CREATE` 1종(`confirmer: REQUESTER`, `handler: purchasing.createRequisition`). 실행 핸들러는 해당 모듈 담당자(purchasing)가 구현한다(BP-ACT-01). AI에 DB 쓰기 권한을 주지 않고, 실행은 사용자 권한과 업무 검증을 거친다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| ACT-001 | 초안 필수값 미확정(품목·톤·희망일) |
| COM-002 | 방 멤버가 아님, 요청자가 아닌 사람의 수정·확정·반려 |
| COM-003 | 메시지·초안·원료 품목 없음 |
| PUR-001 | (핸들러) 요청자 부서의 부서장 미지정 |
| COM-001 | 같은 메시지로 동시에 초안을 만들 때(부분 unique 위반, P2002). 차례로 만들면 기존 초안을 돌려준다(9장) |

| 이벤트 | actor | target | 기타 |
| --- | --- | --- | --- |
| DRAFT_CREATED | USER(생성한 멤버) | `action_draft` | `actionDraftId`, `messageId` |
| DRAFT_CONFIRMED | USER(요청자) | `action_draft` | 사유 DRAFT_CONFIRMED |
| PURCHASE_REQUISITION_CREATED | USER(요청자) | `purchase_requisition` | purchasing이 기록, `actionDraftId`·`messageId` |
| DRAFT_EXECUTED | USER(요청자) | `action_draft` | `after`에 생성된 구매요청 id |
| DRAFT_REJECTED | USER(요청자) | `action_draft` | `reason` = 반려 사유 |

`isAiAssisted`: P1은 AI 추출이 없으므로 false. AI 실행 카드 확정(REQ-AST-010)은 P2.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| messenger | 원본 메시지 조회·방 멤버 확인 |
| purchasing | 실행 핸들러 `createRequisition(tx, …)` — 실행 트랜잭션 안에서 부른다. 채번 경합은 `retryOnNumberConflict`로 다시 시도한다 |
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
| payload 이름 | ERD 이름 `itemId`·`requestedTon`·`desiredReceiptDate`, 선택 입력 `requestReason`, 원본 글 복사 `sourceText` |
| 수정 | 요청자만, 확정 전(AI_GENERATED·WAITING_APPROVAL)만. 보내지 않은 칸은 그대로, null이면 비운다. 원료가 아닌 품목·0 이하 톤·없는 날짜는 COM-004, `expectedUpdatedAt`이 다르면 COM-001. 맞는 작업 로그 유형이 없어 수정은 로그를 남기지 않는다 |
| 상대 날짜 | AI 추출이 없어 요청자가 날짜를 직접 넣으므로 바꾸지 않는다 |
| 미확정 칸 | 응답의 `unresolvedFields`: 원료 품목·수량(톤)·희망 입고일 중 비었거나 맞지 않는 칸 |
| 확정 권한 | 요청자 본인이고 구매요청 등록 USE 권한이 있어야 수정·확정·반려한다(실행은 사용자 권한을 거친다, BP-ACT-01). 아니면 COM-002 |
| 확정·실행 | `POST action-drafts/:id/confirm`: 미확정 칸이 있으면 ACT-001. APPROVED·`confirmed_at`·DRAFT_CONFIRMED(사유 `DRAFT_CONFIRMED: …`)를 한 트랜잭션에 남기고, 다음 트랜잭션에서 등록부 핸들러(`purchasing.createRequisition`, 요청자 = 로그인 요청자)로 구매요청을 만든 뒤 EXECUTED·DRAFT_EXECUTED(`after`에 구매요청 id·번호)를 남긴다. 응답은 `{ draft, executed, errorCode, errorMessage }` |
| 실행 실패 기록 | 핸들러가 실패하면(예: 부서장 없음 PUR-001) 실행 트랜잭션은 롤백되고, 별도 트랜잭션으로 `execution_error_code`·`execution_attempt_count`를 남긴다. 상태는 APPROVED 그대로다. 성공하면 오류 코드를 비우고 시도 횟수를 하나 올린다 |
| 다시 실행 | 명세에 없는 `POST action-drafts/:id/execute`: APPROVED 초안을 같은 핸들러로 다시 실행한다(화면의 '다시 실행') |
| 중복 실행 | 상태 확인 + 읽은 `updatedAt` 조건 갱신 + `purchase_requisition.action_draft_id` unique로 막는다. 요청 고유키 저장소는 쓰지 않는다 |
| 반려 | `POST action-drafts/:id/reject { rejectReason }`: 요청자만, 확정 전만, 사유 필수(500자). REJECTED·DRAFT_REJECTED(사유 = 반려 사유) |
| 확정 후 부서장 알림 | 구매요청을 만드는 purchasing이 같은 트랜잭션에서 보낸다(구매요청 승인 요청 알림과 같다) |
