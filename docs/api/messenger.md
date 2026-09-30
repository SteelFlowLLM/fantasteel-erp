# messenger API

업무 메신저 (REQ-MSG-001~006, BP-MSG-01). 사람 사이의 1:1·그룹·업무방(수주 연결) 대화, 실시간 전달, 첨부, 읽음, 멘션·업무방 알림, ERP 화면 링크. AI 없음.

- 기본 경로 `/api/v1`, 모든 API는 `Authorization: Bearer <accessToken>` 필요.
- 응답은 `{ success: true, data }` / `{ success: false, error: { code, message } }`. 아래 타입은 `data`의 모양이다. 날짜는 ISO 8601 문자열.
- **권한은 역할이 아니라 방 멤버 여부다.** 멤버가 아니면 방·메시지·첨부 어느 것도 읽거나 쓸 수 없다 (`403 COM-002 채팅방 멤버만 이용할 수 있습니다`). 없는 방은 `404 COM-004`.
- 아래 예시 값은 실제 서버 응답에서 가져왔다.

## 공통 타입

```ts
type ChatRoomType = 'DIRECT' | 'GROUP' | 'WORK';      // shared CHAT_ROOM_TYPE (1:1 · 그룹 · 업무방)
type MessageType = 'TEXT' | 'FILE' | 'SYSTEM';         // shared MESSAGE_TYPE
type SalesOrderStatus = 'REGISTERED' | 'IN_PROGRESS' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED';

interface ChatRoomView {
  id: number;
  chatRoomType: ChatRoomType;
  chatRoomName: string | null;        // DIRECT는 null, WORK는 "#<수주번호>"
  displayName: string;                // 목록에 보여 줄 이름. DIRECT = 상대 이름, 이름 없는 GROUP = 다른 멤버 이름 나열
  salesOrderId: number | null;        // WORK만
  salesOrder: SalesOrderSummaryView | null; // WORK만 — 방 상단 수주 요약
  members: ChatRoomMemberView[];
  memberCount: number;
  lastMessage: LastMessageView | null;
  unreadCount: number;                // 내 읽음 위치 뒤의 메시지 중 내가 보내지 않은 것 (시스템 메시지 포함)
  myLastReadMessageId: number | null;
  createdAt: string;
}

interface ChatRoomMemberView {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  jobGrade: string;
  departmentId: number;
  departmentName: string;
  lastReadMessageId: number | null;   // 그 멤버의 읽음 위치
}

interface SalesOrderSummaryView {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  dueDate: string;                    // "YYYY-MM-DD"
  salesOrderStatus: SalesOrderStatus; // 품목 상태에서 계산 (deriveSalesOrderStatus)
  linkPath: string;                   // "/sales-orders/19" — 수주 화면으로 이동
  items: {
    salesOrderItemId: number;
    lineNo: number;
    specCode: string;                 // "SL-SS275-250x1200x10000"
    itemType: string;                 // "SLAB" | "COIL"
    steelGradeCode: string;
    thicknessMm: string;
    widthMm: string;
    lengthMm: string;
    orderedQty: number;
    shippedQty: number;
    weightTon: string;                // 주문 매수 × 1매 이론중량, 소수 3자리 ("141.300")
    salesOrderItemStatus: SalesOrderStatus;
  }[];
}

interface LastMessageView {
  id: number;
  senderId: number | null;
  senderName: string | null;
  messageType: MessageType;
  preview: string;                    // 한 줄 80자까지 (FILE이면 파일 이름)
  createdAt: string;
}

interface MessageView {
  id: number;
  chatRoomId: number;
  senderId: number | null;            // null = 시스템 메시지
  senderName: string | null;
  messageType: MessageType;
  content: string;                    // FILE이고 같이 보낸 말이 없으면 파일 이름
  mentionEmployeeIds: number[];
  file: { fileName: string; fileSize: number; mimeType: string; downloadPath: string } | null; // FILE만
  links: { label: string; linkPath: string }[]; // 내용에 적힌 ERP 번호 → 화면 경로 (REQ-MSG-006)
  createdAt: string;
}
```

`links` 규칙: 내용에서 수주번호 `SO-YYYYMMDD-NNNN`, 구매요청번호 `PR-YYYYMMDD-NNNN`, LOT번호(`HT-…` 히트·슬래브, `C…` 코일, `RM-…` 원료, `HM-…` 용선)를 찾아 **DB에 실제로 있는 번호만** 나온 순서대로 돌려준다. `label`은 번호 그대로라 화면은 `content` 안의 `label` 문자열을 링크로 바꾸면 된다.

| 번호 | linkPath |
|---|---|
| 수주 | `/sales-orders/:id` |
| 구매요청 | `/purchase-requisitions/:id` |
| LOT | `/lots/trace?lot=:lotNo` |

링크는 방 멤버 누구에게나 같게 준다 (번호는 이미 메시지에 적혀 있다). 이동한 ERP 화면의 조회 권한은 그 화면의 API가 확인한다.

## 채팅방

### `GET /chat-rooms` — 내 채팅방 목록
응답 `ChatRoomView[]` — 최근 대화 순 (마지막 메시지 시각, 메시지가 없으면 방 생성 시각).

```json
[{"id":49,"chatRoomType":"GROUP","chatRoomName":"출하 조율","displayName":"출하 조율","salesOrderId":null,"salesOrder":null,
  "members":[{"employeeId":3,"employeeNo":"2104012","employeeName":"김영업","jobGrade":"대리","departmentId":2,"departmentName":"영업부","lastReadMessageId":null},
             {"employeeId":8,"employeeNo":"1803021","employeeName":"박생산","jobGrade":"과장","departmentId":4,"departmentName":"생산부","lastReadMessageId":null}],
  "memberCount":2,
  "lastMessage":{"id":110,"senderId":3,"senderName":"김영업","messageType":"TEXT","preview":"두 번째 메시지","createdAt":"2026-09-30T11:18:31.024Z"},
  "unreadCount":2,"myLastReadMessageId":null,"createdAt":"2026-09-30T11:18:30.239Z"}]
```

### `POST /chat-rooms` — 방 만들기 → `201 ChatRoomView`
```ts
interface CreateChatRoomBody {
  chatRoomType: ChatRoomType;
  memberIds?: number[];     // 조직도(`GET /departments/tree`)에서 고른 사원 id. 만든 사람은 안 넣어도 항상 포함
  chatRoomName?: string;    // GROUP만 사용 (50자까지, 생략 가능)
  salesOrderId?: number;    // WORK 필수
}
```
- `DIRECT`: 나를 뺀 상대가 정확히 1명. 두 사람의 1:1 방이 이미 있으면 **새로 만들지 않고 그 방을 돌려준다** (그래도 201).
- `GROUP`: 나를 뺀 상대 1명 이상.
- `WORK`: 수주 1건에 업무방 1개. 이미 있으면 그 방에 나(와 `memberIds`)를 멤버로 넣고 돌려준다. 이름은 `#<수주번호>`. 수주를 볼 수 있는 권한(아래 work-room과 같음)이 필요하다.
- 오류: `400 COM-003` (상대 수가 맞지 않음 / 재직 중이 아닌 사원·없는 사원 포함 `재직 중인 사원만 초대할 수 있습니다` / WORK에 salesOrderId 없음), `403 COM-002` (WORK인데 수주 조회 권한 없음), `404 COM-004` (없는 수주).

### `GET /chat-rooms/work-room?salesOrderId=` — 수주의 업무방 열기 → `200 ChatRoomView`
ERP 화면의 "업무방" 버튼용. 업무방을 찾고, 없으면 만들고, 부른 사람을 멤버로 넣는다 (GET이지만 데이터가 바뀔 수 있다).
- 권한: `ORDER_CREATE` · `PLAN_CONFIRM` · `SHIPMENT_REQUEST` · `GOODS_ISSUE_CONFIRM` · `PURCHASE_REQUISITION_CREATE` · `INSPECTION_REGISTER` 중 하나를 VIEW 이상. 없으면 `403 COM-002`.
- 오류: `400 COM-003` (salesOrderId 누락·숫자 아님), `404 COM-004 수주을(를) 찾을 수 없습니다`.
- 이미 있던 방에 새로 들어오면 방에 시스템 메시지 `○○님이 들어왔습니다`가 남는다.

```json
{"id":51,"chatRoomType":"WORK","chatRoomName":"#SO-20260930-9353","displayName":"#SO-20260930-9353","salesOrderId":19,
 "salesOrder":{"salesOrderId":19,"salesOrderNo":"SO-20260930-9353","customerName":"한빛중공업","dueDate":"2026-10-20","salesOrderStatus":"REGISTERED","linkPath":"/sales-orders/19",
   "items":[{"salesOrderItemId":37,"lineNo":1,"specCode":"SL-SS275-250x1200x10000","itemType":"SLAB","steelGradeCode":"SS275","thicknessMm":"250","widthMm":"1200","lengthMm":"10000","orderedQty":6,"shippedQty":0,"weightTon":"141.300","salesOrderItemStatus":"REGISTERED"}]},
 "members":[{"employeeId":3,"employeeNo":"2104012","employeeName":"김영업","jobGrade":"대리","departmentId":2,"departmentName":"영업부","lastReadMessageId":null},
            {"employeeId":8,"employeeNo":"1803021","employeeName":"박생산","jobGrade":"과장","departmentId":4,"departmentName":"생산부","lastReadMessageId":112},
            {"employeeId":17,"employeeNo":"2005024","employeeName":"윤물류","jobGrade":"대리","departmentId":10,"departmentName":"물류부","lastReadMessageId":113}],
 "memberCount":3,
 "lastMessage":{"id":113,"senderId":null,"senderName":null,"messageType":"SYSTEM","preview":"윤물류님이 들어왔습니다","createdAt":"2026-09-30T11:18:31.968Z"},
 "unreadCount":2,"myLastReadMessageId":null,"createdAt":"2026-09-30T11:18:31.944Z"}
```

### `GET /chat-rooms/:id` — 방 상세 → `ChatRoomView` (멤버만)

### `POST /chat-rooms/:id/members` — 멤버 초대 → `200 ChatRoomView`
Body `{ memberIds: number[] }` (1명 이상). 방 멤버면 누구나 초대할 수 있다. 이미 멤버인 사람은 건너뛴다.
- 새 멤버는 이전 대화를 볼 수 있지만, 들어오기 전 메시지는 안 읽은 수로 세지 않는다.
- 방에 시스템 메시지 `○○님이 △△님을 초대했습니다`가 남는다.
- 오류: `409 COM-005` (DIRECT 방 — `1:1 대화에는 멤버를 추가할 수 없습니다. 그룹 대화를 새로 만들어 주세요`), `400 COM-003` (재직 중이 아닌 사원).

### `DELETE /chat-rooms/:id/members/me` — 방 나가기 → `200 { chatRoomId: number; left: true }`
GROUP만. DIRECT·WORK는 `409 COM-005 그룹 대화에서만 나갈 수 있습니다`. 방에 `○○님이 나갔습니다`가 남는다.

## 메시지

### `GET /chat-rooms/:id/messages?beforeId=&limit=` → `{ items: MessageView[]; hasMore: boolean }`
- `limit` 기본 50, 최대 100. `beforeId`가 없으면 최신 쪽 한 페이지.
- `items`는 **오래된 것 → 최신 순**. `hasMore`가 true면 `items[0].id`를 `beforeId`로 넣어 더 오래된 쪽을 받는다.

```json
{"items":[{"id":117,"chatRoomId":49,"senderId":null,"senderName":null,"messageType":"SYSTEM","content":"박생산님이 윤물류님을 초대했습니다","mentionEmployeeIds":[],"file":null,"links":[],"createdAt":"2026-09-30T11:18:32.304Z"},
          {"id":118,"chatRoomId":49,"senderId":null,"senderName":null,"messageType":"SYSTEM","content":"윤물류님이 나갔습니다","mentionEmployeeIds":[],"file":null,"links":[],"createdAt":"2026-09-30T11:18:32.309Z"}],
 "hasMore":true}
```

### `POST /chat-rooms/:id/messages` — 메시지 보내기 → `201 MessageView`
```ts
interface PostMessageBody {
  content: string;                 // 앞뒤 공백 제거 후 1~4000자
  mentionEmployeeIds?: number[];   // 멘션 고르기 UI가 있으면 보낸다
}
```
- `mentionEmployeeIds`를 **보내면** 그 값을 쓴다 (방 멤버가 아닌 id와 나 자신은 조용히 뺀다. `[]`면 멘션 없음).
- **안 보내면** 서버가 `content`의 `@이름`을 방 멤버 이름과 맞춰 찾는다 (`@박생산님`처럼 뒤에 글자가 붙어도 된다. 같은 이름의 멤버가 둘이면 둘 다).
- 저장이 커밋된 뒤 방 멤버 전원(보낸 사람 포함)에게 소켓 `message`가 나간다. 보낸 창은 이 응답으로, 다른 창·다른 사람은 소켓으로 받으므로 **`id`로 중복을 걸러야 한다.**
- 오류: `400 COM-003 메시지 내용을 입력해 주세요`.

```json
{"id":109,"chatRoomId":49,"senderId":3,"senderName":"김영업","messageType":"TEXT",
 "content":"@박생산님 SO-20260930-9353 건 슬래브 HT-1-260921-001-01 확인 부탁드립니다. (없는 번호 SO-20010101-0001)",
 "mentionEmployeeIds":[8],"file":null,
 "links":[{"label":"SO-20260930-9353","linkPath":"/sales-orders/19"},{"label":"HT-1-260921-001-01","linkPath":"/lots/trace?lot=HT-1-260921-001-01"}],
 "createdAt":"2026-09-30T11:18:30.592Z"}
```

## 첨부 (REQ-MSG-003)

### `POST /chat-rooms/:id/files` — 파일 보내기 → `201 MessageView` (`messageType: 'FILE'`)
`multipart/form-data`: `file`(필수, 1개), `content`(선택 — 같이 보낼 말, 4000자까지. 없으면 파일 이름이 content가 된다).

**제한 (v2에서 정함)**
- 크기: 1바이트 이상 **20MB 이하**. 초과 시 `413 COM-003 첨부 파일은 20MB까지 올릴 수 있습니다`.
- 형식: 실행 파일 확장자는 받지 않는다 → `400 COM-003 실행 파일 형식은 첨부할 수 없습니다`.
  `.exe .msi .bat .cmd .com .scr .pif .cpl .dll .sys .vbs .vbe .js .jse .wsf .wsh .ps1 .sh .jar .app .apk .dmg .pkg .deb .rpm .lnk .reg .hta` (대소문자 무시). 그 밖의 형식은 모두 허용.
- 파일 이름은 경로를 떼고 200자까지. 파일이 없으면 `400 COM-003 첨부할 파일을 선택해 주세요`.

```json
{"id":111,"chatRoomId":49,"senderId":3,"senderName":"김영업","messageType":"FILE","content":"성적서 보냅니다","mentionEmployeeIds":[],
 "file":{"fileName":"검사 성적서 1790767111351.pdf","fileSize":1234567,"mimeType":"application/pdf","downloadPath":"/api/v1/messages/111/file"},
 "links":[],"createdAt":"2026-09-30T11:18:31.388Z"}
```

### `GET /messages/:id/file` — 내려받기 (그 방의 멤버만)
- 파일 바이트를 그대로 준다 (`{success,data}`로 감싸지 않음). 헤더: `Content-Type: <올릴 때의 mimeType>`, `Content-Length`, `Content-Disposition: attachment; filename="…"; filename*=UTF-8''<원래 파일 이름>`, `X-Content-Type-Options: nosniff`.
- 인증은 `Authorization` 헤더 또는 일반 링크용 `?access_token=<accessToken>`. 예: `<a href="{서버}{file.downloadPath}?access_token={token}">`.
- 항상 `attachment`로 내려간다. 이미지를 대화 안에 미리 보여 주려면 `fetch`로 받아 `blob:` URL을 만든다.
- 오류: `401 AUTH-002`, `403 COM-002` (멤버 아님), `404 COM-004 첨부 파일을(를) 찾을 수 없습니다` (없는 메시지·파일 메시지가 아님·저장소에 파일 없음).

## 읽음 (REQ-MSG-004)

### `PUT /chat-rooms/:id/read` → `200 ReadStateView`
```ts
interface MarkReadBody { lastReadMessageId?: number }  // 생략(본문 없음)하면 방의 최신 메시지까지
interface ReadStateView {
  chatRoomId: number;
  lastReadMessageId: number | null;  // 갱신 뒤의 내 읽음 위치
  unreadCount: number;               // 이 방에 남은 안 읽은 수
  totalUnreadCount: number;          // 내 모든 방의 합 (메뉴 배지)
}
```
- 읽음 위치는 **뒤로 가지 않는다** (더 작은 id를 보내면 그대로 두고 현재 상태를 돌려준다). 방의 최신 메시지 id보다 큰 값은 최신 id로 맞춘다.
- 이 방을 끝까지 읽으면(`unreadCount: 0`) 이 방의 멘션·업무방 알림도 읽음 처리되고, 본인에게 소켓 `changed { topics: ['notifications'] }`가 나간다.
- 같은 사원의 다른 창을 위해 본인 채널로 소켓 `chat-read`가 나간다.

```json
{"chatRoomId":49,"lastReadMessageId":110,"unreadCount":0,"totalUnreadCount":0}
```

### `GET /chat-rooms/unread-count` → `{ totalUnreadCount: number }`

## 소켓 이벤트

연결: socket.io, `path: '/ws'`, `auth: { token: accessToken }`. 토큰이 잘못되면 서버가 바로 끊는다 (`disconnect` 사유 `io server disconnect`). 연결되면 서버가 사원별 채널에 넣어 주므로 방에 join하는 절차는 없다. **클라이언트 → 서버 이벤트는 없다** (보내기·읽음은 모두 REST).

```ts
const socket = io(SERVER_ORIGIN, { path: '/ws', auth: { token } });
```

| 이벤트 | 받는 사람 | payload | 언제 |
|---|---|---|---|
| `message` | 그 방의 멤버 전원 (보낸 사람 포함) | `MessageView` — REST 응답의 `data`와 같은 모양 | 메시지·파일·시스템 메시지가 저장(커밋)된 뒤 |
| `chat-read` | 읽은 본인만 (모든 창) | `ReadStateView` | `PUT /chat-rooms/:id/read` 뒤 |
| `changed` | 방 목록이 달라진 멤버만 | `{ topics: ['chat-rooms'] }` | 방 생성, 멤버 초대·입장·나가기 → `GET /chat-rooms` 다시 부르기 |
| `changed` | 본인만 | `{ topics: ['notifications'] }` | 방을 다 읽어 그 방 알림이 읽음 처리됨 |
| `notification` | 알림 받는 사람 | `{ notificationType: 'MENTION' \| 'WORK_ROOM_MESSAGE'; title: string; body: string \| null; linkPath: string \| null }` | 멘션·업무방 새 메시지 (알림 모듈이 보냄) |

`message` 처리 예: 열려 있는 방이면 목록에 붙이고 `PUT …/read`, 아니면 그 방의 `unreadCount`(보낸 사람이 내가 아닐 때)와 `lastMessage`를 올린다. 새 메시지에는 `changed{chat-rooms}`가 **나가지 않는다.**

```json
// message
{"id":109,"chatRoomId":49,"senderId":3,"senderName":"김영업","messageType":"TEXT","content":"@박생산님 SO-20260930-9353 건 …","mentionEmployeeIds":[8],"file":null,
 "links":[{"label":"SO-20260930-9353","linkPath":"/sales-orders/19"},{"label":"HT-1-260921-001-01","linkPath":"/lots/trace?lot=HT-1-260921-001-01"}],"createdAt":"2026-09-30T11:18:30.592Z"}
// chat-read
{"chatRoomId":49,"lastReadMessageId":110,"unreadCount":0,"totalUnreadCount":0}
// notification (멘션)
{"notificationType":"MENTION","title":"김영업님이 멘션했습니다","body":"출하 조율 · @박생산님 SO-20260930-9353 건 슬래브 HT-1-260921-001-01 확인 부탁드립니다. (없는 번호 SO-20010101-00…","linkPath":"/messenger?room=49"}
```

## 알림 규칙 (REQ-MSG-005)

알림은 알림 모듈(`NotificationSender`)로 만들며 `linkPath`는 `/messenger?room=<chatRoomId>`. 보낸 사람 본인과 재직 중이 아닌 멤버에게는 보내지 않는다.

| 알림 | 대상 | dedupeKey | title / body |
|---|---|---|---|
| `MENTION` | 멘션된 멤버. 모든 방 유형, 메시지마다 | `MENTION:<messageId>` | `김영업님이 멘션했습니다` / `<방 이름> · <내용 80자>` (1:1은 내용만) |
| `WORK_ROOM_MESSAGE` | 업무방(WORK)의 나머지 멤버 | `WORK_ROOM_MESSAGE:<messageId>` | `#SO-20260930-9353 새 메시지` / `김영업: <내용 80자>` |

- **업무방 알림 묶기**: 그 방의 `WORK_ROOM_MESSAGE` 알림을 아직 읽지 않은 멤버에게는 새 메시지가 와도 다시 보내지 않는다. 알림을 읽거나 방을 끝까지 읽으면(`PUT …/read`) 다음 메시지부터 다시 간다. (메시지 3건을 연달아 보내면 알림은 멤버당 1건.)
- 같은 메시지로 멘션 알림을 받는 사람에게는 업무방 알림을 겹쳐 보내지 않는다.
- DIRECT·GROUP의 멘션 없는 메시지, 시스템 메시지는 알림을 만들지 않는다 (안 읽은 수 배지로만 보인다).

## 다른 서버 모듈용 — `ChatSystemMessenger`

`MessengerModule`이 전역으로 내보낸다. 생성자에 주입해서 쓴다.

```ts
constructor(private readonly chatSystem: ChatSystemMessenger) {}
await this.chatSystem.post(tx, { salesOrderId, content: '출고 확정: 슬래브 6매 (SO-20260930-0001)' }); // → 메시지 id | null
```
- 본 거래와 같은 `tx`를 넘긴다. 롤백되면 메시지도 남지 않고, 소켓 `message`는 커밋 뒤에 나간다.
- 그 수주의 업무방이 없으면 아무것도 하지 않고 `null` (방을 만들지 않는다).
- `senderId: null`, `messageType: 'SYSTEM'`. 안 읽은 수에는 들어가고 알림은 만들지 않는다. 내용의 ERP 번호는 링크가 된다.
