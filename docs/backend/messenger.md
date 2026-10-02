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
| 쓰기 | `message` | `chat_room_id`, `sender_id`, `content`, `attachment_path`·`attachment_name`(**메시지 1건에 파일 1개**, Storage 경로), `created_at`(발송 시각) |
| 읽기 | `employee`, `department`, `sales_order` | 멤버·업무방 상단 수주 정보 |

Prisma 관계 이름: `ChatRoom.chatRoomMembers`·`messages`, `ChatRoomMember.lastReadMessage`, `Message.sender`, `Employee.chatRoomMembers`·`messagesAsSender`.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `chat-rooms` | 채팅방 목록 | 로그인만, 내가 멤버인 방 | |
| POST | `chat-rooms` | 채팅방 생성 | 로그인만. 업무방은 연결 수주 조회 권한 확인 | 방 멤버·ERP 대상 조회 권한 모두 확인 |
| GET | `chat-rooms/:id` | 채팅방 상세 | 방 멤버 | |
| GET | `chat-rooms/:id/messages` | 메시지 목록 | 방 멤버 | 12.2의 `/messages`를 방 하위 경로로 둠 |
| POST | `chat-rooms/:id/messages` | 메시지 전송 | 방 멤버 | 실시간 수신은 WebSocket Gateway |
| POST | `chat-rooms/:id/attachments` | 파일 첨부 업로드 | 방 멤버 | 업로드는 서버에서, 형식·용량 제한은 구현 단계 |
| GET | `attachments/:id` | 첨부 파일 다운로드 | 방 멤버 | 첨부에도 방 접근 권한 적용 |
| POST | `chat-rooms/:id/read` | 읽음 위치 갱신 | 방 멤버 | |

- "방 멤버" 검사는 기능 권한 코드가 아니라 service에서 `chat_room_member`를 조회해 확인하고, 아니면 `COM-002`.
- 업무방의 "연결 수주 조회 권한"은 `hasPermission(user, { permission: 'SALES_ORDER_CREATE', level: 'VIEW' })`로 확인한다(`common/auth/auth.guard.ts`). [권한표]상 영업·생산·물류·관리자만 통과한다 🟡.

## 4. 업무 규칙

**채팅방**(REQ-MSG-001)
- 생성자는 자동으로 멤버. 멤버는 조직 정보에서 고른다 → 화면은 `GET departments`(조직도, 전 사용자)를 쓴다(`GET employees`는 관리자 전용).
- DIRECT는 두 사람, GROUP은 이름, WORK는 `salesOrderId` 필수(없으면 COM-003)이고 상세에 수주 요약(번호·고객사·품목·납기)을 함께 준다.
- 목록: 내가 멤버인 방 + 마지막 메시지 + 안 읽은 수.

**메시지·실시간**(REQ-MSG-002)
- 보낸 사람 = 로그인 사원. 저장은 tx 안에서, 소켓 발송은 커밋 뒤에 한다(롤백된 메시지를 보내지 않도록).
- WebSocket Gateway는 이 모듈에 둔다(`@nestjs/websockets`·`@nestjs/platform-socket.io` 의존성 있음, [05] 6장 [강제]). handshake에서 `client.handshake.headers.cookie`를 `AuthTokenService.verifyCookieHeader`로 검증하고 `AuthUserService.load`로 사원을 읽는다(둘 다 CommonModule export). 연결된 소켓은 자기 방들에 join.
- 목록은 최신순 페이징(이전 메시지 더 보기).

**첨부**(REQ-MSG-003)
- 업로드: multipart(`@nestjs/platform-express`의 `FileInterceptor`) → `StorageService.save('messages', 파일명, buffer)` → 반환 경로를 `attachment_path`, 원래 이름을 `attachment_name`에 저장한 메시지 1건 생성.
- 다운로드: 첨부 테이블이 없으므로 `:id`는 메시지 id로 둔다 🟡. 방 멤버인지 확인 → `StorageService.read(path)` → `StreamableFile`(인터셉터가 감싸지 않음).
- Supabase Storage로 옮길 때는 `StorageService`만 바꾼다(`storage.service.ts` 주석).

**읽음**(REQ-MSG-004): `last_read_message_id`를 그 방의 메시지 id로 갱신한다(뒤로 가지 않게 더 큰 값만). 안 읽은 수 = 그 방에서 `id > last_read_message_id`이고 내가 보내지 않은 메시지 수.

**알림 연동**(REQ-MSG-005): 메시지 저장 tx 안에서 notification 서비스를 부른다.
- 멘션된 멤버 → MENTION. 업무방의 새 메시지 → 보낸 사람을 뺀 멤버에게 WORK_ROOM_MESSAGE.
- 부분 unique `(message_id, recipient_id)` 때문에 한 메시지로 한 사람에게 알림은 1건뿐이다 → 업무방에서 멘션된 사람은 MENTION 1건만 만든다.
- `link_path`는 채팅방, 업무방이면 수주 화면으로 이동할 수 있게 한다(REQ-MSG-006).

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
| 멘션 표현 | 멘션을 저장할 컬럼이 없다. 본문 파싱(예: `@사원번호`)인지, 요청에 멘션 대상 id를 따로 받는지 정해야 한다 | [ERD] message, [02] REQ-MSG-005 |
| 첨부 다운로드 id | 첨부 테이블이 없어 `attachments/:id`의 id를 메시지 id로 볼 수밖에 없다. 경로를 `messages/:id/attachment`로 바꿀지 | [ERD], [CSV] |
| 첨부 업로드 모양 | 업로드가 곧 메시지 전송인지, 업로드 후 경로를 메시지 전송에 넘기는지 | [CSV] |
| 파일 형식·용량 제한 | 구현 단계에서 정함(아직 없음) | [02] REQ-MSG-003 |
| 업무방 권한 | 구매·품질 역할은 `SALES_ORDER_CREATE` VIEW가 없어 업무방을 만들 수 없다. 멤버로 초대받은 경우 방 상단 수주 정보를 보여도 되는지도 미정 | [CSV] 채팅방 생성 비고, [권한표] |
| DIRECT 중복 | 같은 두 사람의 1:1 방을 다시 만들 때 기존 방을 돌려줄지 | [02] REQ-MSG-001 |
| 멤버 추가·나가기 | API가 없다 | [CSV] |
| 소켓 이벤트 이름 | 메시지·읽음 이벤트 이름과 페이로드가 정해지지 않았다 | [05] 6장 |
