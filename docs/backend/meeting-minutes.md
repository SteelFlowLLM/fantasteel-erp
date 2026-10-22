# meeting-minutes — Voice2ERP 회의록

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 문서에 없어 정한 값.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-VOC-002 (회의록 저장·목록·상세). REQ-VOC-003 AI 분석. REQ-VOC-004 허가한 후보의 확정·등록(`POST :id/register`, 8장) |
| BP | BP-VOC-01 ([04]). 원본 전사와 AI 요약을 따로 둔다 |
| 단계 | 글·음성 전사(Voice2ERP 2~3단계) + **AI 분석(4단계)**: 전사 → 요약·결정사항·**등록 후보**. AI는 후보만 만들고 스스로 등록하지 않는다. 작성자가 후보를 허가하면 **확정하고 등록(5단계)**이 업무·일정·구매요청 초안을 만든다 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `meeting_minutes` | `meeting_minutes_status`(MEETING_MINUTES_STATUS), `transcript`(원본 전사 그대로), `transcript_segments` jsonb `[{start, end, text}]`, `analysis_progress` jsonb(AI 정리 진행, 2026-10-21), `creator_id` = 로그인 사원 |
| 쓰기 | `ai_chat_thread`·`ai_chat_message` | 회의 질문 대화 (`meeting_minutes_id`가 있는 대화, 2026-10-21). 회의록을 지울 때 함께 지운다 |
| 쓰기 | `meeting_attendee` | `(meeting_minutes_id, employee_id)` unique |
| 읽기 | `employee`, `department`, `role` | 참석자 확인·표시 |

## 3. API

| Method | Path | 이름 | 권한 |
| --- | --- | --- | --- |
| POST | `meeting-minutes` | API-258 회의록 만들기(글로 붙여 넣기, JSON) | 로그인한 전 역할 |
| POST | `meeting-minutes/audio` | 🟡 회의록 만들기(음성, multipart) | 로그인한 전 역할 |
| POST | `meeting-minutes/audio/from-drive` | 🟡 회의록 만들기(회사 Google Drive 폴더의 녹음, JSON, 이슈 #361) | 로그인한 전 역할 |
| POST | `meeting-minutes/:id/analyze` | API-260 AI 정리(다시 정리 포함) | **작성자만** |
| PATCH | `meeting-minutes/:id/candidates/:key` | API-261 후보 고치기·허가·제외 | **작성자만**, `REVIEW`만 |
| PATCH | `meeting-minutes/:id/speakers` | 🟡 화자 이름표 → 참석자 연결 (Voice2ERP 묶음 1) | **작성자만**, `TRANSCRIBED`·`REVIEW`·전사가 남은 `FAILED` |
| POST | `meeting-minutes/:id/speakers/suggest` | 🟡 AI 화자 추정, 저장 안 함 (이슈 #406) | **작성자만**, 화자 연결과 같은 상태 |
| PATCH | `meeting-minutes/:id/summary` | 🟡 AI 요약 고치기 | **작성자만**, `REVIEW`만 |
| POST | `meeting-minutes/:id/register` | API-261 확정하고 등록 | **작성자만**, `REVIEW`만 |
| POST | `meeting-minutes/:id/notion-export` | 🟡 확정한 회의록을 Notion 페이지로 내보내기 (이슈 #358) | **작성자 또는 `ORG_MANAGE` 사용**, `CONFIRMED`만, 한 번만 |
| PUT | `meeting-minutes/:id/attendees` | 🟡 참석자 고치기 (이슈 #449) | **작성자 또는 `ORG_MANAGE` 사용**, `TRANSCRIBED`·`REVIEW`·`FAILED` |
| DELETE | `meeting-minutes/:id` | 🟡 회의록 지우기 (이슈 #449) | **작성자 또는 `ORG_MANAGE` 사용**, `TRANSCRIBED`·`REVIEW`·`FAILED` |
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
- multipart: `file`(audio/*·video/webm·video/mp4, 또는 MIME이 비었거나 `application/octet-stream`이면 확장자 m4a·mp3·wav·webm·aac·ogg·mp4·flac, **500MB** 이하 = 공통 상수 `MEETING_AUDIO_MAX_BYTES`, `FileInterceptor` limits), 글 칸 `meetingMinutesTitle`, `meetingDate`, `attendeeIds`(JSON 배열 문자열 `"[2,3]"`). 제목·회의일·참석자 검증과 한 트랜잭션 저장은 글 만들기와 같은 코드(`createRecord`)를 쓴다. 파일이 없거나 오디오가 아니면 `COM-004`.
- 상태 `TRANSCRIBING`, `transcript`·`transcript_segments` null로 만들어 상세를 **전사를 기다리지 않고** 바로 돌려준다(201). 화면은 2초마다 상세를 다시 읽어 상태가 바뀔 때까지 기다린다.
- **백그라운드 전사** (`MeetingTranscriptionRunner`): 응답 뒤 서버 프로세스 안에서 STT 설정(`SttSettingsStore`)을 읽고 `SttClient.transcribe`를 부른다. 작업은 줄을 세워 **한 번에 하나**만 돈다(whisper 서버 하나를 겹쳐 부르지 않는다).
  - 성공: `transcript` = 구간 글을 `\n`으로 이은 것(구간이 없으면 전체 글), `transcript_segments` = `[{start, end, text, speaker?}]`(초 단위 유지; `speaker`는 화자 분리를 하는 STT 서버만 준다), 상태 `TRANSCRIBED`, `failure_reason` null.
  - 실패: 상태 `FAILED`, `failure_reason` = `SttRequestError` 문구 또는 `전사 중 오류가 났어요`.
  - 결과 반영은 `updateMany where status = TRANSCRIBING`이다. 그 사이 다른 상태가 됐으면 버린다. 로그에는 음성·전사 내용을 남기지 않는다.
- **원본 음성은 저장하지 않는다** (BP-VOC-01): 업로드 버퍼는 메모리에만 있고 디스크·DB에 쓰지 않으며, 작업이 끝나면 참조를 놓는다.
- **멈춘 작업 정리** (`MeetingJobLease`, 전사·분석 공통): 공용 DB(Supabase)에서는 여러 서버가 같은 표를 쓰므로, 켤 때 진행 중 행을 모두 실패로 돌리면 다른 팀원 서버가 처리 중인 작업까지 실패가 된다. 그래서 작업을 맡은 서버가 **줄을 선 순간부터 2분마다** 그 행의 `updated_at`을 갱신하고(`touchInProgress`), 정리는 **마지막 갱신이 10분 넘게 지난 행만**(이 서버가 맡은 행은 빼고) `FAILED`로 바꾼다(`failStale`). 정리는 서버가 켜질 때와 2분마다 돈다. 전사는 음성이 메모리와 함께 사라졌으므로 `failure_reason` = `전사하던 서버가 멈춰 전사가 중단됐어요. 음성을 다시 올려 주세요`. 실패한 회의록은 다시 돌릴 수 없고 음성을 새로 올려야 한다.
  - 🟡 이 PR 전 코드를 쓰는 서버는 켤 때 여전히 모든 진행 중 행을 실패로 바꾼다. 공용 DB를 쓰는 팀원이 모두 이 코드로 올라와야 효과가 있다.

**Drive 녹음으로 만들기** (`POST meeting-minutes/audio/from-drive`, 이슈 #361, 문서에 없는 경로)
- 관리자가 연결한 회사 Google Drive의 **정해 둔 폴더**에 팀이 올린 녹음을 고른다([integration.md](integration.md) 'Google Drive'). 화면은 `GET integrations/google-drive/files?kind=audio`로 목록을 받아 파일 id를 보낸다.
- 본문(JSON): `meetingMinutesTitle`, `meetingDate`, `attendeeIds`(**숫자 배열** — multipart가 아니라 JSON이라 음성 올리기의 JSON 문자열과 다르다), `driveFileId`(Drive id 모양 `[A-Za-z0-9_-]{10,200}`, 아니면 `COM-004`). 권한은 음성 올리기와 같다(로그인).
- **응답 전에 파일을 확인한다** (`GoogleDriveService.checkFile`): Drive 연결(`INT-002`·`INT-003`)·폴더 설정(`INT-011`) → 메타데이터로 **설정한 폴더 바로 아래·휴지통 아님**(아니면 `INT-012`, 폴더 밖 파일이 있는지도 알려 주지 않는다) → 녹음인지(음성 올리기와 같은 판정 `isMeetingAudio`, 아니면 `INT-013`) → **500MB 이하**(`MEETING_AUDIO_MAX_BYTES`, 넘으면 `INT-014`). 잘못된 파일로 회의록을 남기지 않으려고 확인 뒤에 `createRecord`(제목·회의일·참석자 검증, 한 트랜잭션)를 한다.
- 그다음은 음성 올리기와 **같은 전사 작업**이다: `TRANSCRIBING`으로 바로 돌려주고(201), `MeetingTranscriptionRunner` 줄에 `loadAudio`를 넣는다. 차례가 오면 Drive에서 녹음을 **메모리로만** 받고(받기 직전 메타데이터를 다시 확인, 받는 중에도 500MB를 넘으면 끊는다, Google이 조각을 60초 동안 보내지 않으면 끊는다) 같은 `SttClient.transcribe`로 전사한다. 크기(내용 응답 길이, 없으면 메타데이터)를 알면 그만큼 한 번만 잡아 조각을 복사해 넣는다(조각 목록 + `Buffer.concat`이면 잠깐 두 벌이 된다, 크기가 다르면 concat으로 바꾼다). `SttClient`도 Buffer를 그대로 `Blob`에 넘겨 한 벌 더 복사하지 않는다(음성 올리기도 같다): 500MB 녹음이면 받은 버퍼 + Blob 한 벌이 오른다. 줄 안에서 받으므로 큰 녹음 여러 개가 한꺼번에 메모리에 오르지 않는다. 파일 이름·MIME은 Drive 값을 쓴다.
- 받기 실패 → `FAILED`, `failure_reason` = `Drive에서 녹음을 받지 못했어요: <이유>`(예: 연결이 끊김·Google 오류). 원본은 Drive에 그대로 있으므로 다시 만들면 된다. 원본 음성은 이 서버의 디스크·DB에 남기지 않는다(BP-VOC-01).
- 🟡 스키마는 바꾸지 않았다: 회의록에 Drive 파일 id를 남기지 않는다. 원본은 Drive 폴더에 있고, 회의록에서 원본으로 돌아가는 링크나 같은 녹음을 두 번 가져오는 것을 막는 규칙이 아직 필요 없어서다. 필요해지면 `meeting_minutes.source_drive_file_id`(nullable)를 더한다.

**목록** 회의일 최신순, 같은 날은 id 큰 순. 필터: `meetingMinutesStatus`, `keyword`(제목 부분 일치, 대소문자 무시), `page`·`size`(기본 20, 최대 100). 🟡 회의일 범위 필터는 공통 패턴이 없어 만들지 않았다.

**상세** 원본 전사(`transcript`, `transcriptSegments`)와 AI 요약(`summary`, `analysisResult`)을 별개 칸으로 돌려준다. 없으면 `VOC-001`(404).

**AI 분석** (`POST meeting-minutes/:id/analyze`, `MeetingAnalysisRunner`, `meeting-analysis.{prompt,validator}.ts`)
- 작성자(`creator_id`)만 할 수 있다(`VOC-003` 403). 전사가 있는 `TRANSCRIBED`·`REVIEW`(다시 정리: 이전 분석을 새 결과로 바꾼다)·`FAILED`만 허용, 그 밖(`TRANSCRIBING`·`ANALYZING`·`CONFIRMED`, 전사 없는 `FAILED`)은 `VOC-004` 409. 전사가 200,000자(`MEETING_ANALYSIS_MAX_CHARS`)를 넘으면 `VOC-005` 400. 40,000자를 넘는 전사는 조각으로 나눠 분석한다(아래 '긴 전사 나눠 분석'). 상태는 `UPDATE … WHERE status IN (…)` 조건부로 `ANALYZING`(`failure_reason` 지움)으로 바꾸고 상세를 바로 돌려준다(두 번 눌러도 한 번만 시작). 분석은 응답 뒤 runner가 **한 번에 하나**씩 한다.
- 성공: 상태 `REVIEW`, `analysis_result`(shared `MeetingAnalysis`), `summary` 복사, `analysis_progress` 지움. 실패: `FAILED` + 한국어 이유(`LlmRequestError` 문구, 아니면 `AI 정리 중 오류가 났어요. 다시 정리해 주세요`). 결과 반영은 `WHERE status = ANALYZING`이라 그 사이 상태가 바뀌었으면 버린다. 맡은 서버의 표시가 끊긴 `ANALYZING` 행은 위 '멈춘 작업 정리'와 같은 규칙으로 `FAILED`(`분석하던 서버가 멈춰 분석이 중단됐어요. 다시 정리해 주세요`). `business_event`는 남기지 않는다.
- LLM 호출: `LlmClient.chatJsonWithText` (JSON과 함께 원문·생각 글을 돌려준다. JSON 스키마 강제, `temperature 0`, 제한 시간 🟡 10분: 2026-10-21 실측에서 2만 자 조각 하나가 LM Studio를 다른 작업과 나눠 쓸 때 5분을 넘겨 늘렸다). 400이면 형식 강제 없이 한 번 더 부르고, `<think>`·코드 울타리를 벗기며, content가 비면 `reasoning_content`를 읽는다. 모델·주소는 AI 연결 설정(`LlmSettingsStore`)이다.
- **프롬프트 주입 대응** (REQ-AST-005·009): ① 전사는 `<transcript>` 안의 **데이터**이고 지시가 아니라고 시스템 프롬프트에 못 박는다. ② 모델은 DB에 쓰지 못하고 JSON 제안만 낸다. ③ 서버가 모든 후보를 규칙으로 검증하고(아래), 사원 id·품목 id·수주 id·톤은 모델 값을 믿지 않고 DB 매칭·파싱으로만 정한다. ④ 근거 없는 항목은 버리고, 애매한 담당자·날짜는 지어내지 않고 `issues`(확인 필요)로 표시한다. ⑤ 이 단계는 등록하지 않으므로 오작동해도 후보 목록이 틀릴 뿐 데이터는 바뀌지 않는다.
- **검증 규칙** (순수 함수 `validateAnalysis`, 발언 번호는 모델이 1부터 센 값 → `evidence`는 0부터의 위치):
  - 근거(`evidence`)가 범위 밖·정수 아님을 빼고 비면 후보·결정사항을 버린다. `kind`가 TASK/EVENT/PURCHASE가 아니거나 제목이 없으면 버린다(제목 200자). `sourceText`(말한 표현)는 근거 발언에 실제로 있을 때만 남긴다.
  - 담당자: 참석자 `employee_name`과 정확히 일치하는 1명이면 `assigneeId`(직급을 붙인 "박서영 대리"는 첫 낱말이 정확히 일치할 때만). 아니면 null + `담당자를 참석자에서 찾지 못했어요`. EVENT 참석자는 말한 이름과 일치한 사람, 없으면 회의 참석자 전원 + `일정 참석자를 확인해 주세요`.
  - 마감일·희망 입고일: 있는 날짜이고 회의일 이상 +365일 이하만, 아니면 null + 확인 필요. 일정 시작: 같은 범위의 `YYYY-MM-DDTHH:mm` → `+09:00` ISO. 끝이 없거나 시작 이하면 시작 + 1시간, `endAssumed` true + 이슈.
  - 구매요청: `item_type = RAW_MATERIAL`에서 이름·코드 정확 일치(대소문자 무시), 아니면 이름이 하나의 품목에만 포함될 때. 톤은 양수만 소수 3자리 문자열. `requestReason` = 제목, `sourceText` = 근거 발언 글. 못 찾으면 null + `원료 품목을 확인해 주세요`·`수량(톤)을 확인해 주세요`.
  - `relatedSalesOrderNo`는 `sales_order`에 있을 때만 `salesOrderId`와 함께 남기고, 없으면 조용히 버린다. 키는 `c1…`, `decision`은 항상 `PENDING`.
- 화면 응답의 `analysisResult`는 읽을 수 없는 모양이면 null이다.
- **AI 실행 기록** (문서에 없는 기능, `analysis_result.trace`, shared `MeetingAnalysisTrace`): 1차 분석·2차 검토 단계마다 모델, 걸린 시간, 성공 여부·실패 이유, 모델이 낸 답 원문, 생각 글(`<think>` 블록·`reasoning_content`), 서버가 **버리거나 고친 항목과 이유**(`changes`)를 남긴다. 테이블은 바꾸지 않는다.
  - 버린 이유는 `DROP`(모양·종류·제목·근거 없음, 30개 초과)과 `REVIEW_DROP`(없는 후보 지적, 이유 없음, 모델이 스스로 문제 아니라고 한 지적, 1차와 중복, 자리 없음), 고친 것은 `CHANGE`(근거에 없는 인용 원문을 지움, ERP에 없는 수주번호를 지움)다. `issues`(확인 필요)로 이미 보이는 것은 `changes`에 넣지 않는다.
  - 원문·생각 글은 단계당 20,000자(`TRACE_TEXT_MAX`)까지만 저장하고 잘랐으면 `truncated`. 2차 검토 답을 JSON으로 읽지 못해도(`LlmJsonParseError`) 원문을 남긴다. 1차 분석이 실패하면 결과 자체를 저장하지 않으므로 기록도 없다.
  - 화면: AI 분석 카드 아래 접힌 "AI가 한 일 보기". 생각 글에는 "모델이 스스로 쓴 설명이라 실제 판단과 다를 수 있어요"를 붙인다. 이 기능 전의 분석 결과에는 `trace`가 없다.

### 긴 전사 나눠 분석 (2026-10-21, 문서에 없는 기능)

한국어 회의 약 2시간이면 전사가 4만 자를 넘는다. 그런 전사를 거절하지 않고 조각으로 나눠 분석한다 (`meeting-analysis.chunks.ts`, 순수 함수).

- **나누기** (`splitTranscript`): 모델에 보내는 줄(`[n] 이름: 글`, 1차 분석과 같은 `segmentPromptText`) 길이의 합이 🟡 **40,000자 이하면 나누지 않는다**(이 기능 전과 똑같이 한 번에 분석, 실행 기록에 조각 표시 없음). 넘으면 발언(화자 줄) 경계에서 🟡 **조각 24,000자**씩 자르고, 다음 조각은 앞 조각 끝의 발언을 🟡 **겹침 2,000자**만큼 다시 담아 시작한다(경계에 걸친 말을 양쪽에서 보게). 한 발언이 조각보다 길면 문장 끝(`. ? ! 。 … ` 뒤 공백)에서 나눠 같은 번호로 여러 줄을 두고, 나눈 줄마다 같은 화자 머리말(`이름:`·`화자1:`)을 붙인다(그래도 긴 문장은 글자 수로 자른다). 가정값의 근거: 한국어는 대략 글자 1개가 토큰 1개라 32K 문맥 모델에서도 지시·출력(8천 토큰)을 더해 넘치지 않게 잡았다. 지금 개발 모델(qwen3.8-flash-next)은 262K 문맥이라 여유가 크다.
- **발언 번호는 회의 전체 기준 그대로**: 조각 프롬프트의 `[n]`은 1부터 다시 세지 않는다. 사용자 메시지에 "N개 부분 중 k번째, 번호는 회의 전체 기준, 앞뒤와 일부 겹친다"를 덧붙인다. 그래서 근거(`evidence`)가 원본 전사 위치를 그대로 가리키고 화면의 근거 칩도 그대로 원본 발언으로 이동한다.
- **조각마다 1차 분석**: 같은 시스템 프롬프트·JSON 스키마·검증기(`validateAnalysis`)를 쓴다. 검증 전에 근거 번호를 **그 조각 안의 번호로만** 거른다(`restrictToChunk`): 조각에 없는 번호는 지어낸 것이라 빈 근거가 된 항목은 기존 규칙대로 `DROP`(근거 없음)으로 버린다. 한 조각이라도 1차 분석이 실패하면(호출 오류·모양 오류) 그 부분 후보가 통째로 빠지므로 **분석 전체를 실패**로 두고 `failure_reason`에 `N개 조각 중 k번째(발언 a~b) 분석 실패: <이유>`를 남긴다.
- **합치기** (`mergeChunkResults`):
  - 결정사항은 글(공백 무시)이 같으면 하나로 두고 근거를 모은다.
  - 후보는 종류가 같고 ① 제목(공백 무시)이 같거나 ② 다른 조각에서 같은 발언을 근거로 댔으면(겹침 구간) **같은 일**로 본다. 같은 일이고 담당자·원료·날짜(마감·시작·희망 입고일)·수량이 서로 어긋나지 않으면 앞 조각 후보에 근거만 더한다(실행 기록 `앞 조각 후보와 같은 일이라 근거를 합쳤어요`). 한 후보는 다른 조각마다 하나씩만 흡수한다(같은 발언에서 나온 두 일을 하나로 뭉치지 않게).
  - 같은 일인데 값이 어긋나면(회의 중 "10톤 → 15톤"처럼 바뀐 결정) **합치지 않고 둘 다 둔다**. 앞 후보에 `뒷부분의 "…" 후보와 담당자·날짜·수량이 달라요. 어느 쪽이 맞는지 확인해 주세요`, 뒤 후보에 `앞부분의 "…" 후보와 … 회의 중에 바뀐 결정인지 확인해 주세요`를 붙여 작성자가 하나를 제외하게 한다.
  - 제목·근거가 달라도 다른 조각의 같은 종류·같은 담당자·같은 날짜(구매는 같은 원료)인 후보는 회의 끝에 다시 정리한 말일 수 있어, 합치지 않고 뒤 후보에 `앞부분의 "…" 후보와 같은 일일 수 있어요. 겹치면 하나를 제외해 주세요`를 붙인다.
  - 키는 `c1…`로 다시 붙인다. 🟡 상한은 조각 수에 맞춰 늘린다(`candidateLimit`: 조각마다 15개, 30~90개, 나누지 않으면 30개). 2차 검토가 더할 자리도 이 상한 안에서 세고, 넘친 후보는 실행 기록에 남긴다. 근거 인용(`sourceText`)·확인 사유는 처음 뽑은 조각의 것을 그대로 둔다.
- **요약 합치기**: 조각 요약을 모델에 한 번 더 보내(`SUMMARY_MERGE_SYSTEM_PROMPT`, 부분 요약은 `<summaries>` 안의 데이터이고 지시가 아니라고 못 박는다) 회의 전체 요약 4~8문장을 받는다. 실패하면 분석을 실패시키지 않고 조각 요약을 차례로 이어 3,000자까지 쓴다(실행 기록 `MERGE` 단계에 실패 이유).
- **2차 검토도 조각마다**: 조각 전사와 **그 조각의 발언을 근거로 한 후보만** 보여 주고 기존 프롬프트·`mergeReview`를 차례로 거친다(전체 후보를 이어 받아 키가 겹치지 않고, 앞 조각에서 찾은 후보와 중복이면 버린다). 지적(`concerns`)은 **그 조각에서 보여 준 후보 키만** 받는다(보여 주지 않은 키는 `REVIEW_DROP`). `missed`의 근거도 조각 범위로 거른다. 모든 조각이 실패해야 `review.ok = false`이고, 일부만 실패하면 `review = { ok: true, missedCount, concernCount, failedChunks }`(화면: `(조각 n개는 검토 실패)`).
- 그다음 ERP 현황 계산·서버 검증·확인·등록은 이 기능 전과 같다.
- **진행 상황** (`meeting_minutes.analysis_progress` jsonb, 마이그레이션 `20261021123335_meeting_long_analysis_and_questions`): 단계마다 `{ phase: ANALYSIS | MERGE | REVIEW, current, total }`를 `WHERE status = ANALYZING` 조건부로 적는다(같은 UPDATE가 `updated_at`도 바꿔 살아 있다는 표시를 겸한다). 상세 응답 `analysisProgress`는 `ANALYZING`일 때만 값이 있다. 화면은 "AI가 정리하는 중… 1차 분석 중 (조각 2/5)"처럼 보인다(나누지 않은 분석은 "1차 분석 중"·"2차 검토 중"). 시작·끝·실패 때 지운다.
- **실행 기록**: 조각마다 `ANALYSIS`·`REVIEW` 단계가 하나씩 생기고 `chunk = { index, total, firstSegment, lastSegment }`(발언 번호 1부터)를 붙인다. 그 사이에 `MERGE` 단계(요약 합치기 원문, 조각 합치기에서 버린 것)가 들어간다. 화면은 단계 이름 옆에 `조각 2/5 · 발언 #210~#432`.
- 🟡 **걸리는 시간**: LLM 호출이 `조각 수 × 2 + 1`번이다(20만 자면 조각 9개 안팎, 호출 19번). 실측: 4만 3천 자(조각 3개)에 16분. 호출마다 제한 시간은 10분이다.
- 🟡 **전체 시간 상한** `MEETING_ANALYSIS_MAX_MINUTES`(기본 120분, 10~600): 분석은 줄을 서서 하나씩 돌아 긴 회의가 다른 회의 분석을 몇 시간씩 막지 않게 한다. 호출 한 번의 제한 시간도 남은 시간으로 줄인다(최소 1분). 1차 분석 중에 넘으면 `AI 정리가 N분을 넘어 N개 조각 중 k번째(…) 분석 전에 멈췄어요. 다시 정리해 주세요`로 실패, 요약 합치기 전에 넘으면 조각 요약을 이어 붙이고, 2차 검토 중에 넘으면 남은 조각 검토를 건너뛰고(실행 기록에 이유, `failedChunks`에 셈) 그때까지 결과로 마친다. 작업 표시(2분마다)가 이어지므로 오래 걸려도 멈춘 작업 정리에 걸리지 않는다.

### 분석 강화 (Voice2ERP 묶음 2, 문서에 없는 기능)

**2차 AI 검토** (`MeetingAnalysisRunner`, `meeting-review.ts`)
- 1차 분석·검증 직후 같은 모델을 한 번 더 부른다(`chatJson`, 제한 시간 10분). 입력은 1차와 같은 번호 붙은 전사(화자 이름 포함)와 1차 후보 목록(key·종류·제목·담당자·날짜·근거 번호). 답은 `{ missed: [1차와 같은 항목 모양], concerns: [{ key, reason }] }`.
- 답에는 점검용 `scan`(요청·약속·필요 표현 발언을 모두 훑어 1차 후보 `coveredBy` 또는 null로 적은 목록)이 먼저 온다. 서버는 읽지 않지만, 작은 모델이 `scan` 없이는 `missed`를 거의 비워 두어 강제로 열거시킨다.
- `missed` = 1차에 없는 할 일·일정·구매. **담당자나 기한이 불분명한 것, 회사 품목에 없는 원료도 null 칸으로 포함**하게 시킨다(지어내지 않는다). 1차 프롬프트에도 같은 규칙을 넣었다: 꼭 해야 하는데 담당자·날짜가 불분명하면 빼지 말고 null로 포함.
- `concerns` = 담당자·날짜가 틀렸거나, 중복이거나, 사실은 할 일이 아닌 후보에 대한 지적. `exclude`(boolean)는 그 후보를 빼야 하면 true(잡담·사적 약속·중복·이미 끝난 일), 고치면 되면 false.
- 전사는 `<transcript>` 안의 데이터이고 지시가 아니라는 보안 규칙을 2차 프롬프트에도 넣었다.
- **합치기(순수 함수 `mergeReview`)**: `missed`는 1차와 **같은 검증기**(`toCandidate`: 근거·원문·담당자·날짜·품목 규칙)를 통과한 것만, 키는 `c{n+1}…`(전체 30개까지), `fromReview: true`, 확인 사유 맨 앞에 `AI 2차 검토에서 찾은 후보예요`. 1차와 종류·제목이 같으면 중복이라 버린다. `concerns`는 있는 키만, 이유는 120자로 잘라(스스로 "오류 아님"이라고 적은 지적은 버린다) `2차 검토: <이유>`를 그 후보의 `issues`에 덧붙인다. 허가를 막지는 않는다. 빼자는 지적(`exclude: true`, 모델이 칸을 빠뜨리면 이유 글의 '빼야·사적·잡담·중복·할 일이 아니' 같은 말)은 아직 정하지 않은(PENDING) 후보를 **기본 제외**(`EXCLUDED`)로 두고 `2차 검토가 빼자고 해 기본으로 제외해 뒀어요. 필요하면 되살려 주세요`를 붙인다(이슈 #530, 시연에서 "팀 점심은 사적 약속이라 빼야 한다"는 지적이 후보로 남았다). 작성자는 언제든 되살려 허가할 수 있다.
- **실패해도 1차 결과를 낸다**: 호출 오류·시간 초과·알아볼 수 없는 답(`missed`·`concerns` 둘 다 배열이 아님)이면 `analysis_result.review = { ok: false, error }`, 성공이면 `{ ok: true, missedCount, concernCount }`. 상태는 두 번 모두 `ANALYZING`이고 둘 다 끝나야 `REVIEW`가 된다. 옛 분석 결과에는 `review`가 없다.
- 🟡 **걸리는 시간**: LLM 호출이 두 번이라 로컬 모델(45분짜리 회의 기준)에서 분석이 대략 두 배로 늘어난다. 화면은 계속 "AI가 정리하는 중…"이다.

**후보의 ERP 현황** (`meeting-candidate.context.ts`, `analysis_result.candidates[].context`)
- AI를 쓰지 않는 규칙 코드다. 검증이 끝난 뒤 후보마다 DB를 **읽어서** `{ label, value, tone: 'info' | 'warn' }[]`를 채운다(REQ-AST-009: 숫자는 DB 값만). 읽기에 실패해도 분석은 실패하지 않고 현황만 빈다. 옛 분석 결과에는 칸이 없어 빈 배열로 읽는다.
- `salesOrderId`가 있으면: 수주 고객사, 열린(OPEN·PARTIALLY_SHIPPED) 품목별 납기(빠른 순 3개, 나머지는 `외 n건`), 진행 = 출하(CONVERTED 예약) 매수 / 수주 매수(취소 품목 제외). TASK 마감일 또는 EVENT 시작 날짜가 **가장 빠른 열린 납기보다 늦으면** 납기 줄 `warn` + 확인 사유 `수주 납기(M/D)보다 늦어요`.
- PURCHASE에 `itemId`가 있으면: 현재 재고 = 그 원료 LOT 잔량(`remaining_ton > 0`) 합계, 입고 예정 = 입고가 끝나지 않은 발주(CONFIRMED·PARTIALLY_RECEIVED)의 `발주 톤 − 입고 톤`(행마다 0 아래로 내리지 않음). 톤은 소수 3자리. 희망 입고일이 오늘(Asia/Seoul)보다 이르면 `warn`.
- TASK에 `assigneeId`가 있으면: 담당자의 진행(OPEN) 업무 건수와 그중 후보 마감일과 같은 주(월~일) 마감 건수. 같은 주가 3건 이상이면 `warn` + `이번 주 업무가 많아요`.
- EVENT: 참석자 중 같은 시간대(시작 < 다른 일정 끝, 끝 > 다른 일정 시작)에 `schedule_event`가 있는 사람마다 첫 건을 `warn` + `<이름> 일정과 겹쳐요 (HH:mm)`(그 일정의 시작 시각). 없으면 `info` 한 줄.
- **고칠 때 다시 계산**: `PATCH candidates/:key`가 후보를 고친 뒤 현황을 다시 만들고, 이전 현황이 붙인 확인 사유(위 세 가지)는 지우고 새로 붙인다. 2차 검토 사유·그 밖의 사유는 그대로.
- 화면: 후보 카드에 현황 줄(경고는 호박색), 요약 머리말 밑에 `2차 검토: 빠진 후보 n건 · 지적 m건`(실패하면 `2차 검토 실패 — 1차 결과만 보여요`), 2차 검토가 찾은 후보에 `2차 검토` 태그.

### 확인·등록 (REQ-VOC-004, 2026-10-10 결정: 작성자 혼자 후보마다 허가·제외, AI는 스스로 등록하지 않는다)

- **후보 고치기** `PATCH candidates/:key` (body는 보낸 칸만, 모두 선택): `title`, `description`, `assigneeId`·`dueDate`(TASK), `startAt`·`endAt`·`attendeeIds`(EVENT), `purchase {itemId, requestedTon, desiredReceiptDate}`(PURCHASE), `decision`(`PENDING`·`APPROVED`·`EXCLUDED`). 다른 종류의 칸을 보내면 `COM-004`.
  - 검증은 분석과 같다: 날짜는 회의일부터 1년 안, 시각은 서울 `YYYY-MM-DDTHH:mm`(또는 `+09:00` ISO)이고 `endAt > startAt`, 톤은 0보다 크고 소수 3자리까지, `itemId`는 `RAW_MATERIAL`, 담당자·참석자는 **재직 중인 아무 사원**(회의 참석자가 아니어도 된다, 없으면 `VOC-002`).
  - EVENT 후보는 `notionSync`(boolean)로 Notion 업무 공간에도 넣을지 정한다(이슈 #434, 기본 넣음, 다른 종류에 보내면 `COM-004`). 확정 뒤에는 내 일정 화면에서 작성자가 `PATCH schedule-events/:id/notion-sync`로 바꾼다. 자세한 규칙은 [schedule-event.md](schedule-event.md) 'Notion에 넣을지'. `notionNotice`는 확정이 커밋된 뒤 상태를 읽어 만들고, 읽다 실패하면 null로 둔다(확정은 성공).
  - 직접 정한 칸은 AI가 붙인 확인 사유(`issues`)를 지운다: 담당자 → 담당자, 마감일 → 마감일·당일 경고, 끝 시각 → 가정 경고(`endAssumed` false), 참석자, 시작 시각, 원료·수량·희망 입고일. 끝 시각을 가정한 일정은 시작만 옮기면 끝도 1시간 뒤로 따라간다.
  - **구매요청 후보의 요청자** (`purchaseRequesterId`, 이슈 #530, 문서에 없는 칸): 구매요청 초안은 Message → ERP 규칙대로 **요청자가 확정 주체**다([message-action.md](message-action.md)). 그래서 작성자에게 구매요청 등록 권한이 없으면(예: 영업이 쓴 회의록) 작성자가 후보의 요청자를 구매요청 권한이 있는 사원(예: 구매 담당 참석자)으로 정해 넘긴다. 요청자는 사용 중이고(`VOC-002`) 구매요청 등록 사용 권한과 승인권자(부서장)가 있어야 한다(`COM-002`·`PUR-001`, 정할 때·허가할 때·확정할 때 다시 본다). `null`이면 작성자로 되돌리고, 구매요청이 아닌 후보에 보내면 `COM-004`. 후보에는 `purchaseRequesterId`·`purchaseRequesterName`이 남는다. 요청자를 정하지 않은 채 권한 없는 작성자가 허가하면 `COM-002`("요청자를 구매요청 권한이 있는 사원으로 고른 뒤 허가해 주세요"). 시연에서 영업 작성자가 허가하면 403, 참석자 구매부장 화면에는 허가 단추가 없어 아무도 등록하지 못했다(작성자 혼자 정하는 2026-10-10 결정은 그대로 두고 요청자만 넘긴다). 화면: 후보 고치기의 '요청자' 고르기(비우면 작성자), 후보 카드의 '요청자' 줄.
  - **허가(`APPROVED`)** 는 필수 칸이 찬 후보만: TASK 제목·담당자·마감일 / EVENT 제목·시작·끝(시작보다 뒤)·참석자 1명 이상 / PURCHASE 원료·수량·희망 입고일. 모자라면 `VOC-006`(모자란 칸 이름을 문구에 담는다). 남은 경고(끝 시각 가정, 마감일 당일)는 막지 않는다: 허가가 곧 확인했다는 뜻이다.
  - 저장은 `WHERE status = REVIEW AND updated_at = 읽은 값`인 조건부 UPDATE다. 상태가 바뀌었으면 `VOC-004`, 같은 회의록을 동시에 고쳤으면 `COM-001`. `summary`도 같다(`summary` 칸과 `analysis_result.summary`를 같이 바꾼다).
- **확정하고 등록** `POST register` → `{ meetingMinutes, taskIds, scheduleEventIds, actionDraftIds, excludedKeys, notionNotice }`. `notionNotice`는 Notion에 넣기로 한 일정이 있는데 Notion 업무 공간을 지금 쓸 수 없을 때의 이유(이슈 #434), 아니면 null. 남은(PENDING) 후보가 있으면 `VOC-007`, 허가 후보가 비었으면 `VOC-006`. 허가 0건이어도 확정은 된다. 아래를 **한 트랜잭션**으로 한다(하나라도 실패하면 전부 취소, 상태는 `REVIEW` 그대로):
  1. `WHERE status = REVIEW`인 조건부 UPDATE로 `CONFIRMED` + `confirmed_at`. 0건이면 `VOC-004`(더블 클릭 방지). 이어서 담당자·참석자·원료가 아직 유효한지 다시 본다.
  2. 허가 TASK → `task` (`creator` = 작성자, 상태 `OPEN`, `link_path` `/meetings?id=<id>`, `meeting_minutes_id`, 설명 = 후보 설명 + `근거 발언: "…" / "…"`). `TaskService.createInTx`(`POST /tasks`와 같은 경로)가 담당자에게 `TASK_ASSIGNED`(`업무 지정 · 제목`, 본인 제외)를 보낸다.
  3. 허가 EVENT → `schedule_event` + `schedule_event_attendee`(작성자·`link_path`·`meeting_minutes_id`, `notion_sync` = 후보의 `notionSync`, 칸이 없던 옛 후보는 true). 참석자(작성자 제외)에게 `SCHEDULE_EVENT_ASSIGNED`(`일정 등록 · 제목 · M/D HH:mm`, 알림 링크 `/schedule?week=<일정이 속한 주 월요일>`).
  4. 허가 PURCHASE → `MessageActionService.createFromMeeting`: `action_draft`(`PURCHASE_REQUISITION_CREATE`, `meeting_minutes_id`, `message_id` null, 요청자 = 후보의 요청자, 없으면 작성자) + `DRAFT_CREATED`(행위자 = 작성자, after에 요청자, AI 보조, `action_draft_id`) → `WAITING_APPROVAL`. 요청자가 작성자가 아니면 요청자에게 `TASK_ASSIGNED`(`구매요청 초안 확인 · 제목`, 링크 `/action-drafts`, 맞는 알림 유형이 없어 업무 지정을 쓴다)를 보낸다. 요청자가 그 사이 퇴사했거나 권한·승인권자가 없어졌으면 그 오류로 전체가 취소된다. 이후 기존 초안 흐름(확인 → 구매요청 → 부서장 승인)을 그대로 탄다. 초안 응답에 `meetingMinutes {id, title}`이 추가됐다(메시지 초안이면 null).
  5. `MEETING_MINUTES_CONFIRMED`(행위자 작성자, 대상 `meeting_minutes`, AI 보조, after = `taskIds`·`scheduleEventIds`·`actionDraftIds`·`excludedKeys`).
  6. 참석자 전원(작성자 제외)에게 `MEETING_MINUTES_SHARED`(`회의록 공유 · 제목`).
  7. 허가 후보마다 결과를 `analysis_result.candidates[].registered = {type: task|schedule_event|action_draft, id}`로 적는다.
- 🟡 알림은 모두 `business_event_id`를 null로 보낸다. `notification`의 부분 unique(`business_event_id`, `recipient_id`) 때문에, 한 작업 로그에 한 사람이 여러 알림(업무 지정 + 회의록 공유)을 받을 수 없어서다.
- 확정된 뒤에는 분석(`analyze`)·후보 고치기·요약·등록이 모두 `VOC-004`.

### 화자 분리·연결 (Voice2ERP 묶음 1, 문서에 없는 기능)
- `transcript_segments`(jsonb 배열)의 구간에 `speaker`('SPEAKER_1' …, 처음 나온 순서)가 붙을 수 있다. STT 사이드카(`tools/voice-sidecar/`, [stt.md](stt.md))가 줄 때만 있고, 글로 넣은 회의록과 일반 whisper 전사는 칸이 없다. 스키마는 바꾸지 않았다.
- **화자 연결** `PATCH meeting-minutes/:id/speakers` body `{ mapping: { "SPEAKER_1": employeeId | null, … } }`. 작성자만(`VOC-003`), `TRANSCRIBED`·`REVIEW`·전사(`transcript`)가 남은 `FAILED`만(그 밖은 `VOC-004`; 확정 뒤에는 못 바꾼다), 사원은 **이 회의의 참석자**여야 한다(`VOC-002`). 이 회의록에 없는 이름표·정수가 아닌 값·`mapping` 없음은 `COM-004`/400.
- **AI 화자 추정** `POST meeting-minutes/:id/speakers/suggest` (이슈 #406, 문서에 없는 경로). 권한·상태는 화자 연결과 같고, 목소리로 나뉜 화자가 없으면 `VOC-004`. 참석자(번호·이름·부서·역할)와 전사 앞 24,000자를 LLM(`MEETING_SPEAKER` 프로필, 2분)에 주고 화자마다 참석자 번호와 근거를 받는다. 서버가 다시 걸러 목록 밖 번호·소수는 '모름', 같은 사람을 두 화자에 고르면 둘 다 '모름', 답에서 빠진 화자도 '모름'으로 채운다. 응답 `{ suggestions: [{ label, employeeId | null, reason }], failureReason }` — AI 실패·형식 오류·모델 없음은 오류가 아니라 200 + `failureReason`(과거 사례 초안과 같은 방식). **저장하지 않는다**: 화면이 선택 칸을 채우고 작성자가 화자 연결(PATCH)로 저장한다.
- 연결은 각 구간에 `speakerEmployeeId`·`speakerName`을 적어 저장한다(분석 결과가 아직 없을 수 있어 `analysis_result`에는 두지 않는다). 이름표 → 사원 표는 구간에서 다시 만들 수 있다. `null`은 '모름'(두 칸을 null로 되돌림), 보내지 않은 이름표는 그대로. `updatedAt` 조건부 `updateMany`라 동시에 고쳐도 한쪽이 사라지지 않는다(`COM-001`).
- 상세 응답: `transcriptSegments[].speaker/speakerEmployeeId/speakerName`과 파생 값 `speakers: [{ label, employeeId, employeeName, segmentCount, firstTexts(첫 2개 발언) }]`(화자 칸이 없는 전사는 빈 배열).
- **AI 분석 프롬프트**: 구간에 `speakerName`이 있으면 `[n] 이름: 글`, 이름표만 있으면 `[n] 화자1: 글`, 화자가 없으면 지금처럼 `[n] 글`. "화자1"은 사람 이름이 아니라는 규칙을 시스템 프롬프트에 넣었다. 검증기는 원문 구간 글로 근거·담당자를 맞춘다(이름 매칭은 참석자 이름 기준 그대로). 이름을 연결한 뒤에는 **다시 정리**해야 반영된다.
- 전사 요청 제한 시간은 60분(느린 엔진 대비), 연결 확인은 30초.

### 회의 질문하기 (Voice2ERP 묶음 3, 문서에 없는 기능)
- 회의록 상세의 "이 회의에 대해 묻기" 카드가 `POST ai-assistant/messages`에 `meetingMinutesId`를 담아 보낸다. 서버는 [ai-assistant.md](ai-assistant.md) '회의 질문'대로 이 모듈의 `MeetingMinutesService.get`(읽기 전용, 모듈이 export)으로 회의를 읽어 시스템 지시에 넣는다. 이 모듈에 새 API·테이블은 없다.
- 로그인한 누구나(전 역할이 상세를 열 수 있으므로) 묻는다. 회의 내용 블록은 30,000자까지이고 넘으면 전사만 앞에서부터 자른다.
- **대화 저장** (2026-10-21): 철강맨AI 대화 표(`ai_chat_thread`·`ai_chat_message`, 이슈 #399)를 다시 쓴다. `ai_chat_thread.meeting_minutes_id`(nullable)를 더해 **사원·회의록마다 대화 하나**(`(employee_id, meeting_minutes_id)` unique)에 질문과 답을 쌓는다. 화면은 `saveThread: true`와 `meetingMinutesId`를 보내고 `history`·`threadId`는 보내지 않는다: 서버가 그 사원의 이 회의 대화를 찾아 지난 대화를 DB에서 읽고(패널 대화와 같은 문맥 길이 예산), 답이 끝나면 찾거나 만든 대화에 저장한다(두 답이 함께 끝나도 대화가 둘이 되지 않게 upsert 뒤 잠근다). 다른 대화 id를 함께 보내면 `AST-001`. 답을 기다리는 사이 회의록을 지웠으면 저장하지 않는다.
- 저장 범위는 철강맨AI 패널 대화와 **같은 코드**(`AiChatThreadService.saveTurn`)라 같다([ai-assistant.md](ai-assistant.md) '대화 저장'): 질문·답 글, 출처, 답의 생각 글(8,000자)과 도구 동작 기록(줄인 것)은 저장하고, 도구 결과 글·사진·실패·멈춘 질문은 저장하지 않는다. 대화 제목은 첫 질문 앞 40자. 보관 기간 없음.
- `GET ai-assistant/meeting-threads/:meetingMinutesId` → 내 대화(`AiChatThreadView`, 메시지 포함) 또는 아직 묻지 않았으면 `null`. 본인 대화만 보인다(다른 사원의 대화는 없다). 지우기는 패널과 같은 `DELETE ai-assistant/threads/:id`(메시지까지 완전히 지움). 회의 질문 대화는 철강맨AI 패널의 대화 목록에 나오지 않지만, 지난 대화 찾기(`search_chat_history`)에는 내 대화로 함께 잡힌다.
- 회의록을 지우면(`DELETE meeting-minutes/:id`) 모든 사원이 그 회의에 물은 대화도 같은 트랜잭션에서 지운다. 확정한 회의록은 지울 수 없으므로 대화가 남는다.
- 화면: 전사가 있고 `TRANSCRIBING`이 아닐 때만 카드를 보인다. 열 때 저장한 대화를 불러와 이어 보이고, "대화 지우기"(확인 창)로 내 대화를 지운다. 불러오기에 실패하면 이유와 "다시 불러오기"를 보이고, 다시 불러올 때까지 질문을 막는다(서버는 새 질문을 지난 대화에 이어 쌓으므로 빈 화면에서 묻지 않게). 답의 `#n`은 원본 전사 n번 발언으로 이동하는 칩이 된다(AI 분석의 근거 칩과 같은 `jumpToSegment`).

### 철강맨AI 지난 회의 검색 (이슈 #506, 문서에 없는 기능)
- 철강맨AI 도구 `search_meeting_minutes`가 `MeetingMinutesService.searchDigests({ meetingMinutesStatus?, from?, to?, page, size })`를 부른다. 목록(API-259)과 같은 범위(회의록은 전 역할이 열람)에 **요약**(`summary`, 없으면 AI 요약)과 **AI가 정리한 결정사항**(`analysis_result.decisions[].text`)을 더해 돌려준다. 전사 글(`transcript`·`transcript_segments`)은 읽지 않는다. 상태·회의일(양 끝 포함)은 DB에서 좁히고, 낱말로 거르기(제목·요약·결정사항, 공백으로 나눈 낱말이 모두 있어야 함)는 부르는 도구가 100건씩 쪽을 넘기며 한다(최대 1,000건, 다 못 읽으면 알림). API는 늘지 않았다.

### Notion으로 내보내기 (이슈 #358, 문서에 없는 기능)
- `POST meeting-minutes/:id/notion-export` → `MeetingNotionExportResult { notionPageUrl, notionExportedAt, meetingMinutes }`. 회사 Notion 계정(관리자가 연결, [integration.md](integration.md))으로 관리자가 고른 **상위 페이지 아래** 새 페이지를 만든다.
- 🟡 **Notion 업무 공간**(이슈 #391, [integration.md](integration.md) 12장)이 있으면 상위 페이지가 아니라 **회의록 데이터베이스**에 만든다. 확정한 회의록은 자동 반영이 먼저 만들 수 있고, 그러면 `notion_page_url`이 채워져 이 버튼은 링크로 바뀐다(두 번째는 `VOC-008`).
- 조건: 확정(`CONFIRMED`, `confirmed_at` 있음)한 회의록만(아니면 `VOC-004`), 작성자나 `ORG_MANAGE` 사용 권한자만(아니면 `VOC-003`), **한 번만**(이미 주소가 있으면 `VOC-008`, 화면은 상세의 `notionPageUrl` 링크를 보인다). 연결·상위 페이지가 없으면 회의록을 잡기 전에 `INT-002`·`INT-003`·`INT-006`.
- 동시에 두 번 눌러 페이지가 두 개 생기지 않게 `notion_exported_at`에 시각을 적어 잡는다(`claimNotionExport`, 확정 + 주소 없음 + 잡은 사람 없음 조건부 UPDATE). 잡기는 같은 Notion 연결의 다른 호출을 기다린 뒤 **도구를 부르기 바로 전**에 한다(줄을 오래 서도 만료되지 않게). 못 잡으면 `VOC-008`.
- 잡기 만료 = MCP 요청 상한(60초) × 5 = 5분: 도구 호출 한 번이 끝나기 전에 다른 요청이 다시 잡을 수 없다. 만료된 잡기는 다시 잡을 수 있다.
- 실패: Notion이 오류로 답했거나 도구를 부르기 전 실패면 잡기를 푼다. 시간 초과·연결 끊김·주소 없는 성공 답처럼 **페이지가 만들어졌을 수 있으면 `INT-009`** 로 Notion을 먼저 확인하라고 알리고 잡기를 남긴다(바로 다시 눌러도 중복으로 만들지 않는다, 5분 뒤 다시 잡을 수 있다).
- 주소를 남길 때 내 잡기가 그대로인지 본다(`finishNotionExport` 0건이면 다른 요청이 가져간 것). 그러면 성공으로 답하지 않고 만든 페이지 주소를 로그와 `COM-001` 문구에 담는다. 상세의 `notionExportedAt`은 주소가 있을 때만 값이 있다.
- 페이지 제목 = 회의록 제목(줄바꿈 제거, 200자). 본문(`meeting-notion.markdown.ts`, Notion 마크다운): 회의일·참석자(부서)·작성자·확정 시각(서울) → `## 요약`(확정본 `summary`) → `## 결정사항` → 확정 때 **허가한** 후보만 `## 할 일`(`- [ ]`, 담당·마감) · `## 일정`(시각·참석) · `## 구매요청 초안`(품목·톤·희망 입고일) → 출처 한 줄. 제외한 후보와 원본 전사는 싣지 않는다. 사람·AI가 쓴 칸(요약·제목·결정사항·이름·품목)은 `escapeNotionText`로 막는다: `\ < > [ ]` 앞에 백슬래시, 줄 맨 앞 블록 표시(`#`·`>`·`-`·`*`·`+`·`---`·```` ``` ````·`|`·`$$`·`1.`)도 백슬래시로, 줄 앞 공백은 지운다. 요약에 `<mention-user>`·`<page>`·`<callout>` 같은 Notion 태그가 있어도 글로 보인다.
- LLM은 쓰지 않는다. 서버 코드가 `notion-create-pages` 도구 하나만 직접 부른다.
- 작업 로그는 남기지 않는다 (REQ-LOG-002에 맞는 이벤트가 없고 공통 코드를 새로 만들지 않기로 했다).

### 지우기·참석자 고치기 (이슈 #449, 문서에 없는 기능)
- 둘 다 작성자나 `ORG_MANAGE` 사용 권한자만(아니면 `VOC-003`), **확정 전이고 전사·AI 정리 중이 아닐 때**(`TRANSCRIBED`·`REVIEW`·`FAILED`, 아니면 `VOC-004`)만 된다. 확정한 회의록은 업무·일정·구매요청 초안·작업 로그·알림·Notion 페이지가 이어져 있어 막고, 전사·분석 중에는 백그라운드 작업이 결과를 쓰러 돌아오므로 막는다.
- `PUT meeting-minutes/:id/attendees` `{ attendeeIds }` → 상세. 보낸 목록으로 참석자 전체를 바꾼다(1~100명, 중복은 하나로). **새로 넣는 사람만** 사용 중 사원인지 본다(`VOC-002`): 그대로 둔 참석자는 그 사이 퇴사했어도 남긴다. 빠진 참석자에게 연결한 화자 이름표는 '모름'(`speakerEmployeeId`·`speakerName` = null)으로 되돌린다. AI 요약·후보는 그대로 둔다(후보의 담당자·참석자는 회의 참석자가 아니어도 되고 검토 중에 고친다). 확정 전이라 보낸 알림이 없고, 확정할 때 그때의 참석자에게 공유 알림이 간다.
- 읽은 `updated_at`을 조건으로 회의록 행을 먼저 갱신하고(`saveForAttendeeEdit`), 0건이면 상태가 바뀌었는지(`VOC-004`)·동시에 고쳤는지(`COM-001`) 가려 알린다. 참석자 행 바꾸기와 같은 트랜잭션이다.
- `DELETE meeting-minutes/:id` → `{ id }`. **행을 지운다**(표시만 하는 삭제가 아니다): 확정 전에는 `task`·`schedule_event`·`action_draft`의 `meeting_minutes_id`가 가리키지 않고, Notion 페이지는 확정 뒤에만 생기며, 원본 음성은 저장하지 않는다. 참석자 행·이 회의에 물은 대화(모든 사원)·회의록 행을 한 트랜잭션에서 지우고, 회의록 삭제에 상태 조건을 걸어 그 사이 분석을 시작했으면 롤백한다.
- 작업 로그는 남기지 않는다: REQ-LOG-002에 회의록 생성·삭제 이벤트가 없다(만들기도 남기지 않는다).
- 화면: 상세 머리에 "참석자 고치기"(조직도 체크 창, 풀리는 화자 연결 수 안내)와 "삭제"(확인 창) 버튼. 조건은 `client/src/lib/meetingEdit.ts`가 서버와 같게 본다.

## 5. 오류 코드

🟡 VOC-는 정의서 9.3에 없다. `shared/src/errors.ts`에 두었고 팀 확인 후 정의서에 올린다.

| 코드 | 문구 | status |
| --- | --- | --- |
| VOC-001 | 회의록을 찾을 수 없습니다 | 404 |
| VOC-002 | 참석자로 고른 사원을 찾을 수 없습니다 | 404 |
| VOC-003 | 회의록 작성자만 AI 정리를 할 수 있어요 | 403 |
| VOC-004 | 지금 상태에서는 AI 정리를 할 수 없어요 | 409 |
| VOC-005 | 회의 기록이 너무 길어 분석할 수 없어요 (20만 자 이하) | 400 |
| VOC-006 | 이 후보는 아직 허가할 수 없어요 (모자란 칸은 문구에 담는다) | 400 |
| VOC-007 | 허가 또는 제외하지 않은 후보가 남아 있어요 | 409 |
| VOC-008 | 이미 Notion으로 내보낸 회의록이에요 (다른 곳에서 내보내는 중일 때도 문구를 바꿔 쓴다) | 409 |

VOC-003·004는 확인·등록·화자 연결에서 문구를 바꿔 쓴다(`회의록 작성자만 후보를 확인하고 등록할 수 있어요`, `검토 대기 상태의 회의록만 …`).

입력 형식 오류(빈 제목·기록, 참석자 없음, 길이 초과, 없는 날짜)는 `COM-004`(400).

Drive 녹음으로 만들기는 `INT-002`·`INT-003`(연결 없음·다시 연결 필요), `INT-011`(폴더 미설정), `INT-012`(폴더에 없는 파일), `INT-013`(녹음 아님), `INT-014`(500MB 초과)를 쓴다 ([integration.md](integration.md) 오류 코드).

## 6. 테스트

`meeting-minutes.spec.ts` (묶음 `fs_collab`): 만들기(줄 나누기·참석자·중복), 빈 기록·없는 참석자·없는 날짜 거절, 목록 순서·필터·쪽, 상세·404. 음성: `SttClient`·`SttSettingsStore`를 가짜로 바꿔 즉시 TRANSCRIBING 응답 → TRANSCRIBED 구간 저장, 구간 없을 때 전체 글, STT 실패 → FAILED 이유, 이미 상태가 바뀐 행 덮어쓰지 않음, 한 번에 하나 실행, 시작 복구, 잘못된 입력 거절.

`meeting-analyze.spec.ts` (묶음 `fs_collab`): `LlmClient`·`LlmSettingsStore`를 가짜로 바꿔 즉시 ANALYZING 응답 → REVIEW 후보 저장, 작성자 아님 403, 없는 회의록 404, 상태 막기 409, 20만 자 초과 400, 6만 자 전사를 조각 3개로 나눠 분석(조각별 진행 상황·실행 기록, 조각 밖 근거 버림, 같은 일 합치기, 요약 합치기, 조각 하나 2차 검토 실패 시 `failedChunks`), 조각 1차 분석 실패 → 조각 번호를 담은 FAILED, 전체 시간 상한(시계를 당겨 2차 검토 중이면 남은 조각 건너뛰기·1차 분석 중이면 실패)과 환경 변수 범위, LLM 실패 → FAILED·재시도, 다시 정리, 늦은 결과 무시, 시작 복구. 순수 단위(DB 없음): `meeting-analysis.validator.spec.ts`(규칙별 + 프롬프트 주입 줄), `meeting-analysis.chunks.unit.spec.ts`(나누기·겹침·긴 발언 문장 나누기와 화자 머리말·근거 범위 거르기·합치기·바뀐 결정은 둘 다 두고 확인 사유·비슷한 일 중복 경고·조각 수에 맞춘 상한), `meeting-review.unit.spec.ts`(보여 주지 않은 키의 지적 버림·넘겨받은 상한), `llm/llm.client.spec.ts`.

`ai-assistant/meeting-ask.spec.ts` (묶음 `fs_collab`)와 `assistant-meeting.context.unit.spec.ts`(DB 없음): 회의 질문 맥락(번호·화자·잘림·전사 속 지시 문장은 데이터), 시스템 지시에 회의 내용이 들어가는지, 없는 회의록 `VOC-001`. 대화 저장: 사원·회의록마다 대화 하나에 쌓기, 다음 질문은 화면 `history` 대신 DB의 지난 대화, 패널 목록에 없음, 다른 사원에게 안 보임, 지우기, `saveThread` 없으면 저장 안 함, 다른 대화 id를 섞으면 `AST-001`, 회의록을 지우면 대화도 지움.

`meeting-register.spec.ts` (묶음 `fs_collab`): 회의록을 `REVIEW`로 직접 넣고 서비스를 불러 확인한다. 후보 고치기 권한·상태, 값 검증, 확인 사유 지우기, 끝 시각 따라가기, 허가 조건(VOC-006)·경고 허용·제외/되살리기, 요약; 등록: 남은 후보(VOC-007)·작성자 아님, 업무·일정·참석자·초안(WAITING_APPROVAL)·작업 로그·알림 받는 사람·`registered` 기록, 확정 뒤 모든 변경 VOC-004, 허가 0건 확정, 구매요청 초안을 못 만드는 작성자면 전체 롤백, 회의록 초안을 기존 `confirm`으로 구매요청까지 실행.

Notion 내보내기: `integration/integration.spec.ts` (묶음 `fs_collab`, 가짜 OAuth·MCP 서버) — 작성자·관리자·그 밖의 사원, 확정 전 `VOC-004`, 두 번째 `VOC-008`, 상위 페이지 없음 `INT-006`, 도구 없음 `INT-005` 뒤 잡기 풀림, 도구 호출 직전 잡기, 잡기를 잃으면 `COM-001`, 결과를 알 수 없으면 `INT-009`·잡기 유지, Notion 오류 `INT-004`·잡기 풀림, 다시 연결 필요 `INT-003`. 순수 단위 `meeting-notion.markdown.unit.spec.ts`: 마크다운 섹션·허가한 후보만·제목 자르기·Notion 태그와 블록 표시 막기.

Drive 녹음으로 만들기: `integration/google-drive/google-drive.spec.ts` (묶음 `fs_collab`, 가짜 Google 서버 + 가짜 STT) — 받은 녹음 바이트·이름·MIME·화자 수가 STT에 그대로 가고 `TRANSCRIBED`, 사진·폴더 밖·잘못된 id·참석자 없음은 회의록을 만들지 않고 거절, 로그인 필요, 백그라운드 받기 실패 → `FAILED` + 이유, 연결이 끊긴 뒤 `INT-003`.

`meeting-speakers.spec.ts` (묶음 `fs_collab`): STT가 준 `speaker` 저장·`speakers` 요약, `application/octet-stream` + `.m4a` 업로드 허용·`.pdf` 거절, 화자 연결(이름 기록·'모름'·일부만 바꾸기), REVIEW/FAILED 허용, 작성자 아님 `VOC-003`, 확정·분석 중·전사 중·전사 없음 `VOC-004`, 비참석자 `VOC-002`, 잘못된 입력 400, 없는 회의록 `VOC-001`. 순수 단위(DB 없음) `meeting-speaker.unit.spec.ts`: 구간 읽기·화자 요약·프롬프트 표시("이름:"/"화자1:")·업로드 형식 판정. AI 화자 추정(사원 id로 바꾸기·저장 안 함, AI 실패·형식 오류·모델 없음은 200 + 이유, 작성자·상태·화자 없음 거절).

`meeting-edit.spec.ts` (묶음 `fs_collab`): 참석자 고치기(중복 정리·빠진 사람의 화자 연결만 풀기), 관리자 허용·그 밖 `VOC-003`, 빈 목록 400·새로 넣는 퇴사자 `VOC-002`·그대로 둔 퇴사자 유지, 확정·분석 중·전사 중 `VOC-004`(참석자 그대로); 지우기(회의록·참석자 행 삭제·뒤이은 상세 404), 참석자인 비작성자 `VOC-003`·관리자 허용, 확정·분석 중·전사 중 `VOC-004`(아무것도 지우지 않음), 없는 회의록 404, 다른 트랜잭션이 행을 잡은 동안의 순서(확정이 먼저면 지우기 `VOC-004`, 지우기가 먼저면 확정이 FK 오류 없이 `VOC-001`·`VOC-004`). 퇴사자는 이 시험 전용 사원을 만들어 쓴다.

`meeting-analysis.validator.spec.ts`·`meeting-review.unit.spec.ts`·`meeting-candidate.context.unit.spec.ts` (DB 없음, `npm run test:unit`): 2차 검토 합치기(키 이어 붙이기·표시·사유·120자·중복·상한·알아볼 수 없는 답·검증 규칙), 현황 문구·판단(납기 초과·재고/입고 예정 계산·같은 주 업무량·일정 겹침·확인 사유 지우기). `meeting-analyze.spec.ts`에 2차 호출 두 번·실패 시 1차 유지, 일정 겹침·업무 쏠림·재고 줄·후보를 고치면 현황 재계산 시나리오를 더했다.
