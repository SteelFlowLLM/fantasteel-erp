# 협업 — 업무·알림·메신저, 상단 알림·메신저 드롭다운 (2단계 병렬 작업)

- 2026-10-01, 작업 트리 브랜치(worktree). 근거: stage2.md "협업", 요구사항 REQ-NTF-001~002 · REQ-MSG-001~006 · REQ-ORG-004, 업무 프로세스 BP-MSG-01 · 10장(업무 OPEN → DONE) · 14.2 마지막 줄, 공통 코드 TASK_STATUS · NOTIFICATION_TYPE · CHAT_ROOM_TYPE, ERD task · notification · chat_room · chat_room_member · message, 감사 보고서 6번 A-1(드롭다운) · A-2 · A-3과 C절, PLAN 7장 "협업".
- 6개 문서 밖에서 온 것은 따로 적었다(가정값·열린 질문).

## 1. 화면과 경로

| 경로 | 화면 | 내용 |
|---|---|---|
| `/tasks?tab=tasks[&task=<id>]` | 업무·알림 > 업무 | 범위(내 업무 · 내가 만든 업무 · 전체=둘을 합침), `진행`/`완료` 두 열, 마감 지남·오늘 마감 배지, 업무 추가·고치기 창, 완료(확인 창), `화면 열기 →`(연결 화면). `task`가 있으면 그 카드를 강조 |
| `/tasks?tab=notifications[&notification=<id>]` | 업무·알림 > 알림 | 알림함: 날짜 구분, 유형 배지(5개), `부서 알림 · 부서명` 태그, 안 읽음 점, `안 읽은 것만`, `모두 읽음`, 누르면 읽음 처리 후 연결 화면으로 이동, `이전 알림 더 보기`. `notification`이 있으면 찾아서(최대 100건까지 더 불러옴) 강조, 못 찾으면 안내 |
| `/messenger[?room=<id>]` | 메신저 | 채팅방 목록 \| 대화 \| 방 정보(토글, 1280px 미만 숨김) |
| 상단 바 | 알림·메신저 드롭다운 | 안 읽음 수 배지, 최근 8건(알림은 유형 배지, 채팅방은 방 아이콘·업무방 태그), 항목·하단 버튼은 왼쪽 메뉴의 같은 화면으로 이동(SPEC 4장 1번) |

- 화면 제목 부제: 업무·알림 = `안 읽음 n · 오늘 마감 n · 마감 지남 n`(내 업무 기준), 메신저 = 고른 방 이름 또는 `채팅방 n개 · 안 읽음 n`.
- 모든 사원이 여는 화면(screens.ts `everyone`)이라 VIEW 전용 읽기 상태는 없다. 대신 업무는 만든 사람·담당자만 고치고 완료할 수 있고(아니면 버튼이 없음, API는 COM-002), 채팅방은 멤버만 본다(아니면 잠금 상태 + `채팅방 멤버만 볼 수 있어요`).

### 메신저 세부
- **목록**: 머리 `채팅방 n개 · 안 읽음 n` + `새 채팅방`, 검색(방 이름·수주번호·고객사·마지막 메시지·멤버), 필터 `전체 / 안 읽음 n / 1:1 / 그룹 / 업무방 n`, 전체 보기는 업무방 → 그룹 → 1:1 묶음, 한 줄 = 아이콘·이름·시각(오늘 HH:mm, 어제, MM-DD)·`나:`/`보낸 사람:` 마지막 메시지·안 읽음 배지, 업무방은 `고객사 · 납기 MM-DD · 멤버 n` 한 줄 더.
- **대화**: 머리(방 아이콘·이름·설명 줄, 업무방 태그, `멤버 초대`(1:1 제외), 방 정보 토글), 업무방 수주 정보 줄(수주번호 링크·고객사·납기 D-n·`수주 상세`·품목 줄 `행 유형 규격코드 · n매|개 (t) · 출고 n매|개 · 상태`(슬래브 매, 코일 개)), 날짜 구분선, `이전 메시지 더 보기`/`대화의 처음이에요`, 빈 대화 안내, 맨 아래를 보고 있지 않을 때 `새 메시지 n건`.
- **메시지**: 아바타·이름·`부서 · 직급 · 나`·시각, 본문의 @멘션 강조(나·내 부서를 부르면 노란 강조), 업무 번호 링크(수주 SO-·구매요청 PR-·출하요청 DR-, 실제 행이 있을 때만, 열 권한이 없으면 글자로), 아래에 `수주 상세 SO-… →` 같은 이동 링크 최대 3개, 첨부 칩(이름·크기·확장자·내려받기), 메시지 메뉴(아래 6장 확장 자리). 보낸 사원이 없는 메시지는 `시스템`으로 보인다.
- **입력창**: 4000자, 6줄까지 늘어남, 파일 1개(512KB까지, 첨부 취소), `@ 멘션` 버튼과 `@` 입력 시 후보 팝업(방 멤버 + 부서, 최대 8개, ↑↓·Enter/Tab·Esc), `@AI 호출` 준비 중(P2), `Enter 보내기 · Shift+Enter 줄바꿈`, 한글 조합 중 Enter는 보내지 않음.
- **방 정보**: 업무방 = 수주 요약(수주번호·고객사·납기·담당·품목별 상태·`수주 상세`), 그 밖 = 방 정보(유형·이름·개설일·만든 사람). 멤버 목록(직급·나·부서장·부서), `AI 어시스턴트 (@AI 호출) 준비 중 (P2)`, 1:1 안내.
- **새 채팅방 창**: 유형 `1:1 / 그룹`, 그룹이면 방 이름(선택, 100자), 멤버는 조직도 트리(부서 접기·부서 전체 선택·`n명 · k명 선택`·부서장 태그) 또는 이름·사원번호·부서 검색. 업무방은 수주 상세에서 연다는 안내. 같은 상대 1:1이 있으면 그 방을 연다.
- **멤버 초대 창**: 같은 조직도 고르기, 이미 멤버는 체크된 채 `참여 중`. 새 멤버는 이전 대화를 보고, 초대 시점까지는 읽은 것으로 시작한다.

## 2. 흐름과 요구사항

| 흐름 | REQ / BP |
|---|---|
| 업무에 담당자·마감일 지정, 진행 → 완료 | REQ-NTF-001, 10장 OPEN → DONE |
| 담당자가 내가 아니면 `업무 지정` 알림 | NOTIFICATION_TYPE 🟡 TASK_ASSIGNED |
| 개인·부서 알림, 부서 알림은 부서원 수만큼 행 | REQ-NTF-002, REQ-ORG-004, ERD notification |
| 같은 작업 로그 · 받는 사람은 한 번만 | BP-MSG-01 구현 제안 (createNotifications) |
| 1:1·그룹 만들기(조직도에서 멤버 선택), 업무방은 수주 연결 + 상단 수주 정보 | REQ-MSG-001 |
| 다른 탭이 보낸 메시지가 바로 보임(가짜 DB 탭 동기화) | REQ-MSG-002 |
| 메시지당 파일 1개 첨부·내려받기(방 멤버만) | REQ-MSG-003 |
| 사원별 마지막 읽은 메시지 → 안 읽은 수(목록·레일·상단) | REQ-MSG-004 |
| @사원 → 개인 MENTION, @부서 → 부서 MENTION, 업무방 새 메시지 → 나머지 멤버에게 WORK_ROOM_MESSAGE(멘션 받은 사람은 빼서 한 번만) | REQ-MSG-005, BP-MSG-01 "멘션·업무방 새 메시지를 개인·부서 알림으로" |
| 업무방 수주 링크, 본문 업무 번호 링크, 알림의 연결 화면 | REQ-MSG-006 |
| 방 멤버 권한 + ERP 대상 조회 권한(수주 요약은 수주 화면을 열 수 있을 때만) | BP-MSG-01 구현 제안 |

## 3. api 함수

- `api/tasks.ts` — `taskApi.list(scope)`, `summary(today)`, `create(input)`, `update({ id, ..., expectedUpdatedAt })`, `complete({ id, expectedUpdatedAt })`, `taskKeys`
  - 오류: 계정 없음·사용 안 함 COM-002, 만든 사람·담당자가 아님 COM-002, 없는 업무·담당자 COM-003, 열어 둔 뒤 바뀜·이미 완료 COM-001, 입력 확인(제목 200자·설명 2000자·마감일 형식·연결 화면 `/` 경로 300자·담당자 필수·사용 안 함 사원·완료한 업무 고치기)은 InputError
- `api/notifications.ts` — `notificationApi.countUnread(id)`·`listRecent(id)`(셸, 그대로 유지), `list({ unreadOnly, limit })`, `markRead(id)`, `markAllRead()`, **`notify({ type, recipientEmployeeIds?, departmentId?, title, body?, linkPath?, sourceEventId? })`**(다른 영역 화면이 따로 보낼 때. 변경 함수 안에서는 `createNotifications(tx, …)`를 바로 부른다), `notificationKeys`
- `api/messenger.ts` — `messengerApi.countUnread(id)`·`listRecentRooms(id)`(셸, 그대로 유지), `listRooms()`, `getRoom(id)`, `listMessages({ chatRoomId, limit })`, `getFile(messageId)`, `createRoom({ chatRoomType, memberIds, chatRoomName })`, `inviteMembers({ chatRoomId, memberIds })`, `sendMessage({ chatRoomId, content, file })`, `markRead({ chatRoomId, lastMessageId })`, `messengerKeys`
  - 오류: 방이 없음 COM-003, 멤버가 아님 COM-002, 다른 방 메시지로 읽음 처리 COM-003, 입력 확인(빈 메시지·4000자·512KB·1:1은 1명·그룹은 1명 이상·방 이름 100자·업무방 만들기·1:1 초대·사용 안 함 사원)은 InputError
- `api/messengerRules.ts` — 메시지 저장·읽음 위치·멘션/업무방 알림 규칙(`postMessage`), 안 읽은 수(`unreadCountOf`), 멘션 대상(`mentionTargetsOf`). api/client를 가져오지 않아 시드도 같은 규칙으로 메시지를 만든다. **업무방을 여는 core 서비스(openWorkRoom)가 첫 메시지를 넣을 때도 이 `postMessage`를 쓰면 알림 규칙이 같아진다.**
- 순수 함수: `features/tasks/lib/taskDue.ts`(마감 상태·문구·정렬·연결 화면 경로), `features/tasks/lib/taskNotice.ts`(업무 지정 알림 문구), `features/messenger/lib/messageText.ts`(멘션 찾기·업무 번호 찾기·본문 조각), `features/messenger/lib/dayLabel.ts`
- 훅: `hooks/useTasks.ts`, `hooks/useNotifications.ts`, `hooks/useMessenger.ts`(읽음 처리는 토스트 없이 메신저 조회만 다시 부름, 첨부 내려받기)
- 작업 로그: 업무·알림·메신저 변경에 맞는 BUSINESS_EVENT_TYPE이 29개 안에 없어 남기지 않는다(cross-cutting 7장과 같음).

## 4. 시드 — `client/src/mock/seeds/collab.ts`

- `seedCollab(tx)`: 업무 6건(진행 5 · 완료 1, 마감 지남·오늘·마감 전·마감 없음 섞음), 담당자가 다른 업무 5건의 `업무 지정` 알림(2건 읽음), 채팅방 3개
  - 1:1 최준혁 ↔ 정다은: 메시지 3개, **첨부 1개**(`철광석-입고계획-2610.csv`, 내용은 `SEED_FILES`)
  - 그룹 `출하 조율`(박서영·김도윤·신현우·권예진·서민지·오지훈): 메시지 5개, **사원 멘션** `@권예진`, **부서 멘션** `@품질부`(부서 알림 2건), 본문 `SO-2609-002`·`DR-2609-0002`(거래 시드 `SEED_CORE`의 번호라 `수주 상세`·`출하요청 보기` 링크가 붙음)
  - 그룹 `원료 수급`(윤성호·정다은·최준혁·강민석): 메시지 2개, 사원 멘션 `@윤성호`
  - 사원마다 읽은 위치를 달리 두어 안 읽은 수가 보인다(예: 김도윤 3, 강민석 2, 정다은 1)
- `SEED_FILES`: 시드 첨부 내용(경로 → data URL). `api/messenger.ts`의 `getFile`이 `getMockFile(path, SEED_FILES)`로 읽는다. fileStorage.ts 주석의 `seedCollaboration.ts의 SEED_FILES`는 이 파일이다.
- **등록(병합 단계)**: `mock/seeds/index.ts`의 `AREA_SEEDERS`에 거래 시드(core) 뒤로 `{ key: 'collab', run: seedCollab }`를 넣고, 시드가 바뀌므로 `MOCK_DB_VERSION`을 올린다. 업무방(WORK)은 거래 시드가 수주와 함께 만든다(이 시드는 만들지 않음).
- 시드는 `seeds/index.ts`의 `seedTxAt`과 같은 일을 하는 작은 `at()`을 따로 둔다(index ↔ collab 순환 참조를 피함).

## 5. 가정값

| 무엇 | 값 | 왜 / 출처 |
|---|---|---|
| 업무를 고치거나 완료할 수 있는 사람 | 만든 사람과 담당자 | 문서에 없음. 옛 화면은 제한 없음(서버 몫) |
| 업무 되돌리기(다시 열기) | 없음. 완료한 업무는 고칠 수 없음 | 10장 OPEN → DONE만 확정. 옛 화면의 `시작`·`할 일로`·`다시 열기`는 뺐다(보고서 6 C-3·C-5) |
| 업무 설명 길이 | 2000자 | ERD text(제한 없음). 옛 화면 값 |
| 업무 범위 `전체` | 내가 담당 ∪ 내가 만든 업무 | 옛 화면과 같음(필터, PLAN 5장 "필터 남긴다") |
| 메시지 길이 | 4000자 | ERD text. 옛 화면 값 |
| 첨부 1개 최대 크기 | 512KB, 형식 제한 없음 | REQ-MSG-003 "형식·용량 제한은 구현 단계". 브라우저 저장 공간 때문(cross-cutting 5장, seed-assumptions 4장) |
| 방 이름 길이 | 100자 | ERD chat_room.chat_room_name varchar(100) (옛 화면 50자) |
| 메시지 한 번에 불러오는 수 / 알림 한 번에 | 50 / 20 | 옛 화면 값 |
| 부서 멘션 | `@부서명` → 그 부서의 사용 중 사원 모두에게 MENTION 부서 알림(방 멤버가 아니어도) | BP-MSG-01 "멘션을 개인·부서 알림으로 전달", ERD "부서 발송은 부서원 수만큼". 멤버가 아닌 사원은 알림 본문으로 내용을 보고, 방은 잠금 상태로 보인다 |
| 업무방 알림 대상 | 보낸 사람과 이 메시지로 멘션 알림을 받은 사람을 뺀 멤버 | 같은 메시지로 두 번 알리지 않음 |
| 초대한 멤버의 읽음 위치 | 초대 시점의 마지막 메시지 | 이전 대화는 보되 안 읽음 수가 한꺼번에 늘지 않게 |
| 업무 지정 알림 문구 | 제목 `업무 지정 · {업무 제목}`, 본문 `{만든 사람}님이 업무를 맡겼어요 · 마감 {날짜}`, 연결 `/tasks?tab=tasks&task={id}` | 표시명 TASK_ASSIGNED `업무 지정` |
| 멘션 알림 문구 | `{보낸 사람}님이 멘션했어요` / `{보낸 사람}님이 {부서}를 멘션했어요`, 본문 `{방} · {내용 60자}`, 연결 `/messenger?room={id}` | |
| 업무방 알림 문구 | `{방 이름 또는 업무방 · 수주번호} 새 메시지`, 본문 `{보낸 사람}: {내용 60자}` | |
| 시드 업무·채팅방·메시지 내용 | 4장 | 시연용 |

## 6. Message → ERP 확장 자리 (3단계가 씀)

- `client/src/features/messenger/messageActions.ts`
  - `MESSAGE_ACTIONS` 배열에 한 줄을 넣거나 `registerMessageAction({ key, order?, isAvailable?(message, room, me), Component })`를 부른다.
  - `Component`는 `MessageActionProps { message: MessageView; room: ChatRoomDetailView; closeMenu }`를 받고, `features/messenger/components/MessageActionItem.tsx`로 메뉴 한 줄을 그린다. 안에서 `useAction`·`useRouter`를 써도 된다.
  - 말풍선 오른쪽 위 `더 보기` 메뉴가 `messageActionsFor(message, room, me)`를 그린다. 지금은 등록이 없어 메뉴 버튼이 보이지 않는다(stage2.md "Do not show it yet").
  - 예: `isAvailable: (message, _room, me) => message.isMine && message.content !== null && canUse(me, PERMISSION.PURCHASE_REQUISITION_CREATE)` (요청자 = 메시지 작성자, BP-ACT-01 구현 제안)

## 7. 공유 파일 변경

- 없음. 브리프가 맡긴 파일만 고쳤다.
  - `features/shell/NotificationMenu.tsx`·`MessengerMenu.tsx`(브리프 소유): 유형 배지·방 아이콘·업무방 태그·오류 안내를 더했다. 숫자·목록은 그대로 `hooks/useShellCounts.ts`(공유, 손대지 않음)를 쓴다.
  - `api/notifications.ts`·`api/messenger.ts`(브리프 소유): 셸이 쓰는 기존 내보내기(`countUnread`, `listRecent`, `listRecentRooms`, `NotificationPreview`, `ChatRoomPreview`, `RECENT_*_LIMIT`)는 이름과 모양을 그대로 두었다.
  - `features/shell/screens.ts`의 `SCREEN`·`canOpenScreen`·`screenOfPath`는 읽기만 한다(수주 요약 권한, 링크 권한).

## 8. 열린 질문 (사용자 확인 필요)

1. **SYSTEM 메시지**: PLAN 7장은 "SYSTEM 메시지는 '시스템'으로 표시"라고 하지만 ERD message.sender_id는 NOT NULL이고 MESSAGE_TYPE은 없앴다(첨부 유무로 판단). 그래서 시스템이 보내는 메시지를 만들 길이 없다. 지금은 보낸 사원을 찾을 수 없는 메시지를 `시스템`으로 보이게만 해 두었다. 업무방을 열 때 시스템 안내 메시지가 필요하면 보내는 사람을 어떻게 둘지 정해야 한다.
2. **그룹 나가기**: 옛 화면에 있었지만 문서에 없어(보고서 6 C-4) 넣지 않았다. 멤버 초대는 MSG-001 "멤버는 조직 정보에서 선택"(업무방 멤버 추가)에 필요해 남겼다.
3. **부서 멘션의 받는 사람**: 방 멤버가 아닌 부서원에게도 알림이 간다(5장). 멤버만으로 줄일지 확인 필요.
4. **업무 권한**: 만든 사람·담당자만 고치고 완료하는 규칙, 완료 되돌리기 없음(5장).
5. **알림 토스트**: 옛 화면은 새 메시지·알림이 오면 토스트를 띄웠지만 문서에 없어(보고서 6 C-4) 넣지 않았다. 배지 숫자만 실시간으로 바뀐다.

## 9. 알려진 한계

- 병렬 작업 규칙대로 dev 서버·`next build`를 돌리지 않았다. 화면 조각(목록·대화·방 정보·입력창)은 임시 테스트에서 서버 렌더링(renderToString)으로 오류 없이 그려지는 것만 확인했다(커밋하지 않음). 병합 단계에서 빌드·화면 확인이 필요하다.
- 시드가 등록되기 전(이 작업 트리)에는 화면이 비어 있다. 빈 상태 문구로 보인다.
- 실시간은 가짜 DB의 탭 동기화라 같은 브라우저의 다른 탭끼리만 된다.
- 첨부는 브라우저 저장 공간(약 5MB)을 넘으면 `InputError`로 거부된다. 시드로 초기화하면 올린 파일이 지워진다.
- 업무방 수주 요약의 수주 상태(헤더)는 품목 상태로 계산하는 규칙(REQ-SO-005)이 core 쪽이라 품목별 상태와 가장 빠른 납기만 보인다.

## 10. 확인

- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 18개 파일 122개 통과.
- 새 테스트: 업무 api 9 · 알림 api 7 · 메신저 api 13 · 협업 시드 3 · 업무 마감 5 · 메시지 본문 6 · 메시지 메뉴 등록부 2.

## 11. 검토 반영 (2026-10-02)

| 지적 | 고친 것 | 근거 |
|---|---|---|
| 업무방 수주 정보 줄·방 정보 수주 요약이 코일 품목도 `n매`로 적음 | `features/messenger/lib/salesOrderQty.ts`의 `formatItemQty`가 `PRODUCT_QTY_UNIT[itemType]`(슬래브 매, 코일 개)으로 수주·출고 매수를 적고, `WorkRoomPin`·`WorkRoomSummary`가 이를 쓴다. `WorkRoomSalesOrderItemView.itemType`은 `ProductItemType`으로 좁혔다(수주 품목은 제품만). 시드 업무방 SO-2609-003의 코일 줄은 `6개` | 04 4.1, 06 UNIT_TYPE, REQ-SO-002 |
| 수주 품목 상태 배지 색이 수주·출하 화면과 다름(취소 = neutral), 취소 배지 글자를 직접 씀 | 메신저 전용 `SALES_ORDER_ITEM_STATUS_TONE`을 지우고 수주 화면의 `SalesOrderStatusBadge`(취소 = danger, 표시명은 `SALES_ORDER_ITEM_STATUS_LABEL`)를 그대로 쓴다. 헤더 취소 배지도 `SalesOrderStatusBadge status="CANCELLED"` | common.md "badges colored by status", 보고서 1 A |
| 시드 `출하 조율` 메시지가 없는 수주 `SO-2610-001`을 가리켜 링크가 안 붙음 | 거래 시드가 실제로 만드는 `SEED_CORE.salesOrderNos[1]`(SO-2609-002)과 `SEED_CORE.waitingShipmentRequestNo`(DR-2609-0002, 같은 수주의 배정 대기 출하요청)를 쓴다. `collab.test.ts`가 두 링크를 확인한다 | 04 14.2 마지막 줄, REQ-MSG-006 |
| 업무 제목 200자면 `업무 지정 · {제목}` 알림 제목이 208자 | `features/tasks/lib/taskNotice.ts`에 `NOTIFICATION_TITLE_MAX = 200`과 `fitTitle(앞말, 내용)`을 두고, 넘치면 내용 끝을 잘라 `…`로 200자에 맞춘다. `notificationApi.notify`도 같은 상수로 확인한다 | ERD notification.title varchar(200) |
| 함수 이름이 동사로 시작하지 않음(보고서 6 C-6) | `memberIdsUnder` → `collectMemberIds`, `dayLabelOf` → `formatDayLabel`, `shortTimeOf` → `formatShortTime`, `captionOf` → `buildRoomCaption`, `linkLabelOf` → `getLinkLabel`, `extensionOf` → `getFileExtension`, `fileExtensionOk` → `isValidFileName`(이름이 비지 않고 255자 이하인지 확인하는 함수라 이름을 맞춤) | 05 2장 네이밍 |

- 새 테스트: `salesOrderQty.test.ts` 3 · `taskNotice.test.ts` 3 · `tasks.test.ts` 200자 제목 1 · `collab.test.ts` ERP 링크·코일 단위 2.
- 공유 파일 변경: 없음. `features/sales/components/SalesOrderParts.tsx`의 `SalesOrderStatusBadge`는 가져다 쓰기만 한다.

