# meeting-minutes — Voice2ERP 회의록

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 문서에 없어 정한 값.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-VOC-002 (회의록 저장·목록·상세). REQ-VOC-001 STT, -003 AI 분석, -004 업무 등록은 다음 단계 |
| BP | BP-VOC-01 ([04]). 원본 전사와 AI 요약을 따로 둔다 |
| 이번 단계 | 글로 붙여 넣은 전사 + **음성(녹음·파일) → 백그라운드 전사(STT)** (Voice2ERP 3단계). AI 분석 호출은 없다 |

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

## 5. 오류 코드

🟡 VOC-는 정의서 9.3에 없다. `shared/src/errors.ts`에 두었고 팀 확인 후 정의서에 올린다.

| 코드 | 문구 | status |
| --- | --- | --- |
| VOC-001 | 회의록을 찾을 수 없습니다 | 404 |
| VOC-002 | 참석자로 고른 사원을 찾을 수 없습니다 | 404 |

입력 형식 오류(빈 제목·기록, 참석자 없음, 길이 초과, 없는 날짜)는 `COM-004`(400).

## 6. 테스트

`meeting-minutes.spec.ts` (묶음 `fs_collab`): 만들기(줄 나누기·참석자·중복), 빈 기록·없는 참석자·없는 날짜 거절, 목록 순서·필터·쪽, 상세·404. 음성: `SttClient`·`SttSettingsStore`를 가짜로 바꿔 즉시 TRANSCRIBING 응답 → TRANSCRIBED 구간 저장, 구간 없을 때 전체 글, STT 실패 → FAILED 이유, 이미 상태가 바뀐 행 덮어쓰지 않음, 한 번에 하나 실행, 시작 복구, 잘못된 입력 거절.
