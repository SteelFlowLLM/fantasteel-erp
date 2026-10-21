# messenger — 채팅방·메시지·첨부·읽음·실시간

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

메시지에서 구매요청 초안을 만드는 `POST messages/:id/action-drafts`는 message-action 모듈이다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-MSG-001~006, REQ-ORG-004(멤버 선택) |
| BP | BP-MSG-01 업무·알림·메신저([04] 6장) |
| 등급 | P1. @AI 호출(REQ-AST-002, P2)은 아래 '@AI 호출'에 있다 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `chat_room` | `chat_room_type`(DIRECT·GROUP·WORK), `chat_room_name`, `sales_order_id`(업무방만). CHECK `chat_room_work_sales_order_check`: WORK면 `sales_order_id` 필수 |
| 쓰기 | `chat_room_member` | `(chat_room_id, employee_id)` unique, `last_read_message_id`(안 읽은 수 계산 기준) |
| 쓰기 | `message` | `chat_room_id`, `message_type`(USER·SYSTEM, 기본 USER), `sender_id`(SYSTEM이면 null), `content`, `client_message_id`(재전송 중복 방지), `parent_message_id`(답글), `edited_at`·`deleted_at`(수정·삭제 표시), `created_at`(발송 시각). CHECK `message_type_sender_check`, 부분 unique `message_sender_client_message_id_key` — 스키마 1차(#151, 마이그레이션 `20261008013557_messenger_schema_1`) |
| 쓰기 | `message_reaction` | 스키마 2차(#159). `(message_id, employee_id, emoji)` unique — 이모지 반응 |
| 쓰기 | `message_attachment` | 스키마 3차(마이그레이션 `20261008040000_messenger_schema_3`). 메시지 1건에 파일 여러 개: `file_path`(Storage 경로), `file_name`, `file_size`(바이트, 3차 전 첨부는 null), `sort_order`(올린 순서). 옛 `message.attachment_path`·`attachment_name`은 이 표로 옮기고 지웠다 |
| 추가 컬럼 | `chat_room.pinned_message_id`, `chat_room_member.muted`·`pinned_at`, `task.message_id` | 스키마 2차: 공지 고정, 방 알림 끄기·상단 고정, 메시지에서 업무 등록 |
| 추가 컬럼 | `message.emoticon_key` varchar(32) | 스키마 4차(마이그레이션 `20261008040232_messenger_schema_4`): 이모티콘 키. 허용 목록은 shared `MESSAGE_EMOTICONS` |
| 읽기 | `employee`, `department`, `sales_order` | 멤버·업무방 상단 수주 정보 |

Prisma 관계 이름: `ChatRoom.chatRoomMembers`·`messages`, `ChatRoomMember.lastReadMessage`, `Message.sender`, `Employee.chatRoomMembers`·`messagesAsSender`.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `chat-rooms` | 채팅방 목록 | 로그인만, 내가 멤버인 방 | |
| POST | `chat-rooms` | 채팅방 생성 | 로그인만. 업무방은 연결 수주 조회 권한 확인 | 방 멤버·ERP 대상 조회 권한 모두 확인 |
| GET | `chat-rooms/:id` | 채팅방 상세 | 방 멤버 | |
| GET | `chat-rooms/:id/messages` | 메시지 목록 | 방 멤버 | 12.2의 `/messages`를 방 하위 경로로 둠. `?before=<메시지 id>&limit=` (기본 50, 최대 100) |
| POST | `chat-rooms/:id/messages` | 메시지 전송 | 방 멤버 | 실시간 수신은 WebSocket Gateway. `emoticonKey`(선택, 18번)를 주면 `content`는 비워도 된다 |
| POST | `chat-rooms/:id/attachments` | 파일 첨부 업로드 | 방 멤버 | multipart `files`(1~10개, 스키마 3차) + `content`(선택). 파일마다 10MB, 실행 파일 거부 |
| GET | `attachments/:id` | 첨부 파일 다운로드 | 방 멤버 | `:id` = `message_attachment.id` (스키마 3차) |
| POST | `chat-rooms/:id/read` | 읽음 위치 갱신 | 방 멤버 | |
| POST | `chat-rooms/:id/members` | 멤버 초대 | 방 멤버 | **명세에 없음** (방 관리, 2026-10-07 단계별 추가). `{ memberIds }` → `{ chatRoomId, addedCount }` |
| GET | `chat-rooms/:id/attachments` | 파일 모아보기 | 방 멤버 | **명세에 없음** (편의). 첨부가 있는 메시지만 최신순, `?before=&limit=` |
| GET | `chat-rooms/:id/messages/search` | 대화 검색 | 방 멤버 | **명세에 없음** (편의). `?q=`(1~100자, 대소문자 무시)`&before=&limit=`(기본 30) 최신순 |
| PATCH | `chat-rooms/:id` | 그룹방 이름 바꾸기 | 방 멤버 | **명세에 없음** (방 관리). `{ chatRoomName }` → `{ id, chatRoomName, displayName }` |
| POST | `chat-rooms/:id/leave` | 방 나가기 | 방 멤버 | **명세에 없음** (15번). → `{ chatRoomId }`. 1:1 방 COM-004 |
| PATCH | `chat-rooms/:id/settings` | 내 방 설정 | 방 멤버 | **명세에 없음** (14번). `{ muted?, pinned? }` → `{ chatRoomId, muted, pinnedAt }` |

- "방 멤버" 검사는 기능 권한 코드가 아니라 service에서 `chat_room_member`를 조회해 확인하고, 아니면 `COM-002`.
- 업무방의 "연결 수주 조회 권한"은 `hasPermission(user, { permission: 'SALES_ORDER_CREATE', level: 'VIEW' })`로 확인한다(`common/auth/auth.guard.ts`). 2026-10-15부터 업무 조회는 모든 역할이라([권한표] 3장) 기본 권한으로는 모든 사원이 통과한다. 관리자가 권한을 빼면 업무방을 만들 수 없고 방 상단 수주 정보는 'denied'로 가린다.

## 4. 업무 규칙

**채팅방**(REQ-MSG-001)
- 요청: `{ chatRoomType, memberIds(나 제외), chatRoomName?(그룹), salesOrderId?(업무방) }` → `{ id, reused }`. `memberIds`(방 만들기·초대)·`mentionedEmployeeIds`는 한 번에 **200명까지**(`CHAT_MEMBER_PICK_MAX`, 가정값, 넘으면 400 COM-004, 이슈 #488).
- 생성자는 자동으로 멤버. 멤버는 조직 정보에서 고른다 → 화면은 `GET departments`(조직도, 전 사용자)를 쓴다(`GET employees`는 관리자 전용).
- DIRECT는 두 사람(상대 1명이 아니면 COM-004). **같은 두 사람의 1:1 방이 있으면 새로 만들지 않고 그 방을 돌려준다(`reused: true`)**. 두 사람이 거의 동시에 열어도 하나만 생기게, 찾기 전에 tx 잠금(`lockChatRoomCreation`: `pg_advisory_xact_lock(hashtext('chat_room_create:direct:{작은 id}:{큰 id}'))`)을 건다. 업무방도 수주마다 같은 잠금(`work:{수주 id}`)을 건다(이슈 #488, 스키마 그대로).
- GROUP은 나 말고 1명 이상, 이름은 선택(100자).
- WORK는 `salesOrderId` 필수(빠지면 COM-004, 수주가 없으면 COM-003). **수주당 업무방 1개**: 같은 수주의 방이 있으면 그 방을 돌려주고 새로 고른 멤버만 더한다. 새 멤버는 지금까지의 메시지를 읽은 것으로 시작한다. 방 이름은 `수주번호 고객사명`.
- 상세의 수주 요약(번호·고객사·담당·품목·납기)은 수주 조회 권한이 있는 멤버에게만 준다(`salesOrderState`: none·ok·missing·denied).
- 멤버로 넣을 사원이 없으면 COM-003, 사용 중이 아니면 COM-004.
- 목록: 내가 멤버인 방 + 마지막 메시지 + 안 읽은 수.

**메시지·실시간**(REQ-MSG-002)
- 보낸 사람 = 로그인 사원. 저장은 tx 안에서, 소켓 발송은 커밋 뒤에 한다(롤백된 메시지를 보내지 않도록).
- WebSocket Gateway는 이 모듈에 둔다(`@nestjs/websockets`·`@nestjs/platform-socket.io` 의존성 있음, [05] 6장 [강제]). handshake에서 `client.handshake.headers.cookie`를 `AuthTokenService.verifyCookieSession`으로 검증하고 `AuthUserService.load`로 사원을 읽는다(둘 다 CommonModule export). 인증에 실패하면 연결을 끊는다.
- 접속 뒤 다시 끊는 때(이슈 #488): **토큰 만료 시각**(JWT `exp`, 지금 12시간)에 끊는다. **로그아웃**(`POST auth/logout`)하면 그 토큰으로 연결한 소켓만 끊는다(같은 사원의 다른 브라우저는 그대로). **퇴사 처리**(`PATCH employees/:id { isActive: false }`)하면 그 사원의 소켓을 모두 끊는다. 공통 `AuthSessionEvents`(서버 메모리 안 알림)로 전한다. 서버를 여러 대로 늘리면 공유 채널이 필요하다. 로그아웃한 토큰 자체는 HTTP에서 만료까지 유효하다(토큰 무효화 목록 없음, 따로 결정). 토큰에는 로그인마다 다른 `jti`(UUID)가 들어가 같은 1초에 두 기기에서 로그인해도 한쪽 로그아웃이 다른 쪽을 끊지 않는다. 사원을 읽는 사이 퇴사 처리가 커밋되면 그 알림이 아직 채널에 들기 전이라, 채널에 든 뒤 사원 상태를 한 번 더 본다. 만료·퇴사로 끊는 소켓은 접속 수에 세기 전에 끊어 같은 사원의 다른 기기 접속 수를 건드리지 않는다.
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
| `message:updated` | 방 멤버 전원 | `ChatMessageView` — 고침·삭제 (`isMine`은 받는 사원 기준) |
| `member:read` | 읽은 사람을 뺀 방 멤버 | `{ chatRoomId, employeeId, lastReadMessageId }` — 메시지별 안 읽은 사람 수 갱신 |
| `room:updated` | 방 멤버 전원 | `{ chatRoomId }` — 방이 새로 생기거나 업무방에 멤버가 더해졌을 때 |

- 소켓 발송이 실패해도 이미 커밋된 거래는 그대로 두고 로그만 남긴다.

**첨부**(REQ-MSG-003)
- 업로드하면 바로 메시지 1건이 생긴다(업로드 = 전송, 2026-10-07 결정). multipart 필드: `files`(1~10개, 스키마 3차부터 메시지 1건에 여러 파일), `content`(글, 선택).
- 파일 수: **10개까지**(`MESSAGE_ATTACHMENT_MAX_COUNT`, 가정값, 넘으면 multer가 400·COM-004). 하나라도 규칙에 걸리면 아무것도 저장하지 않는다.
- 제한(2026-10-07 결정): **파일마다 10MB까지**(`MESSAGE_ATTACHMENT_MAX_BYTES`, 넘으면 multer가 413·COM-004로 끊는다), **실행 파일 확장자만 거부**(`BLOCKED_ATTACHMENT_EXTENSIONS`: exe·msi·bat·cmd·com·scr·ps1·vbs·js·jar·sh·app·dll, COM-004). 파일 이름 1~255자.
- multer는 파일 이름을 latin1로 읽어 한글이 깨지므로 UTF-8로 다시 읽는다.
- 방 멤버·답글 대상(`parentMessageId`)·재전송 여부를 먼저 확인하고 저장한다(실패할 요청의 파일이 저장소에 남지 않게). 파일을 저장한 뒤 메시지 tx가 커밋되기 전에 실패하거나, 거의 동시 재전송으로 먼저 저장된 메시지를 돌려받으면 이번에 쓴 파일을 지운다(`StorageService.remove`, 이슈 #488). 커밋된 뒤의 실패(ERP 링크 조회 등)는 메시지가 파일을 쓰므로 지우지 않는다.
- 업로드: multipart(`FilesInterceptor('files')`) → 파일마다 `StorageService.save('messages', 파일명, buffer)` → 메시지 1건과 `message_attachment` 행(올린 순서 = `sort_order`, 크기 저장)을 같은 tx에서 만든다. 응답 `attachments: [{ id, fileName, fileSize }]`.
- 미리보기(목록·알림·답글·공지): 글이 없으면 `파일 · 이름`, 여러 개면 `파일 · 첫 이름 외 N개`.
- 다운로드: `:id`는 첨부(`message_attachment`) id. 방 멤버인지 확인 → `StorageService.read(path)` → `StreamableFile`(인터셉터가 감싸지 않음). ERD에 MIME 컬럼이 없어 `application/octet-stream` + `Content-Disposition: attachment; filename*=UTF-8''…`로 보낸다. 없는 첨부·삭제된 메시지의 첨부는 COM-003.
- Supabase Storage로 옮길 때는 `StorageService`만 바꾼다(`storage.service.ts` 주석).

**시스템 메시지** (2026-10-08, 스키마 1차 #151 위에서. 문서에 없는 추가 기능)
- `message_type = SYSTEM`, `sender_id = null`. 화면에는 보낸 사람 '시스템', `isSystem: true`.
- 남기는 때: 업무방을 새로 열 때(`{이름}님이 수주 {번호} 업무방을 열었어요`), 멤버 초대(`{이름}님이 {A}님, {B}님을 초대했어요`, 업무방을 다시 열며 멤버를 더할 때 포함), 그룹방 이름 바꾸기(`…방 이름을 '{이름}'(으)로 바꿨어요` / `…지웠어요`). 커밋 뒤 방 멤버에게 `message:new`.
- 안 읽은 수에 넣지 않는다(안 읽은 수는 `sender_id <> 나` 조건이라 null은 빠진다). 알림도 만들지 않는다.

**업무방 진행 알림** (2026-10-08, 문서에 없는 추가 기능)
- 공통 `BusinessEventRecorder.onRecorded`(새로 둔 연결 지점)에 메신저가 등록한다. 수주에 연결된 작업 로그(`salesOrderId`)가 아래 유형이면 **같은 tx에서** 그 수주의 업무방에 시스템 메시지 `[{작업 로그 표시명}] {업무 번호} · {사람}님`을 남긴다. 업무 번호는 작업 로그 변경 후 데이터에서 `…No`로 끝나는 첫 값.
- 유형: SALES_ORDER_CANCELLED, PRODUCTION_PLAN_CREATED·CANCELLED, REPRODUCTION_PLAN_CREATED, PRODUCTION_STARTED, PRODUCTION_RESULT_REGISTERED, SHIPMENT_REQUEST_CREATED, ALLOCATION_CONFIRMED, GOODS_ISSUE_CONFIRMED, MILL_SHEET_ISSUED. 예약·배정 추천처럼 자주 바뀌는 내부 단계는 넣지 않는다.
- 본 거래의 tx는 다른 모듈이 열어 커밋 시점을 모르므로, 소켓은 행이 보일 때까지 100·300·1000·3000·10000·30000ms 간격(약 44초. 이슈 #488 전에는 4.4초라 긴 tx면 보내지 못했다)으로 확인한 뒤 보낸다(끝까지 없으면 롤백으로 보고 보내지 않음, 그래도 화면은 다시 읽을 때 보인다). 서버를 여러 대로 늘리면 바꿔야 한다.
- 이 처리가 실패하면 본 거래도 롤백된다(같은 tx). 조회 1번 + 저장 1번이라 실패할 일은 적다.

**@AI 호출** (REQ-AST-002, BP-AST-01. 스키마 변경 없음)
- 글 메시지 본문에 `@AI`(뒤에 영문·숫자가 이어지지 않을 때, 대소문자 무시. 이메일 속 `@AI`와 **펜스 코드 블록(```…```)·인라인 코드(`…`)·`>`로 시작하는 인용 줄 안의 `@AI`는 호출이 아니다**. shared `mentionsAi`·`aiQuestionOf`, 테스트 `ai-mention.unit.spec.ts`)가 있으면 메시지를 먼저 저장해 평소처럼 돌려주고, **응답을 기다리지 않고** AI 어시스턴트(`AiAssistantService.ask`, `docs/backend/ai-assistant.md`)를 부른다. 재전송 중복(`clientMessageId`)은 새로 저장한 메시지가 아니라서 부르지 않는다. 첨부 메시지의 글에 `@AI`가 있어도 같다(파일은 AI에 넘기지 않는다).
- 질문 = 본문에서 `@AI`를 뺀 글(1000자까지). 질문이 비면 AI를 부르지 않고 "@AI 뒤에 묻고 싶은 내용을 적어 주세요"만 남긴다. 같이 넘기는 맥락: 직전 메시지 50개까지(AI 어시스턴트가 모델 문맥 길이로 다시 줄인다, 이슈 #412. 사람 말은 `이름: 글`로 user, AI 답은 assistant, 삭제·일반 시스템 메시지·글 없는 메시지는 제외)와 화면 `{ path: '/messenger?room={방 id}', title: '사내 채팅', label: 업무방이면 '수주 {번호} 업무방' }`.
- **권한**: AI는 **물은 사람의 권한**으로 조회 도구를 실행한다. 답이 **조회 도구(데이터)를 쓴 경우**에는 그 도구들의 데이터를 볼 권한이 있는 멤버에게만 보인다. 권한 기준은 AI 어시스턴트와 같되(`AssistantToolbox.canViewAll`, 필요 권한 중 하나라도 VIEW 이상. 전 역할 도구는 모두), service가 따로 보는 조건(구매요청의 부서장)은 알 수 없어 권한만 본다(못 보는 쪽으로 기운다). 용어 사전·업무 프로세스만 쓴 답은 모두에게 보인다.
  - 못 보는 멤버에게는 소켓으로 보내지 않고, 메시지 목록·대화 검색 응답에서 빼고, 방 목록의 마지막 메시지 미리보기는 `AI 어시스턴트가 답했어요`로 바꾼다.
  - 이어 묻는 맥락(직전 대화)에도 질문자가 볼 수 없는 AI 답은 넣지 않는다.
  - 그보다 앞의 이야기는 AI가 `search_room_messages`(지난 메시지 찾기)로 이 방 메시지에서 찾는다. 같은 규칙으로 지운 메시지·시스템 메시지·질문자가 볼 수 없는 AI 답은 빼고(`aiRoomSearchOf`), 낱말을 담은 메시지를 새것부터 8개까지 준다(이슈 #412).
  - 본문 첫 줄에는 `{이름}님의 질문에 답해요`로 누구 질문인지 밝힌다.
  - 판단은 볼 때마다 저장된 도구 이름과 그 사람의 현재 권한으로 한다.
- **저장**: ERD `message`에는 AI 보낸 사람이 없다(USER는 사원 필수, SYSTEM은 보낸 사람 없음). 그래서 AI 답은 **시스템 메시지**(`sender_id` null)로 저장하고 본문 맨 앞의 `[AI 어시스턴트] `(shared `AI_REPLY_PREFIX`)로 구분한다. 조회 도구를 쓴 답은 쓴 도구 이름을 접두어에 함께 적는다(`[AI 어시스턴트:get_inventory,get_sales_orders] `, 위 권한 판단용. shared `aiReplyContent`·`parseAiReply`). 응답 `ChatMessageView`는 표시를 떼고 `isAi: true`·`senderName: 'AI 어시스턴트'`(`isSystem`도 true)로 준다. 목록 미리보기·마지막 메시지 보낸 사람도 같다. 안 읽은 수·알림에는 들어가지 않는다(시스템 메시지 규칙). 스키마에 AI 보낸 사람(예: `message_type = AI`)과 보이는 범위를 두면 이 접두어 표시는 없앨 수 있다 🟡.
- **입력 중 표시**: AI가 답을 만드는 동안 방 멤버 전원(묻는 사람 포함)에게 소켓 `typing`을 `{ chatRoomId, employeeId: 0, employeeName: 'AI 어시스턴트' }`(`AI_TYPING_EMPLOYEE_ID`)로 보낸다. 화면이 몇 초(`TYPING_SHOW_MS`) 뒤 표시를 지우므로 `TYPING_SEND_INTERVAL_MS`마다 답이 저장될 때까지 다시 보내고, 화면은 `isAi` 메시지가 오면 지운다. 문구는 `AI 어시스턴트가 답을 쓰는 중…`. 답을 볼 수 없는 멤버에게도 보인다(질문이 방 대화에 있다).
- 본문 구성: `{접두어}{이름}님의 질문에 답해요` + 빈 줄 + 답 + (출처가 있으면) 빈 줄 + `출처: 용어 사전 · 예약 / 조회 데이터 · 재고 · SS275`. 답 속 업무 번호(SO-·PR-·DR-)는 일반 메시지처럼 링크가 된다.
- 실패(모델 미설정·LLM 연결 실패·시간 초과 등)는 `{이름}님의 질문에 답하지 못했어요. {이유}`를 같은 방식으로 남긴다. 답 저장 뒤 멤버에게 `message:new`.
- 작업 로그: 남기지 않는다(조회·설명만, 업무 데이터 변경 없음). 서버가 여러 대이거나 재시작되면 진행 중이던 답은 사라진다(작업 큐 없음).

**중복 전송 방지** (#151 `client_message_id`)
- 메시지 보내기·첨부 업로드에 `clientMessageId`(영문·숫자·-, 64자) 선택. 같은 사람이 같은 값으로 다시 보내면 새로 저장하지 않고 처음 메시지를 돌려준다(알림·소켓 다시 없음, 첨부는 파일도 다시 저장하지 않음). 다른 방에 같은 값이면 COM-004. 거의 동시에 두 번 들어와 부분 unique에 걸려도 먼저 저장된 메시지를 돌려준다.

**공지 고정** (12번, 스키마 2차 `chat_room.pinned_message_id`, 명세에 없는 API)
- `POST chat-rooms/:id/pin { messageId }` → 방 정보(`ChatRoomDetail`). 방 멤버 누구나, 이 방의 삭제되지 않은 일반 메시지 하나(새로 고정하면 바뀜). 다른 방 메시지 COM-003, 삭제·시스템 COM-004.
- `POST chat-rooms/:id/unpin` → 방 정보. 고정이 없으면 그대로.
- 고정·해제는 시스템 메시지(`…메시지를 공지로 고정했어요`·`…공지를 내렸어요`)와 `room:updated`. 방 정보 `pinnedMessage { id, senderName, preview, createdAt }`, 고정한 메시지가 삭제되면 null.

**메시지에서 업무 등록** (16번, 스키마 2차 `task.message_id`): 메시지 메뉴 [업무로 등록] → 업무 등록 API(`POST tasks`)에 `messageId`를 붙여 보낸다. 규칙은 `docs/backend/notification.md`. 메신저 쪽 시스템 메시지·알림은 따로 없다(담당자에게 업무 지정 알림만).

**방 나가기** (15번, ERD 변경 없음, 명세에 없는 API)
- 그룹방·업무방만(1:1은 상대 이름으로 보이는 방이라 COM-004). `chat_room_member` 행을 지운다(읽음 위치·방 설정도 사라짐). 메시지·알림은 그대로 둔다.
- 남은 멤버에게 시스템 메시지 `…님이 나갔어요`, 남은 멤버와 나간 사람 모두에게 `room:updated`. 마지막 멤버가 나가도 방 행은 남긴다.
- 다시 들어오기: 그룹방은 남은 멤버가 초대, 업무방은 수주 화면에서 다시 열면 돌아온다(`…님이 들어왔어요`).

**방 알림 끄기·목록 위 고정** (14번, 스키마 2차 `chat_room_member.muted`·`pinned_at`, 명세에 없는 API)
- `PATCH chat-rooms/:id/settings { muted?, pinned? }`: 나에게만 적용(준 값만 바꿈). 시스템 메시지 없이 나에게만 `room:updated`(내 다른 탭 갱신). 이미 고정한 방을 다시 고정하면 처음 시각을 둔다.
- 알림을 끄면 업무방 새 메시지(WORK_ROOM_MESSAGE) 알림에서 빠진다. **멘션 알림은 받는다**(가정). 화면은 메신저 배지 합계에서 뺀다(방별 안 읽은 수는 회색으로 보임).
- 목록(`GET chat-rooms`)은 내가 고정한 방이 먼저, 그 안에서는 최근 대화 순. 목록·방 정보에 `muted`·`pinnedAt`.

**이모지 반응** (13번, 스키마 2차 `message_reaction`, 명세에 없는 API)
- `POST messages/:id/reactions { emoji }` → 메시지(`ChatMessageView`). 없으면 더하고 있으면 뺀다(한 사람이 이모지마다 1번, unique `(message_id, employee_id, emoji)`). 이모지는 `MESSAGE_REACTION_EMOJIS`(👍 ✅ 👀 🙏 ❤️ 😂 + 23번 작은 철강맨 `sm:ok`·`sm:thanks`·`sm:lol`·`sm:love`, 가정값)만, 아니면 COM-004. 철강맨 반응은 문서에 없는 추가 기능이고 값을 그대로 `message_reaction.emoji`(varchar(16))에 저장한다(스키마 그대로). 그림 키는 shared `STEELMAN_REACTIONS`·`reactionEmoticonKey`.
- 같은 반응을 거의 동시에 두 번 눌러도(더블클릭) unique 오류(500) 없이 처리한다: 더하기는 `createMany(skipDuplicates)`, 빼기는 `deleteMany`(이슈 #488).
- 방 멤버만(COM-002), 삭제·시스템 메시지는 COM-004. 알림은 보내지 않고 멤버에게 `message:updated`.
- 응답 `reactions: [{ emoji, count, reactedByMe, employeeNames }]`는 처음 누른 순서, 삭제된 메시지는 빈 배열.

**이모티콘** (18번~22번·25번, 스키마 4차 `message.emoticon_key`, 문서에 없는 추가 기능)
- 묶음 3개, 133종: 철강맨 업무 41종(18번 8종 + 19번 10종 + 20번 11종 + 22번 10종 + 25번 2종: 돌아왔어요·자리에 있어요) · 철강맨 일상 80종(19번 19종 + 20번 14종 + 21번 6종: 요즘 말투 밈 + 22번 26종 + 7차 9종: 요즘 말투 밈 더 + 8차 6종: 2026년 하반기 밈) · 철강맨 행사 12종(20번: 새해·설·추석·연말·생일·환영 + 22번: 승진·크리스마스·더위·추위·휴가·축하). 키·이름·묶음은 shared `MESSAGE_EMOTICONS`(항목마다 `set`), 묶음은 `MESSAGE_EMOTICON_SETS`(`steelman-work`·`steelman-daily`·`steelman-event`). 순서가 화면 고르기 창 순서다.
- `POST chat-rooms/:id/messages { content, emoticonKey }`: 서버는 키가 `MESSAGE_EMOTICONS` 목록에 있는지만 본다(묶음은 보지 않음). 없으면 COM-004. 글과 함께 보낼 수 있고, 글·이모티콘이 모두 없으면 COM-004. 첨부 API는 받지 않는다(화면도 파일과 함께 고르지 못하게 막음). 이모티콘을 더해도 스키마는 그대로다(키는 varchar(32) 안).
- 응답 `emoticonKey`(없거나 삭제된 메시지는 null, 목록에서 뺀 키가 DB에 남아 있어도 null). 미리보기(목록·알림·답글·공지)는 글이 있으면 글, 없으면 `이모티콘 · 이름`.
- 수정은 글만 바꾼다(이모티콘이 있으면 글을 비워도 됨). 검색은 본문만 보므로 이모티콘만 있는 메시지는 나오지 않는다.
- 글 속 작은 이모티콘 (23번, 문서에 없는 추가 기능): 본문에 `:키:`(예 `:steelman-ok:`)로 적으면 화면이 작은 그림으로 그린다. 서버는 본문을 그대로 저장·검색하고, 미리보기(목록·알림·답글·공지)만 `inlineEmoticonText`로 `(확인)`처럼 이름으로 바꾼다(모르는 키는 그대로). 글자로 추천 낱말(`MESSAGE_EMOTICON_KEYWORDS`)·즐겨찾기는 화면 기능이다(`docs/CLIENT-GUIDE.md`).
- 그림은 화면의 `client/public/emoticons/<키>.gif`·`.png`(64px, 화면에서 2배). 원본과 다시 만들기는 `docs/character/steelman-emoticon/`. 최근 보낸 이모티콘은 화면이 브라우저에 둔다(서버 저장 없음, `docs/CLIENT-GUIDE.md`).

**수정·삭제·답글** (2026-10-08, 스키마 1차 #151, 명세에 없는 API)
- `PATCH messages/:id { content }`: 내 일반 메시지만(남의 것·시스템 COM-004, 비멤버 COM-002). 본문은 비울 수 없고 첨부가 있으면 비워도 된다. `edited_at`을 남기고 멤버에게 `message:updated`. 멘션 알림은 다시 보내지 않는다. 고칠 수 있는 시간 제한은 두지 않았다(팀 결정 전).
- `DELETE messages/:id`: 내 일반 메시지에 `deleted_at`만 표시한다(행·첨부 파일은 남김, 다시 지우면 그대로). 응답·목록은 본문·첨부를 비우고 `isDeleted: true`, 목록 미리보기는 '삭제된 메시지예요'. 안 읽은 수·검색·파일 모아보기·첨부 내려받기에서 빠진다. 멤버에게 `message:updated`.
- 답글: 보내기·첨부에 `parentMessageId`. 같은 방의 삭제되지 않은 일반 메시지만(없거나 다른 방 COM-003, 삭제·시스템 COM-004). 응답 `parent: { id, senderName, preview, isDeleted }`, 원본이 지워지면 preview는 빈 값.

**방 관리** (문서에 없는 기능, 2026-10-07 단계별 추가 결정)
- 멤버 초대: 1:1 방은 COM-004. 이미 멤버인 사원은 건너뛰고, 새 멤버가 없으면 COM-004. 없는 사원 COM-003·퇴사자 COM-004. 새 멤버는 이전 대화를 보고 지금까지의 메시지는 읽은 것으로 시작한다. 끝나면 기존·새 멤버 모두에게 `room:updated`.
- 이름 바꾸기: 그룹방만(1:1은 상대 이름, 업무방은 수주로 정해짐 → COM-004). 앞뒤 공백을 지우고 비우면 null(멤버 이름으로 보임), 100자까지. 끝나면 멤버에게 `room:updated`.

**편의** (문서에 없는 기능, ERD 변경 없음)
- 메시지별 안 읽은 사람 수: 응답의 `unreadMemberCount` = 보낸 사람을 뺀 멤버 중 `last_read_message_id < 메시지 id`인 수. 목록은 멤버 읽음 위치를 한 번 읽어 계산하고, 새 메시지는 (멤버 수 − 1). 누가 읽으면 다른 멤버에게 `member:read { chatRoomId, employeeId, lastReadMessageId }`를 보내 다시 읽게 한다.
- 접속 상태: 사원별 열린 소켓 수를 서버 메모리(`messenger.presence.ts`)에 센다. 탭·기기가 여러 개면 첫 연결에서 접속, 마지막이 끊길 때 나감. 서버를 여러 대로 늘리면 공유 저장소(Redis 등)가 필요하다. 사내 접속 상태는 방 멤버로 좁히지 않고 모든 사원에게 보인다.
- 입력 중: 저장하지 않는다. 화면은 방마다 3초(`TYPING_SEND_INTERVAL_MS`, 가정값)에 한 번만 보내고, 받은 쪽은 6초(`TYPING_SHOW_MS`, 가정값) 뒤 또는 그 사람의 메시지가 오면 지운다. 서버도 소켓·방마다 1.5초(그 절반)보다 자주 오면 DB를 읽지 않고 버린다(이슈 #488).
- 접속 처리 중(토큰·사원 확인, join) 소켓이 끊기면 접속 수에 세지 않는다(세면 끊김 처리가 이미 지나가 온라인으로 남는다). 끊김은 소켓마다 한 번만 센다.
- 검색은 `content ILIKE`(Prisma `contains`·`insensitive`)라 메시지가 아주 많아지면 인덱스(pg_trgm)가 필요하다.

**읽음**(REQ-MSG-004): `POST chat-rooms/:id/read { lastMessageId }` → `{ chatRoomId, lastReadMessageId, unreadCount }`. `last_read_message_id`를 그 방의 메시지 id로 갱신한다(뒤로 가지 않게 더 큰 값만, 다른 방의 메시지면 COM-003). 갱신 뒤 본인에게 `room:read`를 보낸다. 안 읽은 수 = 그 방에서 `id > last_read_message_id`이고 내가 보내지 않은 메시지 수.

**알림 연동**(REQ-MSG-005): 메시지 저장 tx 안에서 notification 서비스를 부른다. 멘션 대상은 본문을 해석하지 않고 요청의 `mentionedEmployeeIds`(사원 id 배열)로 받는다(2026-10-07 결정).
- 멘션된 멤버 → MENTION. 업무방의 새 메시지 → 보낸 사람을 뺀 멤버에게 WORK_ROOM_MESSAGE. 방 멤버가 아닌 사원·나 자신 멘션은 무시한다. 첨부 메시지는 멘션을 받지 않는다(업무방 알림만).
- 부서 멘션(@부서): 화면이 그 부서의 방 멤버(나 제외) 사원 id로 펼쳐 `mentionedEmployeeIds`로 보낸다. 방 밖 부서원에게는 보내지 않는다. P1의 부서 단위 알림(REQ-NTF-002)은 이것으로 채운다(2026-10-14 결정, notification.md 8장 "부서 알림 쓰는 곳").
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
| ~~첨부 다운로드 id~~ | 해결(스키마 3차): `attachments/:id`의 id = `message_attachment.id` | [ERD], [CSV] |
| ~~첨부 업로드 모양~~ | 결정(2026-10-07): 업로드하면 바로 메시지 1건 생성 | [CSV] |
| 파일 형식·용량 제한 | 구현 단계에서 정함(아직 없음) | [02] REQ-MSG-003 |
| ~~업무방 권한~~ | 해결(2026-10-15): 업무 조회를 모든 역할에 줘서 모든 사원이 업무방을 만들고 방 상단 수주 정보를 본다. 수주 조회 권한을 뺀 사원만 만들 수 없고 수주 정보가 가려진다 | [CSV] 채팅방 생성 비고, [권한표] |
| ~~DIRECT 중복~~ | 결정(2026-10-07): 기존 방을 돌려준다 | [02] REQ-MSG-001 |
| 멤버 추가·나가기 | 멤버 추가는 `POST chat-rooms/:id/members`로 추가함(2026-10-07). 나가기는 아직 없다(ERD `left_at` 여부 결정 필요) | [CSV] |
| ~~소켓 이벤트 이름~~ | 결정(2026-10-07): `message:new`, `room:read`, `room:updated`. 페이로드는 소켓 PR에서 정한다 | [05] 6장 |
