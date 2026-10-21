# API 명세서

<aside>
💡

API 1개 = 행 1개입니다. 행을 열면 상세 명세(요청 → 응답 → 오류 → 처리 규칙)를 담당자가 작성합니다.

**기준 문서 6개**(프로젝트 기획안·요구사항 정의서·용어 사전·업무 프로세스 정의서·코드 컨벤션·공통 코드 정의서)로 작성했습니다(2026-10-02). 업무 프로세스 정의서 12.2절에 있는 경로는 그대로 쓰고, 없는 경로는 코드 컨벤션 5장 규칙으로 도출했습니다(비고에 ‘12.2 명시’/‘도출’ 표시). 권한은 공통 코드 정의서 PERMISSION, 리소스 이름은 용어 사전 DB명을 따릅니다. 🟡 = 기준 문서에 근거가 없어 팀 확인이 필요한 항목.

**탭 구성 (요구사항 정의서 장 기준):** 관리 = 인증·조직(1·1-1장)+기준정보(2장) · 영업 = 수주(3장) · 생산 = 생산·MRP(4장) · 재고 = 재고·배정(5장) · 구매 = 구매(6장) · 품질 = 품질(8장) · 물류 = 출하·밀시트(9장) · 공통 = LOT·로그(7·10장)+업무·알림(11장)+메신저·Action(12·13장)+Voice2ERP(14장)+AI·Agent(15·16장)+과거 사례(17장)+대시보드(18장)

</aside>

## 공통 규약

| 항목 | 규칙 |
| --- | --- |
| 인증 | 로그인을 제외한 모든 API는 인증 필요. JWT는 httpOnly 쿠키(Secure, SameSite=Lax)로 주고받고, 프론트는 credentials를 포함해 호출한다. 사용자 ID·권한은 서버 인증 컨텍스트에서 가져온다 (코드 컨벤션 6·9장) |
| 권한 | 컨트롤러에 권한 가드 `@RequirePermission(PERMISSION.X, 'USE')` 적용, 조회는 VIEW 이상. 구매요청 승인은 권한 코드 없이 ‘요청자 소속 부서의 부서장인가’를 service에서 검사 (코드 컨벤션 6장, REQ-AUTH-004) |
| 경로 | `/api/v1` 뒤에 kebab-case 복수 명사. 상태 변경은 `POST /:id/동작`, 계산 조회는 예외(예: `GET /api/v1/mrp/requirements`). 리소스 이름은 용어 사전 영문명 (코드 컨벤션 2·5장) |
| 요청 검증 | class-validator DTO + 전역 ValidationPipe(whitelist·forbidNonWhitelisted·transform). 요청으로 받은 ID는 조회해서 확인하고 없으면 COM-003 (코드 컨벤션 5장·7-2) |
| 페이징·날짜 | `page`, `size`, `sort`. 날짜·시각은 ISO 8601, 시각은 timestamptz로 저장하고 Asia/Seoul로 표시. 납기일·희망 입고일·생산완료일은 date (코드 컨벤션 5장) |
| 삭제 | 업무 거래(수주·예약·구매요청·발주·입고·LOT·실적·검사·출하)는 삭제 API를 만들지 않고 상태로 끝낸다. 기준정보는 참조가 없을 때만 삭제, 사원은 isActive로 퇴사 처리 (코드 컨벤션 7-2) |
| 성공 응답 | `{ "success": true, "data": ... }` · 전역 인터셉터가 만든다 (코드 컨벤션 5장) |
| 오류 응답 | `{ "success": false, "error": { "code": "...", "message": "..." } }` · 전역 예외 필터가 만든다. 코드는 `영역-번호`(예: SO-002, 공통 COM-), 목록은 업무 프로세스 정의서 9.3절 |
| 중복 요청 방지 | 🟡 미정. 업무 프로세스 정의서 12.2·13장이 요청 고유키를 제안(수주 등록·출고 확정·초안 확정, 입고 반복 확정 차단). 헤더 이름과 적용 범위는 팀 결정 필요 |
| 동시 수정 방지 | 🟡 미정. `expectedVersion` 버전 충돌 검사(충돌 시 COM-001) 적용 대상은 팀 결정 필요 |
| 단위 | 제품 수량은 정수(매/개), 원료·중량은 톤(t, 소수 3자리). 제품 톤은 저장하지 않고 매수 × 이론중량으로 계산, Decimal은 응답에서 문자열 (코드 컨벤션 2·5장) |

## AI 연결(LLM) 실패 오류 코드 (9.3에 없음)

철강맨AI(API-262 등)가 AI 서버(LLM)를 부르지 못했을 때 쓴다. 업무 프로세스 정의서 9.3에 코드가 없어 `COM-999`(500대)로 나가던 것을 나눠, 화면이 코드에 맞는 안내를 보이게 했다(이슈 #462). 🟡 팀 확인 후 9.3에 올린다.

| 코드 | HTTP | 언제 | 화면 안내 |
| --- | --- | --- | --- |
| AST-001 | 404 | 저장한 대화가 없거나 남의 대화 (이슈 #399) | 대화를 찾을 수 없어요 |
| AST-002 | 503 | AI 연결에 모델이 정해져 있지 않음 | 관리자가 AI 연결 화면에서 모델을 골라야 해요 |
| AST-003 | 503 | AI 서버에 연결할 수 없음 (서버가 꺼졌거나 주소가 틀림) | 잠시 뒤 다시 묻고, 계속되면 관리자에게 알려요 |
| AST-004 | 503 | AI 서버가 시간 안에 답하지 않음 | 질문을 줄이거나 잠시 뒤 다시 물어요 |
| AST-005 | 503 | 그 밖의 AI 서버 실패 (HTTP 오류·API 키·읽을 수 없는 응답). 문구는 AI 서버가 알려 준 이유 | 이유를 확인하고 관리자에게 알려요 |

- 연결 실패(AST-003)의 문구에는 내부 AI 서버 주소를 싣지 않는다(서버 로그에만 남김).
- 실시간 답(`POST /ai-assistant/messages/stream`)은 응답을 시작한 뒤 실패하면 `{ "type": "error", "message", "code" }` 이벤트로 끝낸다. `code`는 위 표의 AST-002~005일 때만 있다.
- 심층 조사의 계획 말로 고치기(API `POST /ai-research/runs/:id/plan/suggest`)도 같은 코드를 쓴다. 답은 왔는데 계획으로 읽지 못하면 `RES-008`이다. 심층 조사·회의록 분석처럼 백그라운드로 도는 일의 실패 이유는 코드가 아니라 저장된 문구다.

## 외부 연결 장애 알림과 Notion 반영 실패 목록 (문서 밖 기능, 이슈 #518)

관리 > 외부 연결(Notion·Google Drive)의 장애를 연동 관리 권한자(ORG_MANAGE 사용)에게 알림으로 알리고, Notion 업무 공간 반영에 실패한 일정·회의록·할 일을 DB에 남겨 다시 시도하게 한다. 🟡 팀 확인 후 확정한다. 자세한 규칙은 `docs/backend/integration.md` 13장.

| API | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| API-287 | `GET /api/v1/integrations/notion/sync-failures` | ORG_MANAGE (VIEW 이상) | 반영에 실패해 남은 행: 종류(`schedule_event`·`meeting_minutes`·`task`)·id·제목·실패 횟수·마지막 이유·결과 모름 여부·다음 자동 시도 시각 |
| API-288 | `POST /api/v1/integrations/notion/sync-failures/retry` | ORG_MANAGE (USE) | 남은 실패를 모두 다시 시도하고 결과를 기다린다. 만들어졌는지 알 수 없던 '결과 모름' 건은 중복 페이지를 막으려고 빼고 건너뛴 수를 알린다. 응답 `{ requested, succeeded, failed, skipped, failures }` |
| API-289 | `POST /api/v1/integrations/notion/sync-failures/:failureId/retry` | ORG_MANAGE (USE) | 한 건만 다시 시도한다. 없는(이미 처리된) 건은 `COM-003` |

- `GET /api/v1/integrations`(로그인만)의 각 연결에 `health`가 더해졌다: `{ level: NORMAL | WARNING | DOWN(정상·주의·끊김), lastErrorAt, faults[] }`.
- 알림 유형(공통 코드 정의서 NOTIFICATION_TYPE): `INTEGRATION_FAULT`(연동 장애), `INTEGRATION_RECOVERED`(연동 복구). 같은 연결·같은 종류의 장애는 풀리기 전까지 하루 한 번만 알리고(서버가 여러 대여도 한 번), 풀리면 복구 알림을 한 번 보낸다. 알림을 누르면 `/admin/integrations`로 간다.
- 새 오류 코드는 없다. 다시 시도: Notion 연결·업무 공간이 없으면 `INT-002`, 권한이 없으면 `COM-002`, 없는 항목은 `COM-003`.

## 메신저 실시간 이벤트 (WebSocket)

REQ-MSG-002. socket.io namespace `/messenger`. 연결할 때 로그인 쿠키(`access_token`)로 사원을 확인하고, 실패하면 서버가 연결을 끊는다. 보내기·읽음 등 저장은 HTTP API로 하고, 서버는 저장(커밋)이 끝난 뒤 아래 이벤트를 보낸다. 소켓은 사원 채널(`employee:{id}`)에 들어간다. 자세한 규칙은 `docs/backend/messenger.md` (2026-10-07~08 추가, 문서에 없는 기능 포함)

| 이벤트 | 방향 · 받는 사람 | 페이로드 |
| --- | --- | --- |
| `message:new` | 서버 → 방 멤버 전원 (보낸 사람의 다른 탭 포함) | 메시지 (`isMine`은 받는 사원 기준) |
| `room:read` | 서버 → 읽은 본인 | `{ chatRoomId, lastReadMessageId, unreadCount }` |
| `member:read` | 서버 → 읽은 사람을 뺀 방 멤버 | `{ chatRoomId, employeeId, lastReadMessageId }` (메시지별 안 읽은 사람 수 갱신) |
| `room:updated` | 서버 → 방 멤버 전원 | `{ chatRoomId }` (방 생성·멤버 추가·이름 변경) |
| `presence:snapshot` | 서버 → 막 연결한 소켓 | `{ onlineEmployeeIds }` |
| `presence:changed` | 서버 → 메신저에 연결된 모든 사원 | `{ employeeId, online }` (첫 연결 = 접속, 마지막 연결 끊김 = 나감) |
| `typing` | 화면 → 서버 | `{ chatRoomId }` (방 멤버가 아니면 무시, 화면은 3초에 한 번) |
| `typing` | 서버 → 보낸 사람을 뺀 방 멤버 | `{ chatRoomId, employeeId, employeeName }` (화면은 6초 표시) |

## 색상 가이드

- **Method:** GET 초록 · POST 파랑 · PUT 노랑 · PATCH 주황 · DELETE 빨강
- **등급:** P1 빨강 · P2 주황 · P3 파랑 · EX 회색
- **인증:** AUTHENTICATED 초록 · PUBLIC 회색
- **작성 상태:** 초안 회색 → 작성 중 노랑 → 검토 요청 주황 → 확정 파랑 → 구현 완료 초록

[API 목록](api-spec/API%20%EB%AA%A9%EB%A1%9D%202b95d562c5cc4fb8ba1aa71e4a8d99c8.csv)