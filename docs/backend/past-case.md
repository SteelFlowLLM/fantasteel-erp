# past-case — 과거 사례 (EX)

## 1. 범위

| 항목 | 내용 |
| --- | --- |
| 요구사항 | REQ-CASE-001~005, REQ-AST-006 (모두 EX) |
| 업무 프로세스 | BP-CASE-01 과거 사례 등록·검색 |
| API | API-267 검색 · API-268 상세 · API-269 사례 초안 · API-270 등록 (API 명세 초안) |
| 용어 | TRM-108 과거 사례 (`pastCase` / `past_case`) |
| 저장 | ERD `past_case`·`past_case_lot` (2026-10-16 추가, 아래 2장) |

## 2. 저장

- 사례 = **예시 사례 5건** + **등록 사례**.
  - 예시 사례: `shared/src/past-case.ts`의 `PAST_CASE_EXAMPLES` (CASE-0001~0005, 실제 사례 아님, `isExample: true`, LOT은 `lotId: null`). 관련 LOT이 실제 LOT이 아니라 DB에 넣지 않는다. 화면 구성과 시연용(REQ-CASE-005 시드 개수·작성 방식 TBD).
  - 등록 사례: `past_case`(사례) + `past_case_lot`(관련 LOT, 사례·LOT 쌍 unique). 처음에는 저장소 폴더 JSON 파일에 두었다가(#346) 공용 DB에서 함께 보도록 테이블을 추가했다(#350).
- 번호: `CASE-{id 4자리}` (ERD의 `case_no`가 TBD라 가정값). 마이그레이션이 `past_case` id 시퀀스를 6부터 시작해 예시 사례 id 1~5와 상세 조회(`GET past-cases/:id`)가 겹치지 않는다.
- 등록은 한 트랜잭션: 겹치지 않는 임시 번호(`PENDING-…`)로 사례·관련 LOT을 만든 뒤 id로 번호를 채운다(번호가 id에서 나와서). 롤백되면 시퀀스 값 하나가 비어 번호가 건너뛸 수 있다.
- 빈 원인·조치·설비는 NULL로 저장하고 응답은 지금처럼 빈 문자열로 준다.

## 3. API

| ID | 메서드·경로 | 권한 | 내용 |
| --- | --- | --- | --- |
| API-267 | `GET past-cases?q=&category=&days=` | 로그인한 전 역할 | 검색. `q`에서 핵심어를 뽑아 찾는다 (4장) |
| API-268 | `GET past-cases/:id` | 로그인한 전 역할 | 상세. 없으면 COM-003 |
| API-269 | `POST lots/:id/past-case-drafts` | DISPOSITION_SET USE 🟡 | AI 사례 초안 (5장) |
| API-270 | `POST past-cases` | DISPOSITION_SET USE 🟡 | 등록. 관련 LOT이 없으면 COM-003, 발생일이 오늘보다 뒤면 COM-004 |

- 사례 등록 전용 권한 코드가 없어 API 명세의 🟡 제안대로 불합격 처리 상태 지정(DISPOSITION_SET) 사용 권한을 쓴다.
- 수정·삭제 API는 문서에 없어 만들지 않았다.

## 4. 검색 (REQ-CASE-003)

- 규칙은 `shared/src/past-case.ts`의 `caseKeywords`·`searchPastCases`. 서버 검색 API와 AI 도구가 같이 쓴다.
- 핵심어: 공백·문장부호로 나눠 두 글자 이상만, 질문마다 붙는 말(과거·사례·비슷한·찾아줘·원인·조치·현상 등)을 뺀다. 세 글자 이상 낱말의 끝 조사(에서·으로·과·와·은·는·이·가·을·를·의·에)를 뗀다. '로'는 떼지 않는다(가열로·전로).
- 사례 번호·구분·제목·현상·원인·조치·설비·LOT 번호에서 대소문자 없이 부분 일치로 찾는다. 핵심어가 하나라도 맞으면 넣고, 많이 맞는 순 → 발생일 최신순.
- `days`: 오늘(Asia/Seoul)부터 그 날수 안에 발생한 사례만. 화면은 90일.
- 한국어 ngram 전문검색·의미 검색은 사례 DB가 생기면 정한다(REQ-CASE-003 "구현 단계에서 결정").

## 5. 사례 초안 (REQ-CASE-002, API-269)

- 대상: 자기 검사가 불합격(FAIL)인 LOT, 또는 위로 올라가며(코일 → 슬래브 → 히트) 성분 불합격인 히트가 있는 LOT. 아니면 COM-004(409) "불합격 판정된 LOT만 사례로 등록할 수 있어요".
- 불합격 사실: 기준을 벗어난 검사 항목(값·단위·기준), 검사일(발생일로 씀), 처리 상태·사유, 상위 히트 번호.
- 비슷한 사례 3건을 같은 검색으로 찾아 참고로 넘긴다(`referenceCaseNos`).
- AI: `LlmClient.chatJson`(JSON 스키마), 60초, 숫자는 불합격 사실에 있는 값만, 근거 없는 원인·조치는 "확인 필요". 답 모양이 틀리면 버린다(`parseDraft`).
  - 근거가 있으면 근거 사례 번호를 밝힌다. 원인은 "CASE-0002처럼 … 추정돼요", 조치는 이미 한 일이 아니라 할 일 제안 "CASE-0002처럼 …을 검토해요"(처리 상태가 지정돼 있으면 그 사실 먼저).
  - 구분은 원인만 보고 정한다: 원인이 설비 문제(막힘·마모·고장·설정 어긋남·측정 장치 등)면 설비(EQUIPMENT), 원료·투입량·조업 조건처럼 설비가 아니거나 "확인 필요"면 품질(QUALITY). 관련 설비가 적혀 있다고 설비가 되지 않는다. 예시 사례도 이 기준을 따른다(결정 2026-10-16).
- **AI가 실패해도 오류로 끝내지 않는다**: 모델 미설정·연결 실패·시간 초과·이상한 답이면 검사 결과로 채운 초안(`ruleDraft`, 원인 비움)과 `aiNotice`(이유)를 준다.
- 원소 기호(MN·SI 등 세 글자 이하)만 항목 이름 뒤 괄호로 붙이고, YIELD_STRENGTH 같은 영문 코드는 글에 쓰지 않는다.

## 6. AI 어시스턴트 도구

- `search_past_cases`(`ai-assistant/tools/past-case.tool.ts`): 로그인한 전 역할. 사례 5건까지 넘기고, 예시 사례는 "예시 사례(실제 사례 아님)"로 표시한다. 출처는 조회 데이터 `과거 사례 · <검색어> · CASE-…`.
- 철강맨AI 패널·사내 채팅 @AI가 같은 도구를 쓴다(REQ-CASE-004). 답하는 규칙 5번이 사례 질문에 이 도구를 쓰고 사례 번호를 밝히게 한다.

## 7. 하지 않은 것 · 미결정

- 작업 로그 `CASE_REGISTERED`: 공통 코드 정의서 3장 제안 코드(🟡)라 `shared/src/codes`에 없어 남기지 않는다. 확정되면 등록 트랜잭션 안에서 `businessEventRecorder.record`를 부른다.
- 구분 코드 `CASE_CATEGORY`(QUALITY·EQUIPMENT)도 🟡 제안 코드라 `shared/src/past-case.ts`에 `PAST_CASE_CATEGORY`로 따로 두었다. 그래서 `case_category`에 CHECK 제약을 걸지 않고 DTO에서 값을 확인한다.
- ngram 인덱스, 사례 수정·삭제, 사례 시드 개수.

## 8. 테스트

- `past-case.unit.spec.ts`(DB 없음): 핵심어·검색 순서·구분·기간, 검사 결과 초안·AI 답 검사·AI에 넘기는 글.
- `past-case.spec.ts`(DB `fs_collab`, 초안용 LOT 검사 조회는 고정 값): AI 실패 세 가지(미설정·연결 실패·이상한 답)에도 초안, 상위 히트 불합격 슬래브, 합격·없는 LOT 막기, 등록 번호(id 6 이상, CASE-{id})·DB 저장(빈 원인 NULL, 관련 LOT)·검색·상세, 동시 등록 번호와 임시 번호 정리, 없는 LOT·미래 발생일.
- `ai-assistant/tools/assistant-tools.spec.ts`: `search_past_cases` 출처·예시 표시·인자 오류, 도구 14개.
