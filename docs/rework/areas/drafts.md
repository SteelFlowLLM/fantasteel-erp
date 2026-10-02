# Message → ERP — 메시지에서 구매요청 초안·요청자 확정 (3단계 10번, 병렬 작업)

- 2026-10-01, 작업 트리 브랜치. 협업 영역 브랜치(`worktree-wf_b5e98464-c6e-4`, bb9e727)와 업무 규칙 핵심(4ed036b)을 합친 위에서 만들었다.
- 근거: 요구사항 REQ-ACT-001~004(ACT-005는 P2), 업무 프로세스 BP-ACT-01 · 10장 DRAFT_STATUS · 13.4 · 14.1 10단계 · 9.3 ACT-001, 공통 코드 DRAFT_STATUS · ACTION_TYPE(초안 업무 유형), 용어 사전 TRM-092~096(Message → ERP · Action Draft · 초안 상태 · 추출 스키마 · 실행 핸들러), SPEC 5장 결정 2, PLAN 6장 4번 · 7장 구매(초안), 감사 보고서 2번 A-9와 C절.
- 업무 규칙(요청자만 확정, ACT-001, 등록부 실행, 중복 실행 방지, 작업 로그, 시스템 메시지, 승인 요청 알림)은 **core 서비스(`mock/services/actionDrafts.ts`)를 그대로 부른다.** 이 영역은 권한 확인 + 화면만 만들었다.

## 1. 화면과 경로

| 경로·자리 | 내용 |
|---|---|
| 메신저 메시지 `더 보기` 메뉴 | **구매요청 초안 만들기**: 모든 채팅방(1:1·그룹·업무방)의 사원 글 메시지에서 보인다(시스템 메시지·첨부만 있는 메시지 제외, 구매요청 조회 이상 권한). 사용 권한이 없으면 막힌 채 `권한 필요` + 툴팁 `구매요청 등록·MRP 사용 권한이 필요해요`. 메시지 작성자(= 요청자)가 확정할 수 없으면(구매요청 등록 사용 권한 없음·사용 안 함) 막힌 채 `만들 수 없음` + 툴팁에 까닭(검토 반영 1). 누르면 초안을 만들고 `/action-drafts/{id}`로 간다. 이 메시지에 반려되지 않은 초안이 있으면 대신 **구매요청 초안 보기 #id**(상태 표시)로 그 초안을 연다 |
| `/action-drafts/[id]` | 왼쪽 **내 초안**(MasterPane) + 오른쪽 초안 확인·확정 |

### `/action-drafts/[id]` 구성 (옛 화면 A-9의 B안 모양 + C절 반영)
- 상단 바 제목 `초안 #id`, 부제 `구매요청 생성 · 요청자 {이름}`. 초안은 업무 번호가 없다(9.1·ERD) → `초안 #id`.
- 머리: 경로 `메신저 > Message → ERP`, `초안 #id` + `구매요청 생성` 꼬리표 + 상태 배지 + `Message → ERP · {일시} 생성`, 버튼 `구매요청 목록`, `원본 메시지로 이동`(`/messenger?room=`).
- 흐름 카드: `생성 → 확인 대기 → 확정 → ERP 반영`(반려면 `생성 → 확인 대기 → 반려`) + `{요청자} 확정 > 구매요청 생성 > 부서장 승인 > 구매 발주`.
- 띠: ERP 반영(구매요청 번호 링크 + 구매요청 상태 배지 + "초안 확정과 구매요청 승인은 따로예요"), 반려(사유·일시), 확정 뒤 구매요청 생성 실패(PUR-001이면 "승인권자가 없어…", 시도 n회·마지막 시각), 확정 거부(ACT-001이면 "아직 확정할 수 없어요 · 채워야 할 칸: …").
- 초안 카드(항목 | 값 | 기준): 원료 품목*(원료만, `이름 · 코드`, 기준 = 기본 공급업체) · 수량(톤)*(t, 소수 3자리) · 희망 입고일*(DateInput) · 요청자(메시지 작성자, 바꿀 수 없음) · 요청 근거(500자, 선택, 비우면 core가 원본 메시지 글을 넣음). 저장된 값이 비었거나 기준정보와 안 맞는 필수 칸은 `미확정` 배지(BP-ACT-01 구현 제안 "미확정 필드로 보여 주고 실행하지 않는다"). 머리에 **`AI 자동 추출 준비 중`** 안내와 `AI 자동 추출` SoonButton(등급 표시 없는 '준비 중').
- 아래 동작
  - 요청자 + 확인 대기 + 사용 권한: `반려`(사유 필수 → `반려 확정`), `저장하지 않은 수정이 있어요 / 마지막 저장 {일시}`, `저장`, `확정하고 구매요청 만들기`(고친 값이 있으면 먼저 저장하고 확정).
  - 요청자 + 확정했지만 생성 실패: `확정된 값은 바꿀 수 없어요` + `구매요청 만들기 다시 실행`.
  - 그 밖: 잠금 안내(요청자만 가능 / 확정 · 구매요청 생성 대기 / 확정·ERP 반영 시각 / 반려). 요청자인데 사용 권한이 없으면 `조회만 할 수 있어요 · 구매요청 등록·MRP 사용 권한이 필요해요`.
- 오른쪽: **원본 메시지**(채팅방 · 보낸 사람 · 일시 · 내용 · 이동), **확정하면**(확정 → ERP 반영 → 승인 대기 안내, 출처: Message → ERP), **초안 업무 유형**(등록부: 구매요청 생성 = 추출 스키마 `원료 품목 · 수량(톤) · 희망 입고일 · 요청자`(TRM-095) + 선택 입력 `요청 근거`(스키마 밖), 출하요청 생성·수주 등록·생산계획 생성·배정 확정·재생산 계획 생성 = `준비 중 (P2)`).
- 상태: 불러오는 중 / 오류(COM-002는 잠금) / 없는 초안 `초안을 찾을 수 없어요` / 내 초안 없음 안내.

### '내 초안' 목록을 어디에 두었나
- **초안 화면 왼쪽**에 두었다(브리프의 선택지 중). 구매요청 목록(`/purchase-requisitions`)은 다른 작업자 소유이고, 메신저 방 정보도 협업 영역 소유라 건드리지 않았다.
- 내용: 내가 요청자(메시지 작성자)인 초안, 최근 것 먼저, 상태 칩(전체 + 있는 상태만), 줄 = `초안 #id · 유형 · 상태 배지`, 메시지 글, 채팅방 · 상대 시간, 만든 구매요청 번호.
- 구매요청 목록의 옛 '확인 대기 초안' 구역(보고서 2 A-2)을 넣을 때는 `hooks/useActionDrafts.ts`의 `useMyActionDrafts()`(= `actionDraftApi.listMine`)를 그대로 쓰면 된다.

## 2. 흐름과 요구사항

| 흐름 | REQ / BP |
|---|---|
| 아무 채팅방 메시지 → 초안(원본 메시지 연결, 요청자 = 메시지 작성자, 생성 → 확인 대기) | REQ-ACT-001, PLAN 6장 4번, BP-ACT-01 |
| AI 추출 없이 요청자가 원료 품목·수량(톤)·희망 입고일 입력, 'AI 자동 추출 준비 중' | SPEC 5장 결정 2, PLAN 1장 7번 |
| 요청자만 수정·확정·반려(다른 사원 COM-002), 필수값 미확정이면 ACT-001 | REQ-ACT-002, 9.3 ACT-001, BP-ACT-01 두 승인의 구분 |
| 확정 → 등록부 핸들러가 구매요청 생성(action_draft_id, 승인 대기) → ERP 반영, 부서장에게 승인 요청 알림 | REQ-ACT-002·003·004, REQ-PUR-002, 14.1 10단계 |
| 상태 흐름 생성 → 확인 대기 → 확정 → ERP 반영 / 반려 | REQ-ACT-003, 10장 DRAFT_STATUS |
| 중복 방지: 같은 메시지의 반려되지 않은 초안은 다시 열기, 이미 반영한 초안은 다시 실행 불가 | BP-ACT-01 "중복 실행은 원본 메시지·유형·초안 ID로 막는다" |
| 생성 실패(예: 부서장 없음 PUR-001) → 확정 상태로 남기고 결과 기록 → 원인 고친 뒤 다시 실행 | core `runHandler` |
| 작업 로그 DRAFT_CREATED · DRAFT_CONFIRMED(사유 DRAFT_CONFIRMED) · PURCHASE_REQUISITION_CREATED · DRAFT_EXECUTED · DRAFT_REJECTED (message_id · action_draft_id, 업무방이면 sales_order_id) | 10장, REQ-LOG |
| 확정하면 채팅방에 시스템 메시지 "초안 #n로 구매요청 PR-…을 만들었어요" (메신저가 PR- 번호를 링크로 보인다) | 브리프 선택 항목 (core) |
| 초안 업무 유형 등록부, P2 유형은 준비 중 | REQ-ACT-004, ACT-005(P2) |

## 3. api 함수 — `client/src/api/actionDrafts.ts`

모든 함수가 `requireActor`로 시작한다. 초안 권한 = **PURCHASE_REQUISITION_CREATE**(조회는 VIEW 이상, 변경은 USE).

| 함수 | 권한 | core 호출 | 오류 |
|---|---|---|---|
| `get(id)` → `DraftDetailView`(core 뷰 + 요청자 직급·부서, `isRequester`, 채팅방 이름, 원료 기본 공급업체) | VIEW | `actionDraftView` | COM-002, COM-003 |
| `listMine()` → `DraftListItemView[]` | VIEW | `listActionDrafts({requesterId})` | COM-002 |
| `listOfRoom(chatRoomId)` → `{id, messageId, draftStatus}[]` | VIEW + 방 멤버 | (테이블 읽기) | COM-002 |
| `checkRequester(messageId)` → `{requesterId, blockReason}` | VIEW + 방 멤버 | (테이블 읽기) | COM-002, COM-003 |
| `createFromMessage({messageId})` → `{id, created}` | USE + 요청자(메시지 작성자)가 확정할 수 있어야 함 | `createDraftFromMessage` (방 멤버만) | COM-002, COM-003 |
| `update({actionDraftId, payload, expectedUpdatedAt})` | USE | `updateDraft` (요청자만, 확인 대기만) | COM-002, COM-001, InputError(형식) |
| `confirm({actionDraftId, expectedUpdatedAt})` → `{draft, executed, target, errorCode, errorMessage}` | USE | `confirmDraft` | **ACT-001**(detail = 칸 이름), COM-002, COM-001 |
| `execute({actionDraftId})` | USE | `executeDraft` (확정·실패한 초안만) | COM-002, InputError(이미 실행) |
| `reject({actionDraftId, rejectReason, expectedUpdatedAt})` | USE | `rejectDraft` (사유 필수) | COM-002, InputError |
| `listRawMaterials()` | VIEW | (테이블 읽기: 원료 + 기본 공급업체) | COM-002 |
| `ACTION_TYPE_CATALOG` | — | `ACTION_TYPE_REGISTRY`를 화면용으로(`schemaFieldLabels` = 추출 스키마, `optionalInputLabels` = 스키마 밖 선택 입력) | — |

- 조회 키: `actionDraftKeys`(`['action-drafts', …]`, 이 파일 안). 훅: `hooks/useActionDrafts.ts`(`useActionDraft`, `useMyActionDrafts`, `useRoomActionDrafts`, `useDraftRequesterCheck`, `useDraftRawMaterials`). 변경은 화면에서 `useAction(actionDraftApi.…)`(성공하면 모든 조회 무효화 → 구매요청·승인함·알림·메신저도 바로 바뀜).
- 순수 함수: `features/actionDrafts/lib/draftDisplay.ts`(상태 배지 색, 흐름 단계, 실행 실패 결과 읽기, 입력 폼 ↔ 저장 값, 미확정 표시, 상태별 개수, 구매요청 상태 표시).
- 작업 로그는 core가 남긴다. `update`(값 저장)는 맞는 BUSINESS_EVENT_TYPE이 없어 남기지 않는다(core와 같음).

## 4. 시드

- 새 시드 없음. core 거래 시드의 업무방 `SO-2609-003 다온건설`에 있는 정다은 메시지 "실리코망가니즈 20톤 10월 20일까지 필요합니다"로 시연한다(정다은 계정 → 메신저 → 메시지 더 보기 → 구매요청 초안 만들기 → 실리코망가니즈 · 20 · 2026-10-20 → 확정 → 최준혁 계정 승인함).
- 등록할 것 없음.

## 5. 가정값 (6개 문서에 없어 정한 것 — 사용자 확인 필요)

| 무엇 | 값 | 왜 / 출처 |
|---|---|---|
| 초안 화면·api 권한 | 구매요청 등록·MRP(PURCHASE_REQUISITION_CREATE): 조회 VIEW 이상, 만들기·저장·확정·반려·다시 실행 USE | 초안은 구매요청을 만드는 일. screens.ts가 `/action-drafts/`를 구매요청 화면(VIEW)으로 이미 묶어 둠. 옛 화면도 같은 권한(보고서 2 A-9). BP-ACT-01 "실행은 사용자 권한과 업무 검증을 거치는 명령 API" |
| 메뉴가 보이는 메시지 | 사원이 보낸, 글이 있는 메시지(첨부만 있는 메시지 제외). 모든 채팅방 유형 | PLAN 6장 4번, 공통 코드 "메시지 유형은 첨부 유무로 판단"(옛 messageType 'TEXT' 대신) |
| 남의 메시지로 초안 만들기 | 방 멤버면 된다(core). 요청자는 메시지 작성자 | BP-ACT-01 "요청자는 메시지 작성자" |
| `저장` 버튼 | 둔다(확정과 별도 저장) | REQ-ACT-002 "확인·수정 후 확정". 보고서 2 C-4는 '문서에 없음'으로 적었지만 수정 단계를 나눠 저장하는 것으로 보았다 |
| 확정 뒤 반려 | 없음. 반려는 확인 대기일 때만 | 보고서 2 C-4(확정했지만 생성 실패 상태의 반려는 문서에 없음), core 규칙 |
| 다시 실행 | 확정했지만 구매요청을 만들지 못한 초안만, 요청자가 | core `executeDraft`, BP-ACT-01 중복 실행 방지 |
| 희망 입고일 오늘 이후 규칙 | 두지 않음 | 보고서 2 C-4 |
| 요청 근거 | 선택, 500자. 비우면 core가 `메시지: {원본 글}`을 구매요청 요청 근거로 넣음 | BP-PUR-01 입력 이름 '요청 근거'(C-2), core 가정값 |
| 출처 표시 | `출처: Message → ERP` | 보고서 2 C-3 7번(출처 코드 그룹은 문서에 없음), stage3 "출처는 계산해 보인다" |
| 내 초안 목록 | 내가 요청자인 초안 전체, 상태 칩 | 브리프 "list a requester's drafts" |

## 6. 공유 파일 변경

- `client/src/features/messenger/messageActions.ts`(협업 영역): `PURCHASE_REQUISITION_DRAFT_ACTION`을 가져와 `MESSAGE_ACTIONS` 배열에 넣었다(import 1줄 + 배열 1줄). 협업 노트 6장 "확장 자리"대로다. 기존 테스트 `messageActions.test.ts`는 권한이 없는 `me`를 쓰므로 그대로 통과한다.
- `client/src/app/(main)/action-drafts/[id]/page.tsx`: 준비 중 자리 → 화면(브리프 소유).
- 그 밖의 공유 파일(screens.ts, routeTitles.ts, codes, components, core 서비스)은 바꾸지 않았다. 새 경로도 없다.

## 7. 열린 질문 (사용자 확인 필요)

1. **남이 만든 초안의 알림**: 다른 멤버가 내 메시지로 초안을 만들면 요청자(나)에게 알릴 NOTIFICATION_TYPE이 없다(5개 중 맞는 것 없음). 지금은 요청자가 초안 화면의 '내 초안'에서 본다. 알림 유형을 더할지, 만들기를 내 메시지로만 제한할지 결정이 필요하다.
2. **요청자에게 구매요청 권한이 없을 때**: 요청자 = 메시지 작성자(BP-ACT-01)인데, 그 사원에게 구매요청 등록 사용 권한이 없으면 확정할 수 없다. 예: 영업 사원이 업무방에 "철광석 필요"라고 쓴 경우. **결정 전 임시 처리(검토 반영 1)**: 그런 메시지로는 초안을 만들지 않는다(COM-002, 메뉴도 막음). 고를 것: (가) 지금처럼 막는다, (나) 요청자는 역할 권한 없이도 자기 초안을 보고 확정·반려할 수 있게 한다. 만든 뒤에 요청자의 역할·사용 여부가 바뀌어 확정할 수 없게 된 초안은 지금도 확인 대기에 남는다(같은 결정으로 함께 풀린다).
3. **초안 목록 경로**: `/action-drafts`(번호 없는 목록 경로)는 만들지 않았다. 구매요청 목록의 '확인 대기 초안' 구역(옛 화면)을 남길지, 별도 목록이 필요한지 정해야 한다(보고서 2 C-4는 그 구역을 '문서에 없음'으로 적었다).
4. **AI 자동 추출**: 상대 날짜(예: "다음 주 화요일")를 메시지 작성일 기준 절대 날짜로 바꾸는 일(BP-ACT-01 구현 제안)은 AI 추출과 함께 나중에 한다.

## 8. 알려진 한계

- 병렬 작업 규칙대로 dev 서버·`next build`를 돌리지 않았다. 화면은 임시 테스트에서 서버 렌더링(renderToString, 조회 결과를 미리 넣음)으로 확인 대기·ERP 반영 두 상태와 메시지 메뉴 항목이 오류 없이 그려지는 것만 확인했다(커밋하지 않음). 병합 단계에서 빌드·화면 확인이 필요하다.
- 메신저 말풍선 아래 '구매요청 초안 보기 →' 링크(옛 화면)는 협업 영역 파일(MessageBubble)이라 넣지 않았다. 대신 메시지 메뉴가 `구매요청 초안 보기`로 바뀌고, 확정하면 시스템 메시지의 PR- 번호가 링크로 보인다.
- '내 초안' 목록은 1024px 미만 화면에서 숨는다(본문 공간 확보).
- **이 작업 트리의 전체 테스트 중 협업 영역 테스트 5개가 실패한다**(`api/messenger.test.ts` 1, `api/notifications.test.ts` 1, `api/tasks.test.ts` 1, `mock/seeds/collab.test.ts` 2). 협업 브랜치를 core 거래 시드(업무방·승인 알림 포함) 위에 합치면서 생긴 기대값 차이이며, 이 영역 변경을 되돌린 상태에서도 똑같이 실패함을 확인했다. 협업 테스트의 기대값(업무방 수·알림 수·안 읽은 수)을 병합 단계에서 고쳐야 한다.

## 9. 확인

- `npm run typecheck -w @fantasteel/client` 0 오류.
- 새 테스트: `api/actionDrafts.test.ts` 11개(만들기·중복 열기·남의 메시지·권한 COM-002·방 멤버·COM-003·ACT-001·형식 오류·요청자만·COM-001·확정 → 구매요청·작업 로그·알림·시스템 메시지·중복 실행 방지·PUR-001 실패 후 다시 실행·반려·등록부·원료 목록), `features/actionDrafts/lib/draftDisplay.test.ts` 6개 — 모두 통과.
- 전체: 208개 중 203개 통과, 실패 5개는 위 8장(협업 테스트, 기존).

## 10. 검토 반영 (2026-10-02)

검토에서 확인된 7건을 고쳤다(추출 스키마 2건은 같은 원인이라 2번 한 항목). 근거는 각 줄 끝.

1. **확정할 수 없는 요청자로 초안이 영영 막히던 문제** (02 REQ-ACT-002·003, 04 BP-ACT-01 두 승인의 구분 · 구현 제안 "요청자는 메시지 작성자")
   - `createFromMessage`가 core를 부르기 전에 메시지 작성자를 확인한다. 사용 중이 아니거나 구매요청 등록·MRP **사용** 권한이 없으면 `COM-002`(덧붙임: `요청자(메시지 작성자)에게 구매요청 등록 권한이 없어 초안을 만들 수 없어요` / `요청자(메시지 작성자)가 사용 중인 사원이 아니라 초안을 만들 수 없어요`). 초안이 생기지 않으므로 그 메시지가 막히지 않는다.
   - 새 조회 `checkRequester(messageId)`(VIEW + 방 멤버) → 메시지 메뉴 `구매요청 초안 만들기`가 같은 까닭으로 막히고(`만들 수 없음`, 툴팁 = 까닭) 누를 수 없다. 이미 있는 초안의 `구매요청 초안 보기`는 그대로 열린다.
   - 사용자 결정 전 임시 처리다 → 7장 열린 질문 2.
2. **추출 스키마 표시** (03 TRM-095, 02 REQ-ACT-001, 04 12.3 rawMaterialId·requiredTon·desiredReceiptDate·requesterId)
   - `ACTION_TYPE_CATALOG` 항목을 `fieldLabels` → `schemaFieldLabels`(원료 품목 · 수량(톤) · 희망 입고일 · 요청자) + `optionalInputLabels`(요청 근거)로 나눴다. 요청자는 payload 칸이 아니라 초안의 requester_id다.
   - 오른쪽 `초안 업무 유형` 카드: `추출 스키마 · 원료 품목 · 수량(톤) · 희망 입고일 · 요청자`, 아래 줄 `선택 입력 · 요청 근거 (추출 스키마 밖)`. 준비 중(P2) 유형은 스키마를 보이지 않는다.
   - 요청 근거 입력 자체는 5장 가정값대로 남겼다(지울지는 사용자 확인 — 아래 열린 질문 5).
3. **용어 사전에 없는 약어 `pr`** (05 2장 [강제], 03 TRM-063, 보고서 2 C-6): `pr` → `purchaseRequisition`, `prStatus` → `purchaseRequisitionStatusView`, `canUsePr` → `canUsePurchaseRequisition`, `PR_STATUS_TONE` → `PURCHASE_REQUISITION_STATUS_TONE`(내보냄), `isPrStatus` → `isPurchaseRequisitionStatus`.
4. **함수는 동사로 시작** (05 2장 이름 표, 보고서 2 C-6): `draftFormOf` → `buildDraftForm`, `draftPayloadOfForm` → `buildDraftPayload`, `tonInputText` → `formatTonInput`, `executionFailureOf` → `getExecutionFailure`, `requisitionStatusDisplay` → `getRequisitionStatusDisplay`, `draftFlowSteps` → `buildDraftFlowSteps`, `confirmFailureTitle` → `getConfirmFailureTitle`, api의 `requesterOf`·`chatRoomLabelOf`·`detailOf`·`listItemOf`·`confirmResultOf` → `buildRequesterView`·`getChatRoomLabel`·`buildDetailView`·`buildListItem`·`buildConfirmResult`, 화면 `idOf` → `parseDraftId`. 초안 카드 안 도우미(`label`·`note`·`readValue`·`unresolved`·`errorOf`·`set`)와 테스트 도우미도 동사로 바꿨다.
5. **`order` 단독 이름** (05 2장 [강제], ERD sort_order): 메시지 메뉴 등록 항목의 `order` → `sortOrder`(`MessageActionEntry`·`messageActionsFor`·설명 주석·`messageActions.test.ts`, 이 영역 항목 `sortOrder: 10`).
6. **`확정하면` 카드의 손으로 쓴 상태 표시명** (common.md 코드·표시명은 `client/src/codes`에서만, 05 4장 [강제]): `DRAFT_STATUS_LABEL.APPROVED`·`EXECUTED` + `DRAFT_STATUS_TONE`, `PURCHASE_REQUISITION_STATUS_LABEL.WAITING_APPROVAL` + `PURCHASE_REQUISITION_STATUS_TONE`.

### 공유 파일 변경 (검토 반영)
- `client/src/features/messenger/messageActions.ts`(협업 영역): `MessageActionEntry.order` → `sortOrder`(속성 이름·정렬·주석 3곳). 다른 등록 항목이 없어 영향은 이 영역 항목과 `messageActions.test.ts`뿐이다. 협업 영역에 알릴 것.

### 새 테스트
- `api/actionDrafts.test.ts`: 영업 부서장 메시지로 만들기 COM-002(초안·작업 로그가 생기지 않음, `checkRequester` 까닭), 요청자 사용 안 함 COM-002, `checkRequester` 방 멤버 아님 COM-002·없는 메시지 COM-003, 등록부 추출 스키마·선택 입력.

### 열린 질문 (추가)
5. **요청 근거 입력**: 추출 스키마(TRM-095)에 없는 선택 입력이다. 구매요청 등록(BP-PUR-01)의 '요청 근거'로 넘기려고 남겼다. 초안 화면에서 뺄지 사용자 확인이 필요하다.

### 확인
- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 74개 파일 544개 모두 통과.
