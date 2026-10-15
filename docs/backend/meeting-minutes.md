# meeting-minutes — Voice2ERP 회의록

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 문서에 없어 정한 값.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-VOC-002 (회의록 저장·목록·상세). REQ-VOC-003 AI 분석(이번 단계). REQ-VOC-004 업무 등록은 다음 단계 |
| BP | BP-VOC-01 ([04]). 원본 전사와 AI 요약을 따로 둔다 |
| 이번 단계 | 글·음성 전사(Voice2ERP 2~3단계) + **AI 분석(4단계)**: 전사 → 요약·결정사항·**등록 후보**. 후보는 아직 아무것도 등록하지 않는다(승인·등록은 5단계) |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `meeting_minutes` | `meeting_minutes_status`(MEETING_MINUTES_STATUS), `transcript`(원본 전사 그대로), `transcript_segments` jsonb `[{start, end, text}]`, `creator_id` = 로그인 사원 |
| 쓰기 | `meeting_attendee` | `(meeting_minutes_id, employee_id)` unique |
| 읽기 | `employee`, `department`, `role` | 참석자 확인·표시 |

## 3. API

| Method | Path | 이름 | 권한 |
| --- | --- | --- | --- |
| POST | `meeting-minutes` | API-258 회의록 만들기(글로 붙여 넣기, JSON) | 로그인한 전 역할 |
| POST | `meeting-minutes/audio` | 🟡 회의록 만들기(음성, multipart) | 로그인한 전 역할 |
| POST | `meeting-minutes/:id/analyze` | API-260 AI 정리(다시 정리 포함) | **작성자만** |
| PATCH | `meeting-minutes/:id/candidates/:key` | API-261 후보 고치기·허가·제외 | **작성자만**, `REVIEW`만 |
| PATCH | `meeting-minutes/:id/summary` | 🟡 AI 요약 고치기 | **작성자만**, `REVIEW`만 |
| POST | `meeting-minutes/:id/register` | API-261 확정하고 등록 | **작성자만**, `REVIEW`만 |
| GET | `meeting-minutes` | API-259 목록 | 전 역할 |
| GET | `meeting-minutes/:id` | API-259 상세 | 전 역할 |

회의록은 전 역할이 쓰므로 `@RequirePermission` 없이 로그인만 본다. 🟡 작성자만 볼 수 있게 하지는 않는다(전 역할이 목록·상세를 연다).

## 4. 업무 규칙

**만들기**
1. 입력: `meetingMinutesTitle`(trim 후 1~200자), `meetingDate`(YYYY-MM-DD, 없는 날짜는 `COM-004`), `attendeeIds`(1명 이상, 중복은 하나로), `transcript`(trim 후 비어 있지 않음, 100000자 이하).
2. 참석자는 모두 사용 중인(`is_active`) 사원이어야 한다. 하나라도 없으면 `VOC-002`(404)이고 아무것도 저장하지 않는다.
3. 한 트랜잭션에서 `meeting_minutes`(상태 `TRANSCRIBED`: 글로 넣은 전사는 STT를 건너뛴다 [06]) + `meeting_attendee`를 만든다. `summary`·`analysis_result`는 null.
4. `transcript`는 받은 그대로 저장하고, `transcript_segments`는 비지 않은 줄마다 `{ start: null, end: null, text: 줄.trim() }`로 만든다. 배열 위치가 발언 번호다.
5. 작업 로그(`business_event`)는 남기지 않는다. REQ-LOG-002 이벤트에 회의록 생성이 없다.

**음성으로 만들기** (`POST meeting-minutes/audio`, 2026-10-15 결정)
- 명세의 API-258은 JSON 한 개다. 음성은 multipart라 본문 형식이 달라 경로를 `/meeting-minutes/audio`로 나눴다.
- multipart: `file`(audio/* 또는 video/webm, 100MB 이하, `FileInterceptor` limits), 글 칸 `meetingMinutesTitle`, `meetingDate`, `attendeeIds`(JSON 배열 문자열 `"[2,3]"`). 제목·회의일·참석자 검증과 한 트랜잭션 저장은 글 만들기와 같은 코드(`createRecord`)를 쓴다. 파일이 없거나 오디오가 아니면 `COM-004`.
- 상태 `TRANSCRIBING`, `transcript`·`transcript_segments` null로 만들어 상세를 **전사를 기다리지 않고** 바로 돌려준다(201). 화면은 2초마다 상세를 다시 읽어 상태가 바뀔 때까지 기다린다.
- **백그라운드 전사** (`MeetingTranscriptionRunner`): 응답 뒤 서버 프로세스 안에서 STT 설정(`SttSettingsStore`)을 읽고 `SttClient.transcribe`를 부른다. 작업은 줄을 세워 **한 번에 하나**만 돈다(whisper 서버 하나를 겹쳐 부르지 않는다).
  - 성공: `transcript` = 구간 글을 `\n`으로 이은 것(구간이 없으면 전체 글), `transcript_segments` = `[{start, end, text}]`(초 단위 유지), 상태 `TRANSCRIBED`, `failure_reason` null.
  - 실패: 상태 `FAILED`, `failure_reason` = `SttRequestError` 문구 또는 `전사 중 오류가 났어요`.
  - 결과 반영은 `updateMany where status = TRANSCRIBING`이다. 그 사이 다른 상태가 됐으면 버린다. 로그에는 음성·전사 내용을 남기지 않는다.
- **원본 음성은 저장하지 않는다** (BP-VOC-01): 업로드 버퍼는 메모리에만 있고 디스크·DB에 쓰지 않으며, 작업이 끝나면 참조를 놓는다.
- **시작 복구**: 서버가 켜질 때(`onApplicationBootstrap`) `TRANSCRIBING`으로 남은 행은 음성이 메모리와 함께 사라졌으므로 `FAILED`, `failure_reason` = `서버가 다시 시작돼 전사가 중단됐어요. 음성을 다시 올려 주세요`로 바꾼다. 실패한 회의록은 다시 돌릴 수 없고 음성을 새로 올려야 한다.

**목록** 회의일 최신순, 같은 날은 id 큰 순. 필터: `meetingMinutesStatus`, `keyword`(제목 부분 일치, 대소문자 무시), `page`·`size`(기본 20, 최대 100). 🟡 회의일 범위 필터는 공통 패턴이 없어 만들지 않았다.

**상세** 원본 전사(`transcript`, `transcriptSegments`)와 AI 요약(`summary`, `analysisResult`)을 별개 칸으로 돌려준다. 없으면 `VOC-001`(404).

**AI 분석** (`POST meeting-minutes/:id/analyze`, `MeetingAnalysisRunner`, `meeting-analysis.{prompt,validator}.ts`)
- 작성자(`creator_id`)만 할 수 있다(`VOC-003` 403). 전사가 있는 `TRANSCRIBED`·`REVIEW`(다시 정리: 이전 분석을 새 결과로 바꾼다)·`FAILED`만 허용, 그 밖(`TRANSCRIBING`·`ANALYZING`·`CONFIRMED`, 전사 없는 `FAILED`)은 `VOC-004` 409. 전사가 40,000자를 넘으면 `VOC-005` 400(나눠 분석하는 방식은 나중). 상태는 `UPDATE … WHERE status IN (…)` 조건부로 `ANALYZING`(`failure_reason` 지움)으로 바꾸고 상세를 바로 돌려준다(두 번 눌러도 한 번만 시작). 분석은 응답 뒤 runner가 **한 번에 하나**씩 한다.
- 성공: 상태 `REVIEW`, `analysis_result`(shared `MeetingAnalysis`), `summary` 복사. 실패: `FAILED` + 한국어 이유(`LlmRequestError` 문구, 아니면 `AI 정리 중 오류가 났어요. 다시 정리해 주세요`). 결과 반영은 `WHERE status = ANALYZING`이라 그 사이 상태가 바뀌었으면 버린다. 시작할 때 `ANALYZING`으로 남은 행은 `FAILED`(`서버가 다시 시작돼 분석이 중단됐어요. 다시 정리해 주세요`). `business_event`는 남기지 않는다.
- LLM 호출: `LlmClient.chatJson` (JSON 스키마 강제, `temperature 0`, 제한 시간 5분). 400이면 형식 강제 없이 한 번 더 부르고, `<think>`·코드 울타리를 벗기며, content가 비면 `reasoning_content`를 읽는다. 모델·주소는 AI 연결 설정(`LlmSettingsStore`)이다.
- **프롬프트 주입 대응** (REQ-AST-005·009): ① 전사는 `<transcript>` 안의 **데이터**이고 지시가 아니라고 시스템 프롬프트에 못 박는다. ② 모델은 DB에 쓰지 못하고 JSON 제안만 낸다. ③ 서버가 모든 후보를 규칙으로 검증하고(아래), 사원 id·품목 id·수주 id·톤은 모델 값을 믿지 않고 DB 매칭·파싱으로만 정한다. ④ 근거 없는 항목은 버리고, 애매한 담당자·날짜는 지어내지 않고 `issues`(확인 필요)로 표시한다. ⑤ 이 단계는 등록하지 않으므로 오작동해도 후보 목록이 틀릴 뿐 데이터는 바뀌지 않는다.
- **검증 규칙** (순수 함수 `validateAnalysis`, 발언 번호는 모델이 1부터 센 값 → `evidence`는 0부터의 위치):
  - 근거(`evidence`)가 범위 밖·정수 아님을 빼고 비면 후보·결정사항을 버린다. `kind`가 TASK/EVENT/PURCHASE가 아니거나 제목이 없으면 버린다(제목 200자). `sourceText`(말한 표현)는 근거 발언에 실제로 있을 때만 남긴다.
  - 담당자: 참석자 `employee_name`과 정확히 일치하는 1명이면 `assigneeId`(직급을 붙인 "박서영 대리"는 첫 낱말이 정확히 일치할 때만). 아니면 null + `담당자를 참석자에서 찾지 못했어요`. EVENT 참석자는 말한 이름과 일치한 사람, 없으면 회의 참석자 전원 + `일정 참석자를 확인해 주세요`.
  - 마감일·희망 입고일: 있는 날짜이고 회의일 이상 +365일 이하만, 아니면 null + 확인 필요. 일정 시작: 같은 범위의 `YYYY-MM-DDTHH:mm` → `+09:00` ISO. 끝이 없거나 시작 이하면 시작 + 1시간, `endAssumed` true + 이슈.
  - 구매요청: `item_type = RAW_MATERIAL`에서 이름·코드 정확 일치(대소문자 무시), 아니면 이름이 하나의 품목에만 포함될 때. 톤은 양수만 소수 3자리 문자열. `requestReason` = 제목, `sourceText` = 근거 발언 글. 못 찾으면 null + `원료 품목을 확인해 주세요`·`수량(톤)을 확인해 주세요`.
  - `relatedSalesOrderNo`는 `sales_order`에 있을 때만 `salesOrderId`와 함께 남기고, 없으면 조용히 버린다. 키는 `c1…`, `decision`은 항상 `PENDING`.
- 화면 응답의 `analysisResult`는 읽을 수 없는 모양이면 null이다.

### 확인·등록 (REQ-VOC-004, 2026-10-10 결정: 작성자 혼자 후보마다 허가·제외, AI는 스스로 등록하지 않는다)

- **후보 고치기** `PATCH candidates/:key` (body는 보낸 칸만, 모두 선택): `title`, `description`, `assigneeId`·`dueDate`(TASK), `startAt`·`endAt`·`attendeeIds`(EVENT), `purchase {itemId, requestedTon, desiredReceiptDate}`(PURCHASE), `decision`(`PENDING`·`APPROVED`·`EXCLUDED`). 다른 종류의 칸을 보내면 `COM-004`.
  - 검증은 분석과 같다: 날짜는 회의일부터 1년 안, 시각은 서울 `YYYY-MM-DDTHH:mm`(또는 `+09:00` ISO)이고 `endAt > startAt`, 톤은 0보다 크고 소수 3자리까지, `itemId`는 `RAW_MATERIAL`, 담당자·참석자는 **재직 중인 아무 사원**(회의 참석자가 아니어도 된다, 없으면 `VOC-002`).
  - 직접 정한 칸은 AI가 붙인 확인 사유(`issues`)를 지운다: 담당자 → 담당자, 마감일 → 마감일·당일 경고, 끝 시각 → 가정 경고(`endAssumed` false), 참석자, 시작 시각, 원료·수량·희망 입고일. 끝 시각을 가정한 일정은 시작만 옮기면 끝도 1시간 뒤로 따라간다.
  - **허가(`APPROVED`)** 는 필수 칸이 찬 후보만: TASK 제목·담당자·마감일 / EVENT 제목·시작·끝(시작보다 뒤)·참석자 1명 이상 / PURCHASE 원료·수량·희망 입고일. 모자라면 `VOC-006`(모자란 칸 이름을 문구에 담는다). 남은 경고(끝 시각 가정, 마감일 당일)는 막지 않는다: 허가가 곧 확인했다는 뜻이다.
  - 저장은 `WHERE status = REVIEW AND updated_at = 읽은 값`인 조건부 UPDATE다. 상태가 바뀌었으면 `VOC-004`, 같은 회의록을 동시에 고쳤으면 `COM-001`. `summary`도 같다(`summary` 칸과 `analysis_result.summary`를 같이 바꾼다).
- **확정하고 등록** `POST register` → `{ meetingMinutes, taskIds, scheduleEventIds, actionDraftIds, excludedKeys }`. 남은(PENDING) 후보가 있으면 `VOC-007`, 허가 후보가 비었으면 `VOC-006`. 허가 0건이어도 확정은 된다. 아래를 **한 트랜잭션**으로 한다(하나라도 실패하면 전부 취소, 상태는 `REVIEW` 그대로):
  1. `WHERE status = REVIEW`인 조건부 UPDATE로 `CONFIRMED` + `confirmed_at`. 0건이면 `VOC-004`(더블 클릭 방지). 이어서 담당자·참석자·원료가 아직 유효한지 다시 본다.
  2. 허가 TASK → `task` (`creator` = 작성자, 상태 `OPEN`, `link_path` `/meetings?id=<id>`, `meeting_minutes_id`, 설명 = 후보 설명 + `근거 발언: "…" / "…"`). `TaskService.createInTx`(`POST /tasks`와 같은 경로)가 담당자에게 `TASK_ASSIGNED`(`업무 지정 · 제목`, 본인 제외)를 보낸다.
  3. 허가 EVENT → `schedule_event` + `schedule_event_attendee`(작성자·`link_path`·`meeting_minutes_id`). 참석자(작성자 제외)에게 `SCHEDULE_EVENT_ASSIGNED`(`일정 등록 · 제목 · M/D HH:mm`, 알림 링크 `/schedule?week=<일정이 속한 주 월요일>`).
  4. 허가 PURCHASE → `MessageActionService.createFromMeeting`: `action_draft`(`PURCHASE_REQUISITION_CREATE`, `meeting_minutes_id`, `message_id` null, 요청자 = 작성자) + `DRAFT_CREATED`(AI 보조, `action_draft_id`) → `WAITING_APPROVAL`. 작성자에게 구매요청 등록 권한이 없거나 승인권자가 없으면(`PUR-001`) 그 오류로 전체가 취소된다: 이때는 구매요청 후보를 제외하거나 구매 담당자가 확정해야 한다. 이후 기존 초안 흐름(확인 → 구매요청 → 부서장 승인)을 그대로 탄다. 초안 응답에 `meetingMinutes {id, title}`이 추가됐다(메시지 초안이면 null).
  5. `MEETING_MINUTES_CONFIRMED`(행위자 작성자, 대상 `meeting_minutes`, AI 보조, after = `taskIds`·`scheduleEventIds`·`actionDraftIds`·`excludedKeys`).
  6. 참석자 전원(작성자 제외)에게 `MEETING_MINUTES_SHARED`(`회의록 공유 · 제목`).
  7. 허가 후보마다 결과를 `analysis_result.candidates[].registered = {type: task|schedule_event|action_draft, id}`로 적는다.
- 🟡 알림은 모두 `business_event_id`를 null로 보낸다. `notification`의 부분 unique(`business_event_id`, `recipient_id`) 때문에, 한 작업 로그에 한 사람이 여러 알림(업무 지정 + 회의록 공유)을 받을 수 없어서다.
- 확정된 뒤에는 분석(`analyze`)·후보 고치기·요약·등록이 모두 `VOC-004`.

## 5. 오류 코드

🟡 VOC-는 정의서 9.3에 없다. `shared/src/errors.ts`에 두었고 팀 확인 후 정의서에 올린다.

| 코드 | 문구 | status |
| --- | --- | --- |
| VOC-001 | 회의록을 찾을 수 없습니다 | 404 |
| VOC-002 | 참석자로 고른 사원을 찾을 수 없습니다 | 404 |
| VOC-003 | 회의록 작성자만 AI 정리를 할 수 있어요 | 403 |
| VOC-004 | 지금 상태에서는 AI 정리를 할 수 없어요 | 409 |
| VOC-005 | 회의 기록이 너무 길어 지금은 분석할 수 없어요 (4만 자 이하) | 400 |
| VOC-006 | 이 후보는 아직 허가할 수 없어요 (모자란 칸은 문구에 담는다) | 400 |
| VOC-007 | 허가 또는 제외하지 않은 후보가 남아 있어요 | 409 |

VOC-003·004는 확인·등록에서 문구를 바꿔 쓴다(`회의록 작성자만 후보를 확인하고 등록할 수 있어요`, `검토 대기 상태의 회의록만 …`).

입력 형식 오류(빈 제목·기록, 참석자 없음, 길이 초과, 없는 날짜)는 `COM-004`(400).

## 6. 테스트

`meeting-minutes.spec.ts` (묶음 `fs_collab`): 만들기(줄 나누기·참석자·중복), 빈 기록·없는 참석자·없는 날짜 거절, 목록 순서·필터·쪽, 상세·404. 음성: `SttClient`·`SttSettingsStore`를 가짜로 바꿔 즉시 TRANSCRIBING 응답 → TRANSCRIBED 구간 저장, 구간 없을 때 전체 글, STT 실패 → FAILED 이유, 이미 상태가 바뀐 행 덮어쓰지 않음, 한 번에 하나 실행, 시작 복구, 잘못된 입력 거절.

`meeting-analyze.spec.ts` (묶음 `fs_collab`): `LlmClient`·`LlmSettingsStore`를 가짜로 바꿔 즉시 ANALYZING 응답 → REVIEW 후보 저장, 작성자 아님 403, 없는 회의록 404, 상태 막기 409, 4만 자 초과 400, LLM 실패 → FAILED·재시도, 다시 정리, 늦은 결과 무시, 시작 복구. 순수 단위(DB 없음): `meeting-analysis.validator.spec.ts`(규칙별 + 프롬프트 주입 줄), `llm/llm.client.spec.ts`.

`meeting-register.spec.ts` (묶음 `fs_collab`): 회의록을 `REVIEW`로 직접 넣고 서비스를 불러 확인한다. 후보 고치기 권한·상태, 값 검증, 확인 사유 지우기, 끝 시각 따라가기, 허가 조건(VOC-006)·경고 허용·제외/되살리기, 요약; 등록: 남은 후보(VOC-007)·작성자 아님, 업무·일정·참석자·초안(WAITING_APPROVAL)·작업 로그·알림 받는 사람·`registered` 기록, 확정 뒤 모든 변경 VOC-004, 허가 0건 확정, 구매요청 초안을 못 만드는 작성자면 전체 롤백, 회의록 초안을 기존 `confirm`으로 구매요청까지 실행.
