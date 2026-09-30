# notification API (알림·업무)

모든 경로는 `/api/v1` 아래, 로그인 필요. **권한 데코레이터는 없다** — 로그인한 누구나 자기 알림·업무를 쓴다.
응답 형식은 `{ success: true, data }` / `{ success: false, error: { code, message } }`. 아래 타입·예시는 실제 서버(포트 8801, DB `fs_org`)에 curl로 호출한 응답에서 옮겼다.
알림을 **보내는** 쪽(다른 모듈)은 HTTP가 아니라 `NotificationSender`(`toEmployees`·`toDepartment`·`toRole`)를 쓴다.

## 타입

```ts
type NotificationType = 'MENTION'|'WORK_ROOM_MESSAGE'|'APPROVAL_REQUEST'|'APPROVAL_RESULT'|'TASK'|'PRODUCTION'|'QUALITY'|'SHIPMENT'|'PURCHASE'|'SALES'|'SYSTEM'; // shared NOTIFICATION_TYPE

interface NotificationItem {
  id: number;
  notificationType: NotificationType;
  title: string;
  body: string | null;
  linkPath: string | null;      // 눌렀을 때 이동할 프론트 경로. 예: "/goods-receipts"
  departmentId: number | null;  // 부서 알림으로 왔으면 그 부서
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  items: NotificationItem[];    // 최신순 (id 내림차순)
  nextCursor: number | null;    // 다음 페이지를 받을 때 cursor로 넘긴다. 마지막이면 null
}

type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';   // shared TASK_STATUS

interface TaskView {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number;
  assigneeName: string;
  creatorId: number;
  creatorName: string;
  dueDate: string | null;       // 'YYYY-MM-DD' (시각 없음)
  taskStatus: TaskStatus;
  linkPath: string | null;
  completedAt: string | null;   // DONE이 될 때 기록, 다시 열면 null
  createdAt: string;
  updatedAt: string;
}
```

## 알림

### `GET /notifications?unreadOnly=&limit=&cursor=` → `data: NotificationPage`
내 알림만, 최신순.
```ts
interface ListNotificationsQuery {
  unreadOnly?: boolean;   // 'true'|'1'이면 안 읽은 것만. 기본 false
  limit?: number;         // 1~100, 기본 20 (초과하면 400 COM-003)
  cursor?: number;        // 이전 응답의 nextCursor. 이 id보다 오래된 알림부터
}
```
```json
{"success":true,"data":{"items":[{"id":1,"notificationType":"TASK","title":"업무 배정: 원료 입고 일정 확인","body":"김영업님이 업무를 맡겼습니다 (마감 2026-10-07)","linkPath":"/goods-receipts","departmentId":null,"isRead":false,"readAt":null,"createdAt":"2026-09-30T11:17:33.355Z"}],"nextCursor":null}}
```
페이지 넘김 예 (`limit=2`, 알림 5건): `{ids:[6,5],nextCursor:5}` → `cursor=5` → `{ids:[4,3],nextCursor:3}` → `cursor=3` → `{ids:[2],nextCursor:null}`.

### `GET /notifications/unread-count` → `data: { count: number }`
```json
{"success":true,"data":{"count":1}}
```

### `POST /notifications/:id/read` → `200`, `data: NotificationItem`
읽음 처리. 이미 읽은 알림을 다시 읽어도 성공이고 `readAt`은 처음 값 그대로(멱등). 남의 알림이거나 없는 알림은 둘 다 `404 COM-004 알림을(를) 찾을 수 없습니다`.

### `POST /notifications/read-all` → `200`, `data: { updated: number }`
내 안 읽은 알림을 모두 읽음 처리. `updated`는 바뀐 개수(이미 다 읽었으면 0).

### 실시간 (소켓 `/ws`, 연결 시 `auth: { token }`)
- `notification` — 새 알림이 생기면 수신자에게: `{ notificationType, title, body, linkPath }` (`NotificationSender`가 보냄).
- `notification-read` — 읽음 처리하면 **본인의 다른 화면**에 `{ id: number }` 또는 `{ all: true }`. 받으면 안 읽은 수·목록을 다시 불러온다. 이미 읽은 알림을 다시 읽을 때는 보내지 않는다.
- `changed` — 업무를 만들거나 고치면 모든 접속자에게 `{ topics: ['tasks'] }`.

## 업무

담당자와 마감일이 있는 할 일. 만든 사람은 항상 로그인한 사원이다 (`creatorId`를 보내면 거부).

### `GET /tasks?scope=&status=` → `data: TaskView[]`
```ts
interface ListTasksQuery {
  scope?: 'mine' | 'created' | 'all';  // mine=내가 담당(기본) · created=내가 만든 것 · all=내가 담당하거나 만든 것 (남의 업무는 조회할 수 없다)
  status?: TaskStatus;
}
```
정렬: 마감일 빠른 순(없는 것은 뒤), 같으면 최근 것 먼저.

### `POST /tasks` → `201`, `data: TaskView`
```ts
interface CreateTaskBody {
  title: string;         // 1~200자
  description?: string;  // 최대 2000자
  assigneeId: number;    // ACTIVE 사원 (사원 목록은 GET /employees/directory)
  dueDate?: string;      // 'YYYY-MM-DD', 달력에 있는 날짜만 (2026-02-31 거부)
  linkPath?: string;     // "/"로 시작하는 프론트 경로 (예: '/production/plans?plan=3'). "//…"·http 주소는 거부
}
```
담당자가 본인이 아니면 담당자에게 `TASK` 알림을 보낸다: `title: "업무 배정: {제목}"`, `body: "{만든 사람}님이 업무를 맡겼습니다 (마감 YYYY-MM-DD)"`, `linkPath`는 업무의 `linkPath`(없으면 `/tasks`). 자기에게 맡기면 알림이 없다.
```json
{"success":true,"data":{"id":1,"title":"원료 입고 일정 확인","description":"SS275 슬래브용 원료 입고 일정","assigneeId":6,"assigneeName":"서구매","creatorId":3,"creatorName":"김영업","dueDate":"2026-10-07","taskStatus":"TODO","linkPath":"/goods-receipts","completedAt":null,"createdAt":"2026-09-30T11:17:33.351Z","updatedAt":"2026-09-30T11:17:33.351Z"}}
```

### `PATCH /tasks/:id` → `data: TaskView`
만든 사람 또는 담당자만. 그 밖의 사람은 `403 COM-002 만든 사람이나 담당자만 고칠 수 있는 업무입니다`, 없으면 `404 COM-004`.
```ts
interface UpdateTaskBody {   // 생략 = 변경 없음, null = 비움 (description·dueDate·linkPath만)
  title?: string;
  description?: string | null;
  assigneeId?: number;       // 바꾸면 새 담당자에게 TASK 알림 (본인이면 없음)
  dueDate?: string | null;
  linkPath?: string | null;
}
```

### `POST /tasks/:id/status` → `200`, `data: TaskView`
```ts
interface SetTaskStatusBody { taskStatus: TaskStatus }
```
만든 사람 또는 담당자만(403 동일). `DONE`으로 바꾸면 `completedAt` 기록, 다른 상태로 되돌리면 `null`. 같은 상태로 다시 보내면 아무것도 바꾸지 않고 그대로 돌려준다 (`completedAt` 유지).
```json
{"taskStatus":"DONE","completedAt":"2026-09-30T11:17:44.209Z"}
```

## 오류 코드
`COM-002`(만든 사람·담당자가 아님) · `COM-003`(입력값 오류: 담당자가 없거나 ACTIVE가 아님, 날짜·경로 형식, 잘못된 scope/status) · `COM-004`(대상 없음) · `AUTH-002`(토큰 없음).
