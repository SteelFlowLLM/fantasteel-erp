# messenger — 채팅방·메시지·첨부·읽음·실시간

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

메시지에서 구매요청 초안을 만드는 `POST messages/:id/action-drafts`는 message-action 모듈이다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-MSG-001~006, REQ-ORG-004(멤버 선택) |
| BP | BP-MSG-01 업무·알림·메신저([04] 6장) |
| 등급 | P1 (@AI 호출 REQ-AST-002는 P2, 만들지 않음) |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `chat_room` | `chat_room_type`(DIRECT·GROUP·WORK), `chat_room_name`, `sales_order_id`(업무방만). CHECK `chat_room_work_sales_order_check`: WORK면 `sales_order_id` 필수 |
| 쓰기 | `chat_room_member` | `(chat_room_id, employee_id)` unique, `last_read_message_id`(안 읽은 수 계산 기준) |
| 쓰기 | `message` | `chat_room_id`, `message_type`(USER·SYSTEM, 기본 USER), `sender_id`(SYSTEM이면 null), `content`, `attachment_path`·`attachment_name`(**메시지 1건에 파일 1개**, Storage 경로), `client_message_id`(재전송 중복 방지), `parent_message_id`(답글), `edited_at`·`deleted_at`(수정·삭제 표시), `created_at`(발송 시각). CHECK `message_type_sender_check`, 부분 unique `message_sender_client_message_id_key` — 스키마 1차(#151, 마이그레이션 `20261008013557_messenger_schema_1`) |
| 읽기 | `employee`, `department`, `sales_order` | 멤버·업무방 상단 수주 정보 |

Prisma 관계 이름: `ChatRoom.chatRoomMembers`·`messages`, `ChatRoomMember.lastReadMessage`, `Message.sender`, `Employee.chatRoomMembers`·`messagesAsSender`.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `chat-rooms` | 채팅방 목록 | 로그인만, 내가 멤버인 방 | |
| POST | `chat-rooms` | 채팅방 생성 | 로그인만. 업무방은 연결 수주 조회 권한 확인 | 방 멤버·ERP 대상 조회 권한 모두 확인 |
| GET | `chat-rooms/:id` | 채팅방 상세 | 방 멤버 | |
| GET | `chat-rooms/:id/messages` | 메시지 목록 | 방 멤버 | 12.2의 `/messages`를 방 하위 경로로 둠. `?before=<메시지 id>&limit=` (기본 50, 최대 100) |
| POST | `chat-rooms/:id/messages` | 메시지 전송 | 방 멤버 | 실시간 수신은 WebSocket Gateway |
| POST | `chat-rooms/:id/attachments` | 파일 첨부 업로드 | 방 멤버 | 업로드는 서버에서, 형식·용량 제한은 구현 단계 |
| GET | `attachments/:id` | 첨부 파일 다운로드 | 방 멤버 | 첨부에도 방 접근 권한 적용 |
| POST | `chat-rooms/:id/read` | 읽음 위치 갱신 | 방 멤버 | |
| POST | `chat-rooms/:id/members` | 멤버 초대 | 방 멤버 | **명세에 없음** (방 관리, 2026-10-07 단계별 추가). `{ memberIds }` → `{ chatRoomId, addedCount }` |
| GET | `chat-rooms/:id/attachments` | 파일 모아보기 | 방 멤버 | **명세에 없음** (편의). 첨부가 있는 메시지만 최신순, `?before=&limit=` |
| GET | `chat-rooms/:id/messages/search` | 대화 검색 | 방 멤버 | **명세에 없음** (편의). `?q=`(1~100자, 대소문자 무시)`&before=&limit=`(기본 30) 최신순 |
| PATCH | `chat-rooms/:id` | 그룹방 이름 바꾸기 | 방 멤버 | **명세에 없음** (방 관리). `{ chatRoomName }` → `{ id, chatRoomName, displayName }` |

- "방 멤버" 검사는 기능 권한 코드가 아니라 service에서 `chat_room_member`를 조회해 확인하고, 아니면 `COM-002`.
- 업무방의 "연결 수주 조회 권한"은 `hasPermission(user, { permission: 'SALES_ORDER_CREATE', level: 'VIEW' })`로 확인한다(`common/auth/auth.guard.ts`). [권한표]상 영업·생산·물류·관리자만 통과한다 🟡.

## 4. 업무 규칙

**채팅방**(REQ-MSG-001)
- 요청: `{ chatRoomType, memberIds(나 제외), chatRoomName?(그룹), salesOrderId?(업무방) }` → `{ id, reused }`.
- 생성자는 자동으로 멤버. 멤버는 조직 정보에서 고른다 → 화면은 `GET departments`(조직도, 전 사용자)를 쓴다(`GET employees`는 관리자 전용).
- DIRECT는 두 사람(상대 1명이 아니면 COM-004). **같은 두 사람의 1:1 방이 있으면 새로 만들지 않고 그 방을 돌려준다(`reused: true`)**.
- GROUP은 나 말고 1명 이상, 이름은 선택(100자).
- WORK는 `salesOrderId` 필수(빠지면 COM-004, 수주가 없으면 COM-003). **수주당 업무방 1개**: 같은 수주의 방이 있으면 그 방을 돌려주고 새로 고른 멤버만 더한다. 새 멤버는 지금까지의 메시지를 읽은 것으로 시작한다. 방 이름은 `수주번호 고객사명`.
- 상세의 수주 요약(번호·고객사·담당·품목·납기)은 수주 조회 권한이 있는 멤버에게만 준다(`salesOrderState`: none·ok·missing·denied).
- 멤버로 넣을 사원이 없으면 COM-003, 사용 중이 아니면 COM-004.
- 목록: 내가 멤버인 방 + 마지막 메시지 + 안 읽은 수.

**메시지·실시간**(REQ-MSG-002)
- 보낸 사람 = 로그인 사원. 저장은 tx 안에서, 소켓 발송은 커밋 뒤에 한다(롤백된 메시지를 보내지 않도록).
- WebSocket Gateway는 이 모듈에 둔다(`@nestjs/websockets`·`@nestjs/platform-socket.io` 의존성 있음, [05] 6장 [강제]). handshake에서 `client.handshake.headers.cookie`를 `AuthTokenService.verifyCookieHeader`로 검증하고 `AuthUserService.load`로 사원을 읽는다(둘 다 CommonModule export). 인증에 실패하면 연결을 끊는다.
- namespace `/messenger`. 연결된 소켓은 채팅방이 아니라 **사원 채널**(`employee:{사원 id}`)에 join한다. 새로 초대된 방도 다시 join하지 않고 받기 위해서다. 발송은 방 멤버 각자의 사원 채널로 한다.
- 목록은 최신 메시지부터 `limit`개를 오래된 순으로 주고 `hasMore`를 붙인다. 이전 메시지는 `before`(메시지 id)로 더 불러온다(OFFSET을 쓰지 않는다).
- 본문은 앞뒤 공백을 지우고 1~4000자. 보낸 사람의 읽음 위치를 그 메시지로 옮긴다.
- 소켓 이벤트 (`shared` `MESSENGER_EVENT`):

| 이벤트 | 받는 사람 | 페이로드 |
| --- | --- | --- |
| `message:new` | 방 멤버 전원(보낸 사람 포함, 다른 탭용) | `ChatMessageView` (`isMine`은 받는 사원 기준) |
| `room:read` | 읽은 본인 | `{ chatRoomId, lastReadMessageId, unreadCount }` |
| `presence:snapshot` | 막 연결한 소켓 | `{ onlineEmployeeIds }` — 지금 접속 중인 사원 |
| `presence:changed` | 메신저에 연결된 모든 사원 | `{ employeeId, online }` — 첫 연결(접속)·마지막 연결 끊김(나감) |
| `typing` (화면 → 서버) | — | `{ chatRoomId }`. 방 멤버가 아니거나 형식이 틀리면 조용히 무시 |
| `typing` (서버 → 화면) | 보낸 사람을 뺀 방 멤버 | `{ chatRoomId, employeeId, employeeName }` |
| `member:read` | 읽은 사람을 뺀 방 멤버 | `{ chatRoomId, employeeId, lastReadMessageId }` — 메시지별 안 읽은 사람 수 갱신 |
| `room:updated` | 방 멤버 전원 | `{ chatRoomId }` — 방이 새로 생기거나 업무방에 멤버가 더해졌을 때 |

- 소켓 발송이 실패해도 이미 커밋된 거래는 그대로 두고 로그만 남긴다.

**첨부**(REQ-MSG-003)
- 업로드하면 바로 메시지 1건이 생긴다(업로드 = 전송, 2026-10-07 결정). multipart 필드: `file`(필수), `content`(글, 선택).
- 제한(2026-10-07 결정): **10MB까지**(`MESSAGE_ATTACHMENT_MAX_BYTES`, 넘으면 multer가 413·COM-004로 끊는다), **실행 파일 확장자만 거부**(`BLOCKED_ATTACHMENT_EXTENSIONS`: exe·msi·bat·cmd·com·scr·ps1·vbs·js·jar·sh·app·dll, COM-004). 파일 이름 1~255자.
- multer는 파일 이름을 latin1로 읽어 한글이 깨지므로 UTF-8로 다시 읽는다.
- 방 멤버인지 먼저 확인하고 저장한다(멤버가 아닌 사람의 파일이 저장소에 남지 않게).
- 업로드: multipart(`@nestjs/platform-express`의 `FileInterceptor`) → `StorageService.save('messages', 파일명, buffer)` → 반환 경로를 `attachment_path`, 원래 이름을 `attachment_name`에 저장한 메시지 1건 생성.
- 다운로드: 첨부 테이블이 없으므로 `:id`는 메시지 id로 둔다 🟡. 방 멤버인지 확인 → `StorageService.read(path)` → `StreamableFile`(인터셉터가 감싸지 않음). ERD에 MIME 컬럼이 없어 `application/octet-stream` + `Content-Disposition: attachment; filename*=UTF-8''…`로 보낸다. 첨부가 없는 메시지면 COM-003.
- Supabase Storage로 옮길 때는 `StorageService`만 바꾼다(`storage.service.ts` 주석).

**시스템 메시지** (2026-10-08, 스키마 1차 #151 위에서. 문서에 없는 추가 기능)
- `message_type = SYSTEM`, `sender_id = null`. 화면에는 보낸 사람 '시스템', `isSystem: true`.
- 남기는 때: 업무방을 새로 열 때(`{이름}님이 수주 {번호} 업무방을 열었어요`), 멤버 초대(`{이름}님이 {A}님, {B}님을 초대했어요`, 업무방을 다시 열며 멤버를 더할 때 포함), 그룹방 이름 바꾸기(`…방 이름을 '{이름}'(으)로 바꿨어요` / `…지웠어요`). 커밋 뒤 방 멤버에게 `message:new`.
- 안 읽은 수에 넣지 않는다(안 읽은 수는 `sender_id <> 나` 조건이라 null은 빠진다). 알림도 만들지 않는다.

**업무방 진행 알림** (2026-10-08, 문서에 없는 추가 기능)
- 공통 `BusinessEventRecorder.onRecorded`(새로 둔 연결 지점)에 메신저가 등록한다. 수주에 연결된 작업 로그(`salesOrderId`)가 아래 유형이면 **같은 tx에서** 그 수주의 업무방에 시스템 메시지 `[{작업 로그 표시명}] {업무 번호} · {사람}님`을 남긴다. 업무 번호는 작업 로그 변경 후 데이터에서 `…No`로 끝나는 첫 값.
- 유형: SALES_ORDER_CANCELLED, PRODUCTION_PLAN_CREATED·CANCELLED, REPRODUCTION_PLAN_CREATED, PRODUCTION_STARTED, PRODUCTION_RESULT_REGISTERED, SHIPMENT_REQUEST_CREATED, ALLOCATION_CONFIRMED, GOODS_ISSUE_CONFIRMED, MILL_SHEET_ISSUED. 예약·배정 추천처럼 자주 바뀌는 내부 단계는 넣지 않는다.
- 본 거래의 tx는 다른 모듈이 열어 커밋 시점을 모르므로, 소켓은 행이 보일 때까지 100·300·1000·3000ms 간격으로 확인한 뒤 보낸다(끝까지 없으면 롤백으로 보고 보내지 않음). 서버를 여러 대로 늘리면 바꿔야 한다.
- 이 처리가 실패하면 본 거래도 롤백된다(같은 tx). 조회 1번 + 저장 1번이라 실패할 일은 적다.

**중복 전송 방지** (#151 `client_message_id`)
- 메시지 보내기·첨부 업로드에 `clientMessageId`(영문·숫자·-, 64자) 선택. 같은 사람이 같은 값으로 다시 보내면 새로 저장하지 않고 처음 메시지를 돌려준다(알림·소켓 다시 없음, 첨부는 파일도 다시 저장하지 않음). 다른 방에 같은 값이면 COM-004. 거의 동시에 두 번 들어와 부분 unique에 걸려도 먼저 저장된 메시지를 돌려준다.

**방 관리** (문서에 없는 기능, 2026-10-07 단계별 추가 결정)
- 멤버 초대: 1:1 방은 COM-004. 이미 멤버인 사원은 건너뛰고, 새 멤버가 없으면 COM-004. 없는 사원 COM-003·퇴사자 COM-004. 새 멤버는 이전 대화를 보고 지금까지의 메시지는 읽은 것으로 시작한다. 끝나면 기존·새 멤버 모두에게 `room:updated`.
- 이름 바꾸기: 그룹방만(1:1은 상대 이름, 업무방은 수주로 정해짐 → COM-004). 앞뒤 공백을 지우고 비우면 null(멤버 이름으로 보임), 100자까지. 끝나면 멤버에게 `room:updated`.

**편의** (문서에 없는 기능, ERD 변경 없음)
- 메시지별 안 읽은 사람 수: 응답의 `unreadMemberCount` = 보낸 사람을 뺀 멤버 중 `last_read_message_id < 메시지 id`인 수. 목록은 멤버 읽음 위치를 한 번 읽어 계산하고, 새 메시지는 (멤버 수 − 1). 누가 읽으면 다른 멤버에게 `member:read { chatRoomId, employeeId, lastReadMessageId }`를 보내 다시 읽게 한다.
- 접속 상태: 사원별 열린 소켓 수를 서버 메모리(`messenger.presence.ts`)에 센다. 탭·기기가 여러 개면 첫 연결에서 접속, 마지막이 끊길 때 나감. 서버를 여러 대로 늘리면 공유 저장소(Redis 등)가 필요하다. 사내 접속 상태는 방 멤버로 좁히지 않고 모든 사원에게 보인다.
- 입력 중: 저장하지 않는다. 화면은 방마다 3초(`TYPING_SEND_INTERVAL_MS`, 가정값)에 한 번만 보내고, 받은 쪽은 6초(`TYPING_SHOW_MS`, 가정값) 뒤 또는 그 사람의 메시지가 오면 지운다.
- 검색은 `content ILIKE`(Prisma `contains`·`insensitive`)라 메시지가 아주 많아지면 인덱스(pg_trgm)가 필요하다.

**읽음**(REQ-MSG-004): `POST chat-rooms/:id/read { lastMessageId }` → `{ chatRoomId, lastReadMessageId, unreadCount }`. `last_read_message_id`를 그 방의 메시지 id로 갱신한다(뒤로 가지 않게 더 큰 값만, 다른 방의 메시지면 COM-003). 갱신 뒤 본인에게 `room:read`를 보낸다. 안 읽은 수 = 그 방에서 `id > last_read_message_id`이고 내가 보내지 않은 메시지 수.

**알림 연동**(REQ-MSG-005): 메시지 저장 tx 안에서 notification 서비스를 부른다. 멘션 대상은 본문을 해석하지 않고 요청의 `mentionedEmployeeIds`(사원 id 배열)로 받는다(2026-10-07 결정).
- 멘션된 멤버 → MENTION. 업무방의 새 메시지 → 보낸 사람을 뺀 멤버에게 WORK_ROOM_MESSAGE. 방 멤버가 아닌 사원·나 자신 멘션은 무시한다. 첨부 메시지는 멘션을 받지 않는다(업무방 알림만).
- 문구: MENTION `{보낸 사람}님이 멘션했어요 · {방 이름} · {미리보기}`, WORK_ROOM_MESSAGE `{방 이름} 새 메시지 · {보낸 사람}: {미리보기}`. 미리보기는 50자(가정값), 1:1 방 이름은 '1:1 채팅'. `link_path`는 아래 줄 참고.
- 부분 unique `(message_id, recipient_id)` 때문에 한 메시지로 한 사람에게 알림은 1건뿐이다 → 업무방에서 멘션된 사람은 MENTION 1건만 만든다.
- `link_path`는 `/messenger?room={방 id}&message={메시지 id}` — 알림을 누르면 그 메시지까지 이동해 강조한다. 업무방은 방 상단에서 수주 화면으로 이동한다(REQ-MSG-006).

**ERP 링크**(REQ-MSG-006): 메시지 응답의 `erpLinks`. 본문의 수주(SO-)·구매요청(PR-)·출하요청(DR-) 번호(업무 프로세스 9.1) 중 실제로 있는 문서만 `{ text, href }`로 준다. 번호 해석은 화면과 같은 `shared`의 `findErpNos`를 쓰고, 목록은 번호를 모아 종류별로 한 번씩만 조회한다. 화면을 열 권한은 화면이 따로 본다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-002 | 방 멤버가 아님, 업무방 생성 시 수주 조회 권한 없음 |
| COM-003 | 방·메시지·수주·멤버 사원 없음 |
| COM-004 | DTO 검증 실패 |

작업 로그: 없음(REQ-LOG-002에 메신저 이벤트 없음). Message → ERP 초안 이벤트는 message-action이 기록한다.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| notification | `notifyEmployees(tx, { type: MENTION \| WORK_ROOM_MESSAGE, messageId, … })` |
| message-action | 원본 메시지 조회 + 방 멤버 확인 → `MessengerService.findMessageForMember(tx, messageId, user)` export 권장 |
| sales-order | 업무방 상단 수주 요약 조회 |
| auth(common) | WebSocket handshake 인증 |

## 7. 테스트

[05] 11장 필수 대상은 아니다. [04] 14.2 "메신저 첨부·안 읽은 수·멘션 알림·ERP 화면 이동"을 기준으로 권장(`npm test -w @fantasteel/server -- messenger`, 묶음 DB `fs_collab`):

- 멤버가 아닌 사원의 메시지 조회·전송·첨부 다운로드 → COM-002.
- 업무방 생성 시 수주 없음 → 거부(CHECK 이전에 service에서 COM-003).
- 읽음 갱신 후 안 읽은 수 0, 새 메시지 1건 → 1.
- 업무방에서 멘션 → MENTION 1건, 나머지 멤버 WORK_ROOM_MESSAGE.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| ~~멘션 표현~~ | 결정(2026-10-07): 요청에 멘션 대상 사원 id 배열을 따로 받는다 | [ERD] message, [02] REQ-MSG-005 |
| 첨부 다운로드 id | 첨부 테이블이 없어 `attachments/:id`의 id를 메시지 id로 볼 수밖에 없다. 경로를 `messages/:id/attachment`로 바꿀지 | [ERD], [CSV] |
| ~~첨부 업로드 모양~~ | 결정(2026-10-07): 업로드하면 바로 메시지 1건 생성 | [CSV] |
| 파일 형식·용량 제한 | 구현 단계에서 정함(아직 없음) | [02] REQ-MSG-003 |
| 업무방 권한 | 구매·품질 역할은 `SALES_ORDER_CREATE` VIEW가 없어 업무방을 만들 수 없다. 멤버로 초대받은 경우 방 상단 수주 정보를 보여도 되는지도 미정 | [CSV] 채팅방 생성 비고, [권한표] |
| ~~DIRECT 중복~~ | 결정(2026-10-07): 기존 방을 돌려준다 | [02] REQ-MSG-001 |
| 멤버 추가·나가기 | 멤버 추가는 `POST chat-rooms/:id/members`로 추가함(2026-10-07). 나가기는 아직 없다(ERD `left_at` 여부 결정 필요) | [CSV] |
| ~~소켓 이벤트 이름~~ | 결정(2026-10-07): `message:new`, `room:read`, `room:updated`. 페이로드는 소켓 PR에서 정한다 | [05] 6장 |
