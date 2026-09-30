# messenger — 새로 지은 이름

용어 사전(TRM-090 `chatRoom`)과 업무 프로세스 정의서 11·12장에 없는 이름만 적는다. DB 컬럼·공통코드는 새로 만들지 않았다.

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `displayName` | `ChatRoomView` 응답 필드 | 1:1 방은 `chat_room_name`이 없어 보는 사람마다 "상대 이름"이 방 이름이 된다. 목록에 바로 쓸 값을 서버가 준다 |
| `memberCount` | `ChatRoomView` 응답 필드 | 목록·헤더의 인원 수 |
| `lastMessage` / `preview` | `ChatRoomView.lastMessage` | 방 목록의 마지막 메시지 한 줄(80자)과 시각 |
| `unreadCount` / `totalUnreadCount` | 방 목록, `GET /chat-rooms/unread-count`, 읽음 응답 | 방별·전체 안 읽은 메시지 수 (REQ-MSG-004) |
| `myLastReadMessageId` | `ChatRoomView` 응답 필드 | 로그인 사원의 읽음 위치 (DB `last_read_message_id`). "여기까지 읽음" 구분선용 |
| `salesOrder` (요약) · `salesOrderStatus` | `ChatRoomView.salesOrder` (`SalesOrderSummaryView`) | 업무방 상단 수주 요약. 헤더 상태는 저장하지 않으므로 계산값에 이름이 필요 (shared `SalesOrderStatus` 타입 이름을 따름) |
| `weightTon` | 수주 요약 품목 | 주문 매수 × 이론중량 계산값 (톤은 저장하지 않음). 공통 규칙의 `…Ton` 접미사 |
| `file` · `downloadPath` | `MessageView.file` | 첨부 메타와 내려받기 API 경로. DB의 `file_path`(저장소 키)는 밖으로 내보내지 않는다 |
| `links` · `label` · `linkPath` | `MessageView.links` | 메시지 속 ERP 번호 → 화면 경로 (REQ-MSG-006). `linkPath`는 알림의 같은 이름을 따름 |
| `hasMore` · `beforeId` · `limit` | `GET /chat-rooms/:id/messages` | 위로 스크롤 페이지 조회 |
| `memberIds` | 방 만들기·초대 요청 | 초대할 사원 id 목록 |
| `left` | 방 나가기 응답 | 처리 결과 표시 |
| `work-room` (경로) | `GET /chat-rooms/work-room?salesOrderId=` | 수주의 업무방 찾기·만들기. 용어 사전의 "업무방"을 영문 경로로 |
| `chat-read` (소켓 이벤트) | 읽음 뒤 본인 채널 | 같은 사원의 다른 창이 배지를 맞추기 위한 신호 |
| `ChatSystemMessenger` · `SystemMessageInput` | 서버 전역 제공 클래스 | 다른 모듈이 업무방에 시스템 메시지를 남길 때 쓰는 창구 |
| `MessagePublisher` | 서버 내부 클래스 | 메시지 저장 + 멤버 채널 전달을 한 곳에 (사람·파일·시스템 메시지 공통) |
| `ErpReferenceResolver` · `extractErpReferences` | 서버 내부 | 메시지 내용의 ERP 번호 찾기·검증 |
| `parseMentions` | 서버 내부 | `@이름` 멘션 찾기 |
| `AttachmentInterceptor` · `UploadedAttachment` | 서버 내부 | 첨부 업로드(메모리 수신·용량 제한) |
| `ATTACHMENT_MAX_BYTES` · `BLOCKED_ATTACHMENT_EXTENSIONS` | 서버 상수 | 첨부 제한 (20MB, 실행 파일 확장자) |
| `SALES_ORDER_VIEW_PERMISSIONS` | 서버 상수 | "수주를 볼 수 있는 권한" 묶음 (업무방 열기 조건) |
| `MENTION:<messageId>` · `WORK_ROOM_MESSAGE:<messageId>` | `notification.dedupe_key` 값 | 같은 메시지·수신자·종류의 알림 중복 방지 |
| `CHAT-DIRECT-<작은 사원 id>-<큰 사원 id>` | `number_sequence.sequence_key` 값 | 1:1 방 동시 생성을 막는 잠금용 행 (번호로 쓰지 않음). 아래 참고 |

`CHAT-DIRECT-…` 참고: `chat_room`에는 "두 사람의 1:1 방은 하나"를 막을 unique가 없고 `$queryRaw`는 금지라, `NumberingService.next()`가 잡는 카운터 행 잠금을 그 쌍의 잠금으로 빌려 쓴다. 공통 잠금 도우미가 생기면 바꾼다.
