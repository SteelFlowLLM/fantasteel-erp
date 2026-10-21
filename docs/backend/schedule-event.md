# 내 일정 (`server/src/modules/schedule-event/`)

문서에 없는 기능 (Voice2ERP 6단계). 회의록 확정이 만든 `schedule_event`를 참석자·등록자가 본다. 화면은 `/schedule`("내 일정").
2026-10-16부터 사원이 자기 일정을 직접 등록·수정한다(문서에 없는 기능, 스키마 변경 없음: `meeting_minutes_id`가 비어 있는 일정).

## API (명세서에 없는 경로, 로그인만 필요)

`GET /schedule-events?from=YYYY-MM-DD&to=YYYY-MM-DD`

- 내가 `schedule_event_attendee`이거나 `creator`인 일정 중 시작 시각(`start_at`)이 서울 기준 `from` 00:00 이상, `to` 다음 날 00:00 미만인 것.
- `from`·`to`가 없으면 이번 주 월~일(Asia/Seoul). `from`만 있으면 `from`부터 7일.
- 기간은 최대 62일. 형식·없는 날짜·`to < from`·62일 초과는 `COM-004`.
- 응답 배열 (`ScheduleEventView`, `shared/src/schedule-event.ts`): `id`, `scheduleEventTitle`, `scheduleEventDescription`, `startAt`, `endAt`(ISO), `linkPath`, `meetingMinutes {id, title} | null`, `attendees [{employeeId, employeeName}]`, `creator {id, name}`, `notionSync`(Notion에 넣는 일정인지), `notionPageUrl`(Notion 일정 데이터베이스 페이지, 아직 없으면 null). `startAt` 순, 같으면 `id` 순.

`POST /schedule-events` — 내 일정 직접 등록 (201)

- 본문 `ScheduleEventInput`: `scheduleEventTitle`(1~100자, 앞뒤 공백 제거), `scheduleEventDescription`(1000자까지, 빈 값은 null), `startAt`·`endAt`(ISO 8601), `notionSync?`(boolean, 보내지 않으면 넣음).
- 등록자 = 로그인 사원, 참석자 = 등록자 본인 1명. `link_path`·`meeting_minutes_id`는 null. 나만 보는 일정이라 알림을 보내지 않는다.
- `endAt <= startAt`은 `COM-004` ("끝나는 시각은 시작 시각보다 뒤여야 해요"). DB의 `end_at > start_at` CHECK보다 먼저 알린다.

`PATCH /schedule-events/:id` — 내 일정 수정 (200)

- 본문은 등록과 같다(전체를 다시 보낸다). `notionSync`를 보내지 않으면 그대로 둔다.
- 내가 볼 수 없는 일정(참석자·등록자 아님)·없는 일정은 `COM-003`(404).
- 등록자가 아니면(참석만 한 일정) `COM-002`(403) "내가 등록한 일정만 고칠 수 있어요".
- 회의록에서 등록한 일정(`meeting_minutes_id` 있음)은 회의록 쪽 기록이라 `COM-004`(409) "회의록에서 등록한 일정은 여기서 고칠 수 없어요".
- 읽기와 쓰기를 한 트랜잭션에서 한다.

`GET /schedule-events/notion-status` — 일정을 Notion에 넣을 수 있는지 (이슈 #434, 로그인만)

- `ScheduleNotionStatus { ready, reason, calendarName }`. Notion 연결(토큰)이 없으면 `ready: false` + "Notion이 연결되지 않았어요", 업무 공간(일정·회의록·할 일 데이터베이스)이 없으면 "관리자가 아직 Notion 업무 공간을 만들지 않았어요". 저장된 설정만 읽고 Notion을 부르지 않는다.
- 화면(내 일정 등록 창, 회의록 일정 후보, 철강맨AI 일정 카드)이 "Notion 캘린더에도 넣기" 옆에 보일 안내로 쓴다.

직접 등록한 나만의 일정은 작업 로그를 남기지 않는다. 삭제는 요청 범위 밖이라 만들지 않았다.

## Notion에 넣을지 (`schedule_event.notion_sync`, 이슈 #434, 문서에 없는 칸)

- 일정마다 Notion 업무 공간(일정 데이터베이스와 관리자가 고른 Notion 캘린더, [integration.md](integration.md) 12장)에 넣을지 정한다. 🟡 기본은 넣는다(기존 일정도 `true`): 지금까지의 자동 반영 동작을 그대로 두고 일정마다 뺄 수 있게 했다.
- 정하는 곳: 내 일정 등록·수정(`notionSync`), `PATCH …/notion-sync`(회의록 일정 포함), 회의록 일정 후보(`PATCH …/candidates/:key`의 `notionSync`, 확정 때 저장), 철강맨AI 일정 카드(`notionSync`, 모델이 "Notion에는 넣지 마"를 들으면 false).
- Notion 업무 공간이 아직 준비되지 않았어도 값은 그대로 저장한다: 켜 둔 일정은 준비된 뒤 다음 반영 때 올라간다(지난 30일 규칙은 같다). 회의록 확정·일정 카드 결과는 이때 이유를 돌려준다(`notionNotice`·`note`).
- 끄면 반영에서 빠지고, 이미 올라간 일정은 **다음 반영 때** Notion 캘린더 일정을 취소(`notion-calendar-cancel-events`, 초대를 보냈던 일정이면 참석자에게 취소 알림이 갈 수 있다)하고 일정 데이터베이스 페이지를 **Notion 휴지통으로 옮긴다**(`notion-delete-pages`, Notion에서 되살릴 수 있다). 그 뒤 페이지·캘린더 일정 id와 반영 시각을 지운다(TypedSQL `clearScheduleEventNotion`, `updated_at`은 그대로). 다시 켜면 새로 만든다.
- 치우기는 ERP 저장과 따로 돈다: Notion이 실패해도 끄기는 성공하고, 그 일정만 미뤄 다시 해 보며 이유는 관리 > 외부 연결의 마지막 반영 오류에 남는다. 화면은 꺼졌는데 페이지가 남은 일정을 'Notion (빼는 중)'으로 보인다.

`PATCH /schedule-events/:id/notion-sync` — Notion에 넣을지만 바꾸기 (이슈 #434, 200)

- 본문 `{ notionSync: boolean }`(빠지거나 boolean이 아니면 400). 등록자만(참석만 한 일정 `COM-002`, 볼 수 없는 일정 `COM-003`).
- **회의록에서 등록한 일정도 된다**: 내용(제목·시각)은 회의록 쪽 기록이라 `PATCH /schedule-events/:id`가 409지만, Notion에 넣을지는 회의록 작성자(= 등록자)가 내 일정 화면의 'Notion에서 빼기/넣기'로 바꾼다.

## 알림

`SCHEDULE_EVENT_ASSIGNED`의 링크는 `/schedule?week=<일정이 속한 주의 월요일>`이다 (일정 자체의 `link_path`는 `/meetings?id=<회의록>` 그대로).

## 테스트

`schedule-event.spec.ts` (묶음 `fs_collab`): 참석자·등록자·무관한 사원, 기간 거르기(끝 날짜 포함·다음 날 00:00 제외), 정렬, 기본 기간, 잘못된 기간, 62일 경계, 비로그인. 직접 등록(본인만 참석자, 다른 사원에게 안 보임, 빈 메모 null, 같은·앞선 끝 시각·빈 제목 COM-004), 수정(본인 수정, 다른 사원 COM-003, 참석만 한 사원 COM-002, 회의록 일정 COM-004 409). Notion 칸(기본 넣음, 끄기, 수정에서 안 보내면 유지, 잘못된 값 400), `notion-sync`(회의록 일정 등록자 가능, 참석자 COM-002, 남 COM-003, 빈 본문 400). 상태의 세 갈래와 읽기 실패는 `integration/notion/notion-schedule-status.unit.spec.ts`. 반영에서 빠지는지·다시 켜면 만들어지는지·`notionPageUrl`·끄면 페이지를 휴지통으로(실패 시 id 유지·이유)·캘린더 일정 취소는 `integration.spec.ts`의 'Notion 업무 공간'·'Notion 캘린더'.
