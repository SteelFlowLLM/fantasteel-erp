# ai-assistant — AI 어시스턴트

> 근거 약어: [01] 기획안 · [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [08] API 명세서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml`. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-AST-001·003·004·007·008·009. AST-002(@AI)·005(실행 카드)·006(사례)·010(AI 경유)은 다음 단계 |
| BP | BP-AST-01 ([04] 7장) |
| 등급 | P2 |
| LLM | llm 모듈의 LLM 연결 설정(주소·모델)을 쓴다. 지금은 LM Studio(OpenAI 호환). 데이터 조회는 tool 호출을 지원하는 모델이어야 한다 |

단계 계획: ① 업무 지식(용어 사전) 답변·화면 맥락·추천 질문·패널 ② 데이터 조회 도구(AST-004, 재고·수주·LOT 추적·작업 로그) ②-2 나머지 조회 도구(생산계획·실적, 검사 결과·불합격, 구매요청·발주·입고, 출하요청·밀시트) ← **지금** ③ 실행 카드(AST-005·010, Action Draft 핸들러 재사용) ④ 사내 채팅 @AI(AST-002).

## 2. 테이블

쓰기 없음. AI는 조회·설명만 하고 업무 데이터를 바꾸지 않는다([01] AI 사용 원칙). 대화 기록 저장 여부는 미결정([02] 21장)이고 ERD에 테이블이 없어 **저장하지 않는다**. 화면이 최근 대화를 함께 보낸다.

읽기: `role_permission`·`role` — 권한 밖 요청에 조회할 수 있는 역할을 안내할 때(`ai-assistant.repository.ts`). 업무 데이터는 각 모듈 service로만 읽는다.

## 3. API

| Method | Path | ID | 권한 | 응답 |
| --- | --- | --- | --- | --- |
| POST | `ai-assistant/messages` | API-262 | 로그인만. 데이터는 도구마다 사용자 권한으로 확인 | `AiAssistantReplyView` `{ answer, sources[], model, latencyMs }` |
| GET | `ai-assistant/suggested-questions` | API-263 | 로그인만 | `AiAssistantSuggestedQuestionsView` `{ roleCode, roleQuestions[], firstTimeQuestions[] }` |

요청 `POST ai-assistant/messages`:

| 필드 | 규칙 |
| --- | --- |
| `question` | 필수, 앞뒤 공백 제거, 1000자까지 |
| `screen` | 선택. `{ path, title, label }` — 보고 있는 화면 주소(쿼리 포함)·제목·위젯 맥락(REQ-AST-007) |
| `history` | 선택. `{ role: 'user'\|'assistant', content }[]` 20개까지. 서버는 최근 10개, 한 줄 2000자까지만 쓴다 |

`sources[]`: `{ kind: 'GLOSSARY', id: 'TRM-056', label: '예약' }` 또는 `{ kind: 'DATA', id: 'get_inventory', label: '재고 · SS275' }`. 조회 데이터가 앞에 온다.

대화가 저장되지 않아 새 자원이 없으므로 `POST`지만 200을 돌려준다.

## 4. 업무 규칙

**업무 지식(REQ-AST-003)**
- 근거는 용어 사전뿐이다. 업무 매뉴얼은 작성 담당이 정해지지 않았다([02] 21장).
- `npm run glossary -w @fantasteel/server`가 `docs/notion/03-용어-사전.md` 표를 읽어 `knowledge/glossary.generated.ts`를 만든다(공통 코드처럼 생성 파일을 커밋, 손으로 고치지 않음). 서버는 실행 중에 docs/를 읽지 않는다.
- 검색: 질문에 용어의 한글명·사용 금지 동의어(괄호 설명 제외)·영문명·약어·변수명이 들어 있는지 본다(띄어쓰기·대소문자 무시). 점수 = 종류 가중치(이름 10 > 동의어 8 > 영문명·약어 6 > 변수명 3) + 길이, 최대 5개. 용어가 117개뿐이라 색인·의미 검색은 쓰지 않는다.
- 질문에서 용어를 못 찾으면 바로 앞 사용자 질문으로 다시 찾는다("그건 언제 풀려?" 같은 이어 묻기).

**데이터 조회(REQ-AST-004)** — `tools/`
- OpenAI 호환 tool 호출(`LlmClient.chatWithTools`). 모델이 도구를 고르면 서버가 실행해 결과를 넘기고 다시 묻는다. 한 질문에 4번까지, 그 뒤에는 도구 없이 답하게 한다.
- 도구는 각 모듈의 **조회 service**만 부른다. 결과는 한글 이름(용어 사전 한글명)의 짧은 JSON으로 바꾸고, 목록은 15줄까지(넘친 줄 수를 함께 준다), 전체 8000자까지.
- 권한: 같은 데이터를 보여 주는 API와 같은 기준이다. 도구마다 `access`를 둔다.
  - `TOOLBOX`: 도구 모음이 먼저 확인한다(`permissions` 중 하나라도 VIEW 이상, 비면 전 역할). API가 데코레이터로 확인하는 경우.
  - `SERVICE`: "VIEW 또는 부서장"처럼 API도 service가 사용자로 확인하는 경우. 도구는 사용자를 service에 넘기고, service가 던진 COM-002를 권한 없음으로 바꾼다. `permissions`·`note`는 안내 문구에만 쓴다.
  - 권한 밖이면 조회하지 않고 `{ 오류: '권한 없음', 안내, 조회할 수 있는 역할 }`을 모델에 돌려줘 담당 역할을 안내하게 한다(REQ-AST-009).
- 실패(인자 오류·대상 없음·업무 오류)도 예외가 아니라 `{ 오류 }` 결과로 돌려준다. 예상하지 못한 오류는 서버 로그에만 남기고 모델에는 "조회 중 서버 오류"만 넘긴다.
- 조회에 성공한 도구만 출처(`DATA`)로 붙인다.

| 도구 | 감싸는 service | 권한 (API와 같음) | 인자 |
| --- | --- | --- | --- |
| `get_inventory` | `InventoryService.listInventories` (GET inventories) | 없음(전 역할) | `keyword`(규격·품목·강종 일부), `category`(PRODUCT·RAW_MATERIAL·SURPLUS) |
| `get_sales_orders` | `SalesOrderService.list`·`fulfillment` (GET sales-orders, /:id/fulfillment) | 수주 등록 VIEW | `salesOrderNo`, `salesOrderId`(화면 주소), `dueRiskOnly`. 한 수주로 좁혀지면 품목별 충족 현황. 건수는 거른 뒤의 수만, 납기까지 남은 일수는 서버가 서울 날짜로 계산해 넣는다 |
| `trace_lot` | `LotService.list`·`trace` (GET lots, /:id/trace) | 없음(전 역할) | `lotNo`(번호·앞부분), `direction`. 앞부분이 여러 LOT에 맞으면 후보만 |
| `get_production_plans` | `ProductionService.listPlans` (GET production-plans) | 생산계획 확정 VIEW | `status`, `keyword`(계획·수주번호·규격 일부). 히트 수, 제강·연주 마친 히트 수, 합격·남은 목표 매수 |
| `get_production_results` | `ProductionResultService.listResults` (GET production-results) | 작업 실적 확정 VIEW | `productionPlanNo`(→ id), `processType`. 최신 15건, 산출 LOT 5개까지(생략한 수를 함께 줌). 계획 번호로 거르면 제선 실적이 빠진다는 안내를 붙임(제선은 `production_plan_id` null) |
| `get_quality_inspections` | `QualityService.listQualityInspections` (GET quality-inspections) | 검사 등록 VIEW | `status`(pending·done), `result`(PASS·FAIL), `lotNo`. 상위 히트 판정 포함 |
| `get_rejected_lots` | `RejectedLotService.listRejectedLots` (GET lots/rejected) | SERVICE: 불합격 처리 또는 검사 등록 VIEW | 없음. 불합격 상태·사유, 기준을 벗어난 항목만 |
| `get_purchase_requisitions` | `PurchasingService.listRequisitions` (GET purchase-requisitions) | SERVICE: 구매요청 등록 VIEW 또는 부서장 | `status`, `keyword`(번호·원료) |
| `get_purchase_orders` | `PurchasingService.listPurchaseOrders` (GET purchase-orders) | 발주 확정 VIEW | `status`, `keyword`(번호·공급업체·원료). 품목별 입고예정일·미입고 톤(= 입고예정) |
| `get_goods_receipts` | `PurchasingService.listGoodsReceipts` (GET goods-receipts) | 입고 확정 VIEW | `keyword`(입고·발주 번호·원료). 거를 말이 없으면 최신 15건 |
| `get_shipment_requests` | `ShipmentService.list` (GET shipment-requests) | SERVICE: 출하요청 관리 또는 출고 확정 VIEW | `status`, `shipmentRequestNo` |
| `get_mill_sheets` | `ShipmentService.listMillSheets` (GET mill-sheets) | 밀시트 조회 VIEW | `keyword`(밀시트·출하요청·수주번호) |
| `get_business_events` | `BusinessEventService.list` (GET business-events) | 없음(전 역할) | `salesOrderNo`, `lotNo`, `from`·`to`. 최신순 15건, 변경 전·후 원본은 넘기지 않음 |

번호·키워드로 거를 수 없는 API는 100건(API 상한)을 읽어 서버에서 거른다. 그보다 많으면 '확인하지 못한 … 수'를 함께 준다.

**안전 규칙(REQ-AST-009)** — 시스템 지시로 넣는다(`assistant.prompt.ts`)
- 용어·절차는 참고 자료(찾은 용어)만 근거로 하고, 쓴 문장 끝에 `[TRM-056]`을 붙인다.
- 모든 문장을 해요체로 답한다. 지시문을 반말로 쓰면 작은 모델이 답에 반말을 섞어서 지시문도 해요체로 쓴다.
- 업무 데이터는 반드시 도구로 조회하고, 숫자는 도구 결과에 있는 값만 단위(매·톤·건·일)와 함께 말한다. 날짜 차이·합계·비율은 직접 계산하지 않고, 결과에 없는 평가·권고는 덧붙이지 않는다. 알맞은 도구가 없는 데이터는 아직 조회할 수 없다고 답한다.
- 실제 모델(qwen3.8-flash-next) 확인에서 나온 문제와 처리: 거르기 전 전체 건수를 결과에 넣으면 그 수를 답으로 말함 → 거른 뒤 수만 넣음 / 납기까지 기간을 짐작함 → 남은 일수를 결과에 넣음 / 반말이 섞임 → 지시문 해요체 / 도구 설명에 상태 코드만 적으니 표시명을 지어내 영문 코드와 함께 씀 → `codeLabelList`로 "코드(표시명)"을 적고, 영문 코드를 답에 쓰지 않는 규칙을 넣음.
- 권한 없음이면 데이터를 말하지 않고 조회할 수 있는 역할을 안내한다.
- 자료·도구 결과에 없는 내용은 확인할 수 없다고 답한다. 등록·확정·승인 요청은 직접 할 수 없다고 답한다. 사용 금지 동의어 대신 한글명을 쓴다.
- "이 수주"처럼 화면을 가리키면 화면 주소에서 번호·id를 찾고, 없으면 되묻는다.

**출처**(`assistant.answer.ts`)
- 답 본문의 `[TRM-…]`·`(TRM-…)` 표시를 지우고, **넘긴 참고 자료 안의** 용어만 `sources`로 돌려준다(모델이 지어낸 ID는 버림).
- 모델이 ID를 빠뜨리면 본문에 이름이 나온 참고 용어를 출처로 둔다.
- 추론 모델의 `<think>…</think>`는 지운다. 답이 비면 다시 물어 달라는 문구.

**추천 질문(REQ-AST-008)**: `suggested-questions.ts`. 내용은 화면 디자인 단계 AiPanel 예시 문구를 그대로 옮긴 가정값이다. 데이터 질문은 조회 도구로 답하고, '비슷한 사례 찾아줘'는 과거 사례 DB(EX)가 없어 확인할 수 없다고 답한다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-004 | 질문 비었음·길이 초과·`history` 형식 오류 (ValidationPipe) |
| COM-999 (HTTP 503) | LLM 모델 미설정, LLM 연결 실패·시간 초과(120초). 메시지는 이유 그대로(`LlmRequestError`) |

도구 실패는 HTTP 오류가 아니다: 모델이 이유를 설명한 답으로 돌아온다.

작업 로그: 남기지 않는다. 질문·답·조회는 업무 데이터 변경이 아니고 REQ-LOG-002 대상 이벤트에 없다. 실행 카드 확정(AST-010)은 다음 단계에서 `is_ai_assisted`로 남긴다.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| llm | `LlmSettingsStore.read()`(주소·모델·API 키), `LlmClient.chatWithTools()`(이 단계에서 추가: 도구 정의·호출·결과 메시지). 기존 `chat()`은 그대로 |
| inventory·sales-order·production·purchasing·shipment | 이미 export된 service를 쓴다 |
| lot·business-event·quality | `exports`에 `LotService`·`BusinessEventService`·`QualityService`·`RejectedLotService`를 더했다(모듈 동작은 그대로) |

## 7. 테스트

DB·LLM 없이 가짜 객체로 돈다.
- `ai-assistant.spec.ts`: 용어 검색, 출처 추출, 프롬프트, 서비스(도구 호출 → 결과 전달 → 다시 묻기, 조회 출처를 앞에, 실패 도구는 출처 아님, 도구 호출 4번 상한, 이어 묻기, 모델 미설정·연결 실패 503).
- `tools/more-tools.spec.ts`: 생산계획·작업 실적(계획 번호 → id, 금지어 없음), 검사 결과·불합격 LOT(사용자 전달, 벗어난 항목만), 구매요청(사용자 전달·원료로 거르기)·발주(입고예정)·입고·출하요청·밀시트, 도구 모음의 SERVICE 권한(미리 막지 않음, COM-002 → 권한 없음 + 안내 문구, TOOLBOX 권한은 service를 부르지 않음).
- `tools/assistant-tools.spec.ts`: 도구별 거르기·한글 결과·인자 오류, 수주 정확 일치 → 충족 현황, LOT 후보, 작업 로그 번호 → id·서울 시각·원본 데이터 제외, 도구 모음(권한 밖이면 조회하지 않고 역할 안내, 없는 도구·JSON 오류·업무 오류·예상 못 한 오류 숨김, 결과 길이 상한).

실행: `npm test -w @fantasteel/server -- ai-assistant`(묶음 `fs_collab`). DB가 필요 없어 `npx jest src/modules/ai-assistant`로도 돈다.

## 8. 확인 필요 🟡

| 항목 | 지금 | 근거 |
| --- | --- | --- |
| 대화 기록 저장 | 저장 안 함(화면 탭 메모리) | [02] 21장 미결정, ERD 테이블 없음 |
| 업무 매뉴얼 | 없음, 용어 사전만 | [02] 21장 "업무 매뉴얼 작성 담당과 개수" |
| LLM 실패 오류 코드 | 9.3에 없어 COM-999 + 503 | [04] 9.3 |
| 추천 질문 내용 | 디자인 단계 예시 그대로 | [02] REQ-AST-008 "구현 단계에서 확정" |
| 질문 길이·대화 수 상한 | 1000자·20개(서버 사용 10개) | 문서에 없음(가정값) |
| 도구 결과 상한 | 목록 15줄·8000자·도구 호출 4번 | 문서에 없음(가정값, 작은 로컬 모델 기준) |
| 도구 수 | 13개를 한 번에 모델에 알린다. 작은 모델이 도구를 잘못 고르면 질문 종류로 미리 좁히는 방식을 검토 | 실제 모델 확인 결과 |
