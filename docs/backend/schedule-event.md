# 내 일정 (`server/src/modules/schedule-event/`)

문서에 없는 기능 (Voice2ERP 6단계). 회의록 확정이 만든 `schedule_event`를 참석자·등록자가 본다. 화면은 `/schedule`("내 일정").
2026-10-16부터 사원이 자기 일정을 직접 등록·수정한다(문서에 없는 기능, 스키마 변경 없음: `meeting_minutes_id`가 비어 있는 일정).

## API (명세서에 없는 경로, 로그인만 필요)

`GET /schedule-events?from=YYYY-MM-DD&to=YYYY-MM-DD`

- 내가 `schedule_event_attendee`이거나 `creator`인 일정 중 시작 시각(`start_at`)이 서울 기준 `from` 00:00 이상, `to` 다음 날 00:00 미만인 것.
- `from`·`to`가 없으면 이번 주 월~일(Asia/Seoul). `from`만 있으면 `from`부터 7일.
- 기간은 최대 62일. 형식·없는 날짜·`to < from`·62일 초과는 `COM-004`.
- 응답 배열 (`ScheduleEventView`, `shared/src/schedule-event.ts`): `id`, `scheduleEventTitle`, `scheduleEventDescription`, `startAt`, `endAt`(ISO), `linkPath`, `meetingMinutes {id, title} | null`, `attendees [{employeeId, employeeName}]`, `creator {id, name}`. `startAt` 순, 같으면 `id` 순.

`POST /schedule-events` — 내 일정 직접 등록 (201)

- 본문 `ScheduleEventInput`: `scheduleEventTitle`(1~100자, 앞뒤 공백 제거), `scheduleEventDescription`(1000자까지, 빈 값은 null), `startAt`·`endAt`(ISO 8601).
- 등록자 = 로그인 사원, 참석자 = 등록자 본인 1명. `link_path`·`meeting_minutes_id`는 null. 나만 보는 일정이라 알림을 보내지 않는다.
- `endAt <= startAt`은 `COM-004` ("끝나는 시각은 시작 시각보다 뒤여야 해요"). DB의 `end_at > start_at` CHECK보다 먼저 알린다.

`PATCH /schedule-events/:id` — 내 일정 수정 (200)

- 본문은 등록과 같다(전체를 다시 보낸다).
- 내가 볼 수 없는 일정(참석자·등록자 아님)·없는 일정은 `COM-003`(404).
- 등록자가 아니면(참석만 한 일정) `COM-002`(403) "내가 등록한 일정만 고칠 수 있어요".
- 회의록에서 등록한 일정(`meeting_minutes_id` 있음)은 회의록 쪽 기록이라 `COM-004`(409) "회의록에서 등록한 일정은 여기서 고칠 수 없어요".
- 읽기와 쓰기를 한 트랜잭션에서 한다.

일정은 REQ-LOG-002 작업 로그 대상이 아니어서 등록·수정 로그를 남기지 않는다. 삭제는 요청 범위 밖이라 만들지 않았다.

## 알림

`SCHEDULE_EVENT_ASSIGNED`의 링크는 `/schedule?week=<일정이 속한 주의 월요일>`이다 (일정 자체의 `link_path`는 `/meetings?id=<회의록>` 그대로).

## 테스트

`schedule-event.spec.ts` (묶음 `fs_collab`): 참석자·등록자·무관한 사원, 기간 거르기(끝 날짜 포함·다음 날 00:00 제외), 정렬, 기본 기간, 잘못된 기간, 62일 경계, 비로그인. 직접 등록(본인만 참석자, 다른 사원에게 안 보임, 빈 메모 null, 같은·앞선 끝 시각·빈 제목 COM-004), 수정(본인 수정, 다른 사원 COM-003, 참석만 한 사원 COM-002, 회의록 일정 COM-004 409).
