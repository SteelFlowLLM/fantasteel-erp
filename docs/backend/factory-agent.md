# factory-agent — AI Factory Agent 위험 감지·대응 후보

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 확인 필요.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-AGT-001~006 (P2), REQ-PUR-005 |
| BP | BP-AGT-01 |
| 원칙 | 감지와 대응 후보 생성은 **규칙**이 한다. LLM은 상황 설명(API-264)만 한다 |

## 2. 구현 상태 (2026-10-15)

| 위험 | 트리거 | 대응 | 상태 |
| --- | --- | --- | --- |
| RAW_SHORTAGE (REQ-AGT-002) | 스케줄 | 구매요청 초안(후보) | 완료 — MRP 순소요 > 0인 계획·원료마다 |
| GOOD_QTY_SHORTAGE (REQ-AGT-003) | 검사 등록 이벤트 | 재생산 계획 초안(후보) | 완료 — 재생산 판단 "추가 계획 필요 > 0" |
| DUE_RISK (REQ-AGT-004) | 스케줄 | 수주 담당 영업 알림 | 완료 — 납기까지 `production_setting.delivery_risk_days`(초기 3일) 이하 + 출하 < 수주 |
| AGED_SURPLUS (REQ-AGT-004) | 스케줄 | 대기 수주 배정 추천(후보) | 완료 — 생산완료 30일 이상 여재 + 같은 규격 대기 수주(미확보 > 0). **추천만** 한다 |
| QUALITY_RATE_RISE (REQ-AGT-004) | 스케줄 | 품질부(QC) 알림 | 완료 — 강종별 최근 30일 불합격률 5% 초과 (검사 5건 미만 제외) |

- 알림형(DUE_RISK·QUALITY_RATE_RISE)은 후보를 만들지 않는다. 안 읽은 같은 알림이 있으면 다시 보내지 않는다(읽으면 다음 감지에서 다시 알린다). 작업 로그 유형이 없어 알림형은 작업 로그를 남기지 않는다.
- 배정 추천(ALLOCATION_CONFIRM 유형)은 실행 핸들러가 없다. 확정은 "추천 확인" 기록이고(EXECUTED, 결과 없음), 실제 예약·배정은 재고·출하요청 화면에서 한다.
- 화면: `/agent` (`client/src/features/agent/AgentScreen.tsx`)의 대응 후보 목록·상황 설명·확정·반려, 대시보드 Agent 위험 감지 위젯(확정 대기 건수·유형별·최근 후보).

## 3. 구조

- 후보는 `action_draft`에 저장한다. 스키마는 바꾸지 않았다 (2026-10-15 사용자 결정).
  - `message_id = null`이면 Agent 후보다. `payload.agent`에 `riskType`, `targetKey`, `summary`, `evidence`를 남긴다.
  - **중복 방지(REQ-AGT-005)**: `payload.agent.targetKey`가 같고 상태가 AI_GENERATED·WAITING_APPROVAL·APPROVED인 초안이 있으면 새로 만들지 않는다. 감지는 서버 안에서 한 번에 하나씩 돌린다(DB unique 없음, 서버 1대 가정).
  - `requester_id`는 만들 때 비어 있고, 확정한 사원이 확정 주체가 된다.
- 확정 권한은 후보가 만드는 업무의 권한을 따른다: 구매요청 `PURCHASE_REQUISITION_CREATE` USE, 재생산 `PRODUCTION_PLAN_CONFIRM` USE. 구매요청 결과는 확정자 소속 부서장이 최종 승인한다 (`purchasing.createRequisition`).
- 확정 전 **재검증**: 위험이 해소됐으면 실행하지 않고 후보를 REJECTED(`[자동] …`)로 닫는다.
- 실행 실패는 `execution_error_code`·`execution_attempt_count`로 남기고 APPROVED로 둔다 (message-action과 같은 방식).

## 4. API

| Method | Path | 비고 |
| --- | --- | --- |
| GET | `action-drafts?source=agent` | Agent 후보 목록 (API-252 공용). 후보 업무의 조회 권한이 있는 사원만 |
| GET | `action-drafts/:id` | 후보면 `AgentCandidateView` |
| POST | `action-drafts/:id/confirm` · `execute` · `reject` | 후보면 factory-agent가 처리 (API-255 공용) |
| POST | `action-drafts/:id/explain` | API-264. LLM 설정이 없거나 실패하면 규칙 요약(`generatedByAi: false`) |

`MessageActionController`가 후보 여부(`isCandidate`)로 갈라 넘긴다. 감지는 스케줄·이벤트로 돌고 API는 아래 하나뿐이다.

| Method | Path | 비고 |
| --- | --- | --- |
| POST | `agent/scan` | API-283 (문서 밖 기능, 2026-10-21 이슈 #477). **관리자(ADMIN)만**(아니면 COM-002): 24시간을 기다리지 않고 감지 규칙을 지금 돌린다. 스케줄과 같은 규칙·같은 순서 큐·같은 중복 방지(같은 대상의 처리 전 후보는 새로 만들지 않고, 안 읽은 같은 알림은 다시 보내지 않는다)를 쓴다. 응답 `{ ranAt, results: [{ riskType, detected, created, error }] }` — 알림형(납기 위험·불합격률 상승)의 `created`는 보낸 알림 수, 규칙이 실패하면 그 규칙의 `error`에 이유(다른 규칙은 계속 돈다). 합격 매수 부족은 검사 등록 이벤트로만 감지해 여기 없다. 규칙 실패 시 `error`에는 일반 문구만 싣고 예외 원문은 서버 로그에만 남긴다. 마지막으로 받아들인 실행 뒤 60초(🟡 가정값 `MANUAL_SCAN_MIN_INTERVAL_MS`) 안에 다시 요청하면 거절(COM-004, 429) |

화면은 `/agent` 후보 목록 위쪽의 [지금 감지] 버튼(관리자에게만 보임)이고, 결과를 "원료 부족 후보 1건 · 납기 위험 알림 2건"처럼 한 줄로 알려 준다.

## 5. 감지 트리거

- 관리자 수동 실행: `POST agent/scan`(4장) — 스케줄을 기다리지 않고 같은 `scanAll`을 돌린다. 데모·점검용.
- 스케줄: `FactoryAgentScheduler` — 서버 시작 직후 한 번, 이후 `AGENT_SCAN_INTERVAL_HOURS`(기본 24, 0이면 끔)마다. 테스트(`NODE_ENV=test`)에서는 돌지 않는다. 새 패키지를 쓰지 않았다.
- 이벤트: `QualityService.registerQualityInspection` 커밋 뒤 `onInspectionRegistered(lotId)`. 감지가 실패해도 검사 등록은 그대로다.

## 6. 확인 필요 🟡

2026-10-15 사용자가 아래 기본값대로 진행하라고 했다. 팀 확정 전 임시다.

| 항목 | 지금 값 |
| --- | --- |
| 원료 부족 조회 기간 | 필요일이 오늘부터 30일 이내 (`RAW_SHORTAGE_HORIZON_DAYS`) |
| 스케줄 주기 | 24시간 (`AGENT_SCAN_INTERVAL_HOURS`) |
| 여재 보유일 | 생산완료 30일 이상 (`AGED_SURPLUS_DAYS`) |
| 불합격률 | 최근 30일, 5% 초과, 검사 5건 이상 (`agent-alert-rules.ts`) |
| 알림 유형 | 공통 코드 정의서 NOTIFICATION_TYPE에 맞는 값이 없어 **임시로 TASK_ASSIGNED(업무 지정)** 를 쓴다. 정의서에 유형이 추가되면 `ALERT_NOTIFICATION_TYPE` 한 곳만 바꾼다 |
| 위험 유형 코드 | `AGENT_RISK_TYPE`을 `shared/src/factory-agent.ts`에 직접 뒀다. 정의서에 올라가면 codes로 옮긴다 |
| 후보 생성 알림 | 후보가 생겼을 때 담당 부서원에게 알리지 않는다(화면 `/agent`에서 확인). 알림 유형이 정해지면 추가 |
| 중복 방지 | DB unique가 아니라 서비스 확인 + 한 번에 하나씩 감지(서버 1대 가정) |

## 7. 테스트

`npm test -w @fantasteel/server -- factory-agent` (묶음 DB `fs_prod`, 묶음 전체가 같이 돈다). 규칙 단위 테스트는 `agent-rules.spec.ts`·`agent-alert-rules.spec.ts`(DB 없음), 알림형 DB 테스트는 `factory-agent-alerts.spec.ts`. 여재 추천의 DB 테스트는 `factory-agent-surplus.spec.ts`.

## 8. 공통 코드 정의서 추가 요청안 (2026-10-15)

`docs/notion/06-공통-코드-정의서.md`는 읽기 전용이고 `shared/src/codes/index.ts`는 정의서에서 생성하는 파일이라 이 작업에서 직접 고치지 않았다. 정의서 담당자가 아래를 올리면 코드는 바로 바꿀 수 있다.

**NOTIFICATION_TYPE (알림 유형) — 근거 REQ-AGT-004, REQ-NTF-002**

| 값 | 표시명 | 쓰는 곳 |
| --- | --- | --- |
| DUE_RISK | 납기 위험 | 수주 담당 영업에게 보내는 납기 위험 알림 |
| QUALITY_RATE_RISE | 불합격률 상승 | 품질 부서원에게 보내는 알림 |
| AGENT_CANDIDATE | 대응 후보 | (선택) 대응 후보가 생겼을 때 담당 부서원에게 보내는 알림. 지금은 보내지 않는다 |

**AGENT_RISK_TYPE (Agent 위험 유형) — 근거 BP-AGT-01 "위험 코드 제안"**

| 값 | 표시명 |
| --- | --- |
| RAW_SHORTAGE | 원료 부족 |
| GOOD_QTY_SHORTAGE | 합격 매수 부족 |
| DUE_RISK | 납기 위험 |
| AGED_SURPLUS | 여재 장기 보유 |
| QUALITY_RATE_RISE | 불합격률 상승 |

정의서 반영 뒤 코드에서 할 일:
1. `npm run codes -w @fantasteel/shared`로 코드를 다시 만든다.
2. `shared/src/factory-agent.ts`의 `AGENT_RISK_TYPE`·`AGENT_RISK_TYPE_LABEL`을 지우고 codes 것을 쓴다.
3. `factory-agent.service.ts`의 `ALERT_NOTIFICATION_TYPE`(지금 `TASK_ASSIGNED`)을 위험별 유형(DUE_RISK·QUALITY_RATE_RISE)으로 바꾼다. 클라이언트 알림 목록의 유형 배지(`NOTIFICATION_TYPE_TONE`)에도 두 값을 더한다.
4. 알림형 작업 로그가 필요하면 정의서 2장 BUSINESS_EVENT_TYPE로 옮겨 둔 `AGENT_RISK_DETECTED`(Agent 위험 감지, 정의서 3장에 P2로 예약돼 있음)를 쓴다.

기준값(원료 부족 조회 기간·스케줄 주기·여재 보유일·불합격률)과 여재 추천(추천만 함)은 6장의 현재 값 그대로 둔다.

## 9. 화면에서 직접 확인하기

데모 데이터(`npm run seed:demo -w @fantasteel/server`)는 원료가 충분하고 납기에 여유가 있어서 Agent가 아무것도 감지하지 않는다(후보 0건이 정상이다). 시연할 때는 위험 조건을 만든다. 로컬 DB에서만 한다.

```bash
npm run dev                                     # DB · 서버 · 화면
npm run seed:demo -w @fantasteel/server         # 데모 데이터 (이미 넣었으면 생략)
npm run agent:demo-risk -w @fantasteel/server   # 위험 조건 만들기 (바꾸기 전 값과 되돌리는 SQL을 보여 준다)
# 감지는 서버가 시작될 때와 24시간마다 돈다. 기다리지 않으려면 관리자(이현정 1503001)로 /agent의 [지금 감지]를 누른다 (서버를 껐다 켜도 된다)
```

`agent:demo-risk`가 하는 일: 필요일이 30일 이내인 열린 생산계획 하나의 히트 수를 400으로 키우고(원료 부족), 진행 중인 수주 품목 하나의 납기를 오늘 + 2일로 당긴다(납기 위험). 공용 DB를 가리키면 실행하지 않는다.

| 로그인 (비밀번호 `fantasteel`) | 확인할 것 |
| --- | --- |
| 정다은 `2207005` (구매) | `/agent`에서 원료 부족 후보 4건 → 상황 설명 → 확정(구매요청 생성) · 반려 |
| 박서영 `2103003` (영업) | 상단 알림의 `[Agent 납기 위험]`, 구매요청 후보를 확정하려 하면 권한 오류(COM-002) |
| 생산 `1401006` | 재생산 후보 확정 → 생산계획 생성 (후보는 검사 등록 이벤트로 생기고, 데모 데이터를 넣는 과정에서도 생긴다) |
| 품질 | 대시보드 맨 아래 Agent 위험 감지 한 줄 요약 |

확인 포인트
- 상황 설명 버튼: LLM이 연결돼 있으면 "AI가 작성", 없으면 "규칙 요약". 설명이 근거 값 안의 숫자만 쓰고 무엇을 하라는 권고를 하지 않는지 본다.
- 후보를 연 채로 위험을 없애고(예: 그 생산계획을 취소) 확정하면 실행하지 않고 후보가 닫힌다.
- 서버를 다시 시작해도 같은 대상의 후보가 늘어나지 않는다. 반려한 대상은 다음 감지에서 새 후보가 생긴다.
- 확정하거나 반려하면 대시보드 위젯의 확정 대기 건수가 줄어든다.

자동 테스트: `npm test -w @fantasteel/server -- factory-agent`, `npm run test -w @fantasteel/client`.
