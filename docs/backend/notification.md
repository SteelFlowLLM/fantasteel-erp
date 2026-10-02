# notification — 업무·알림

> 근거 약어: [02] 요구사항 정의서 · [03] 용어 사전 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-NTF-001(업무: 담당자·마감일), REQ-NTF-002(개인·부서 알림, 메신저·Agent 알림도 이 모듈), REQ-ORG-004(부서 알림 대상), REQ-MSG-005(멘션·업무방 알림의 저장·발송) |
| BP | BP-MSG-01 업무·알림·메신저([04] 6장) 중 업무·알림 부분 |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `task` | `task_title`, `task_description`, `assignee_id`, `due_date`(date), `task_status`(OPEN → DONE) |
| 쓰기 | `notification` | `notification_type`(NOTIFICATION_TYPE), `recipient_id`(**부서 알림은 발송 시 부서원별 행으로 펼침**), `notification_content`, `link_path`(ERP 화면 이동 경로), `message_id`, `business_event_id`, `read_at` |
| 읽기 | `employee`, `department` | 담당자·부서원 |

부분 unique(중복 알림 방지, [04] BP-MSG-01 "같은 알림은 이벤트 ID·수신자 조합으로 중복 생성하지 않는다"):
- `notification_message_recipient_key` — `(message_id, recipient_id) WHERE message_id IS NOT NULL`
- `notification_business_event_recipient_key` — `(business_event_id, recipient_id) WHERE business_event_id IS NOT NULL`

Prisma 관계 이름: `Employee.tasksAsAssignee`, `Employee.notificationsAsRecipient`.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `tasks` | 업무 목록 | 로그인만(업무·알림은 전 역할) | 상태는 TASK_STATUS |
| POST | `tasks` | 업무 등록 | 로그인만 | |
| POST | `tasks/:id/complete` | 업무 완료 | 담당자 본인(service 확인) | OPEN → DONE |
| GET | `notifications` | 알림 목록 | 본인 알림 | 알림 발송은 서버 내부 처리(API 없음), 유형은 NOTIFICATION_TYPE |

## 4. 업무 규칙

**업무**(REQ-NTF-001)
- 등록: 제목·설명·담당자(`assigneeId`, 재직 중인 사원인지 조회, 없으면 COM-003)·마감일(date). 상태 OPEN.
- 완료: 담당자 본인만, OPEN에서만 DONE([06] TASK_STATUS, [04] 10장). 다른 사람이면 COM-002.
- 작업(공정 작업)과 다르다: 공정 작업은 상태값이 없고 실적의 시작·완료 시각으로 판단한다([04] 10장 "작업").

**알림**(REQ-NTF-002)
- 목록: `recipient_id = 로그인 사원`, 최신순, 페이징. 안 읽은 알림은 `read_at IS NULL`.
- 발송은 API가 아니라 다른 모듈이 부르는 서비스 함수다. `NotificationService`를 export하고 아래 함수를 `tx` 첫 인자로 둔다(권장 이름):

| 함수 | 내용 |
| --- | --- |
| `notifyEmployees(tx, { type, recipientIds, content, linkPath, messageId?, businessEventId? })` | 개인 알림. `createMany({ skipDuplicates: true })`로 부분 unique 중복을 건너뛴다 |
| `notifyDepartment(tx, departmentId, {...})` | 부서 알림. 그 부서의 재직 중 사원별 행으로 펼친다([ERD] Note, REQ-ORG-004) |

- 유형 값은 [06] 확정값 MENTION·WORK_ROOM_MESSAGE만 쓴다. `link_path`는 프론트 화면 경로(REQ-MSG-006 "ERP 화면 이동").
- 알림은 본 거래와 같은 tx에서 저장한다(본 거래가 롤백되면 알림도 없어야 한다).

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-002 | 담당자가 아닌 사람의 업무 완료 |
| COM-003 | 담당자·업무 없음 |
| COM-004 | DTO 검증 실패 |

작업 로그: 없음. REQ-LOG-002·BUSINESS_EVENT_TYPE에 업무·알림 이벤트가 없다.

## 6. 다른 모듈과의 경계

| 상대 | 관계 |
| --- | --- |
| messenger | 멘션 → MENTION, 업무방 새 메시지 → WORK_ROOM_MESSAGE (`messageId`로 중복 방지) |
| organization | 부서원 목록(부서 알림 펼침) |
| purchasing·message-action | 승인 요청·결과 알림을 보내려면 유형이 확정돼야 한다(8장) |
| (P2) factory-agent | Agent 알림도 이 모듈을 쓴다(REQ-NTF-002). 지금은 만들지 않는다 |
| messenger Gateway | 새 알림을 실시간으로 밀어 줄지는 미정(8장) |

## 7. 테스트

[05] 11장 필수 대상은 아니다. 권장(`npm test -w @fantasteel/server -- notification`, 묶음 DB `fs_collab`):

- 같은 메시지로 같은 사람에게 알림을 두 번 보내도 1건만 남는다.
- 부서 알림이 재직 중 부서원 수만큼 행을 만든다.
- 다른 사람이 업무 완료 → COM-002.
- [04] 14.2: 멘션 알림·ERP 화면 이동(messenger와 함께).

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 알림 유형 부족 | TASK_ASSIGNED·APPROVAL_REQUESTED·APPROVAL_RESULT는 [06] 3장 제안값이다. 확정 전에는 업무 지정·구매요청 승인 요청(13.4 `notify(departmentHeadOf(actor))`) 알림을 보낼 유형이 없다 | [06] 3장, [04] 13.4 |
| 읽음 처리 API | `read_at` 컬럼은 있지만 [CSV]에 읽음 처리 API가 없다 | [ERD], [CSV] |
| 업무 목록 범위 | 내 업무만인지, 내가 만든 업무·전체인지 정해지지 않았다. `task`에 등록자 컬럼이 없다 | [CSV], [ERD] |
| 업무 수정·담당자 변경 | API가 없다 | [CSV] |
| 실시간 알림 | 알림을 WebSocket으로 밀어 줄지(메신저 Gateway 재사용) 정해지지 않았다 | [02] REQ-MSG-002·005 |
| 부서 알림 하위 부서 | 부서 알림에 하위 부서원을 포함할지 | [02] REQ-NTF-002, REQ-ORG-001 |
