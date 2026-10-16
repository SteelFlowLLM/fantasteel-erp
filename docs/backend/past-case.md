# past-case — 과거 사례 (EX)

## 1. 범위

| 항목 | 내용 |
| --- | --- |
| 요구사항 | REQ-CASE-001~005, REQ-AST-006 (모두 EX) |
| 업무 프로세스 | BP-CASE-01 과거 사례 등록·검색 |
| API | API-267 검색 · API-268 상세 · API-269 사례 초안 · API-270 등록 (API 명세 초안) |
| 용어 | TRM-108 과거 사례 (`pastCase` / `past_case`) |
| 저장 | **DB가 아니라 저장소 폴더 JSON 파일**(2026-10-16 결정, 아래 2장) |

## 2. 저장 (사례 DB 없음)

- 기준 ERD(`docs/erd/fantasteel_erp_p1.dbml`)와 `schema.prisma`에 `past_case`·`past_case_lot`이 없다. 스키마를 바꾸지 않고 먼저 쓰기로 했다(2026-10-16).
- 사례 = **예시 사례 5건** + **등록 사례**.
  - 예시 사례: `shared/src/past-case.ts`의 `PAST_CASE_EXAMPLES` (CASE-0001~0005, 실제 사례 아님, `isExample: true`, LOT은 `lotId: null`). 화면 구성과 시연용(REQ-CASE-005 시드 개수·작성 방식 TBD).
  - 등록 사례: `PastCaseStore`가 `STORAGE_DIR/past-cases/cases.json`(기본 `server/storage/`, git 제외)에 쓴다. LLM 연결 설정(`llm-settings.store.ts`)과 같은 방식.
- 번호: `CASE-NNNN` (ERD의 `case_no`가 TBD라 가정값). 등록 사례는 CASE-0006부터, 파일의 가장 큰 번호 + 1.
- 서버 1대 가정: 쓰기는 한 번에 하나씩 이어서 해 번호가 겹치지 않는다. 임시 파일에 쓴 뒤 바꿔 반쯤 쓴 파일이 남지 않는다.
- `past_case` 테이블이 생기면 `PastCaseStore`만 repository로 바꾸면 된다. 칸은 `docs/rework/erd-final.txt`의 `past_case`·`past_case_lot` 열을 따랐다.

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
- **AI가 실패해도 오류로 끝내지 않는다**: 모델 미설정·연결 실패·시간 초과·이상한 답이면 검사 결과로 채운 초안(`ruleDraft`, 원인 비움)과 `aiNotice`(이유)를 준다.
- 원소 기호(MN·SI 등 세 글자 이하)만 항목 이름 뒤 괄호로 붙이고, YIELD_STRENGTH 같은 영문 코드는 글에 쓰지 않는다.

## 6. AI 어시스턴트 도구

- `search_past_cases`(`ai-assistant/tools/past-case.tool.ts`): 로그인한 전 역할. 사례 5건까지 넘기고, 예시 사례는 "예시 사례(실제 사례 아님)"로 표시한다. 출처는 조회 데이터 `과거 사례 · <검색어> · CASE-…`.
- 철강맨AI 패널·사내 채팅 @AI가 같은 도구를 쓴다(REQ-CASE-004). 답하는 규칙 5번이 사례 질문에 이 도구를 쓰고 사례 번호를 밝히게 한다.

## 7. 하지 않은 것 · 미결정

- 작업 로그 `CASE_REGISTERED`: 공통 코드 정의서 3장 제안 코드(🟡)라 `shared/src/codes`에 없어 남기지 않는다. 확정되면 등록에서 `businessEventRecorder.record`를 부른다(저장이 파일이라 같은 트랜잭션은 아니다).
- 구분 코드 `CASE_CATEGORY`(QUALITY·EQUIPMENT)도 🟡 제안 코드라 `shared/src/past-case.ts`에 `PAST_CASE_CATEGORY`로 따로 두었다.
- `past_case` 테이블, ngram 인덱스, 사례 수정·삭제, 사례 시드 개수.

## 8. 테스트

- `past-case.unit.spec.ts`(DB 없음): 핵심어·검색 순서·구분·기간, 검사 결과 초안·AI 답 검사·AI에 넘기는 글, AI 실패 세 가지(미설정·연결 실패·이상한 답)에도 초안, 상위 히트 불합격 슬래브, 합격·없는 LOT 막기, 등록 번호·파일 저장·검색·상세, 동시 등록 번호, 없는 LOT·미래 발생일.
- `ai-assistant/tools/assistant-tools.spec.ts`: `search_past_cases` 출처·예시 표시·인자 오류, 도구 14개.
