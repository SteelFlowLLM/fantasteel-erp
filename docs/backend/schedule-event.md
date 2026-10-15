# 내 일정 (`server/src/modules/schedule-event/`)

문서에 없는 기능 (Voice2ERP 6단계). 회의록 확정이 만든 `schedule_event`를 참석자·등록자가 본다. 화면은 `/schedule`("내 일정").

## API (명세서에 없는 경로, 로그인만 필요)

`GET /schedule-events?from=YYYY-MM-DD&to=YYYY-MM-DD`

- 내가 `schedule_event_attendee`이거나 `creator`인 일정 중 시작 시각(`start_at`)이 서울 기준 `from` 00:00 이상, `to` 다음 날 00:00 미만인 것.
- `from`·`to`가 없으면 이번 주 월~일(Asia/Seoul). `from`만 있으면 `from`부터 7일.
- 기간은 최대 62일. 형식·없는 날짜·`to < from`·62일 초과는 `COM-004`.
- 응답 배열 (`ScheduleEventView`, `shared/src/schedule-event.ts`): `id`, `scheduleEventTitle`, `scheduleEventDescription`, `startAt`, `endAt`(ISO), `linkPath`, `meetingMinutes {id, title} | null`, `attendees [{employeeId, employeeName}]`, `creator {id, name}`. `startAt` 순, 같으면 `id` 순.

## 알림

`SCHEDULE_EVENT_ASSIGNED`의 링크는 `/schedule?week=<일정이 속한 주의 월요일>`이다 (일정 자체의 `link_path`는 `/meetings?id=<회의록>` 그대로).

## 테스트

`schedule-event.spec.ts` (묶음 `fs_collab`): 참석자·등록자·무관한 사원, 기간 거르기(끝 날짜 포함·다음 날 00:00 제외), 정렬, 기본 기간, 잘못된 기간, 62일 경계, 비로그인.
