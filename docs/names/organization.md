# organization · notification 모듈에서 새로 지은 이름

용어 사전·프로세스 정의서 11·12장에 없는 이름만 적는다. (사원 `employeeName`·`jobGrade`·`roleCode`, 부서 `departmentCode`·`parentId`·`headEmployeeId`, 업무 `assigneeId`·`creatorId`·`dueDate`·`taskStatus`·`linkPath`, 알림 `notificationType`·`isRead` 등 스키마·shared에 이미 있는 이름은 제외.)

| 이름 | 어디에 쓰는지 | 왜 필요한지 |
|---|---|---|
| `ApproverResolver` / `resolveApprover(tx, requesterEmployeeId)` / `ResolvedApprover` | organization 서비스 (`approver.resolver.ts`), 구매 모듈이 주입 | 승인권자(TRM-035) 결정 규칙을 한 곳에 두려고. 이름·시그니처는 구매 담당과 합의한 값 |
| `EmployeeDirectoryEntry`, `GET /employees/directory` | 응답 타입·경로 | 관리 권한 없이 쓰는 가벼운 사원 목록(메신저 멤버·업무 담당자 선택). "directory"는 사내 인명부 의미 |
| `isDepartmentHead` | 사원 응답 필드 | 사원이 어느 부서든 부서장인지(부서장 = TRM-034). DB 컬럼 아님, `department.head_employee_id`에서 계산 |
| `OrgChartNode`, `OrgChartMember`, `isHead` | `GET /departments/tree` 응답 | 조직도(REQ-ORG-003) 노드·인원. `isHead`는 "그 부서의 부서장인지" |
| `memberCount`, `headEmployeeName` | 부서 응답 필드 | 목록 화면에서 추가 조회 없이 인원 수·부서장 이름을 보이려고 (계산값, 컬럼 아님) |
| `initialPassword`, `newPassword` | 사원 등록·비밀번호 초기화 요청 필드 | 관리자가 정한 비밀번호. 서버는 해시(`passwordHash`)만 저장 |
| `PermissionEntry`, `RoleView`, `ReplaceRolePermissionsBody` | 역할 API 타입 | 역할별 권한 행렬(`role_permission`)을 통째로 교체하는 요청·응답 |
| `unread-count`, `read-all`, `unreadOnly`, `nextCursor` | 알림 API 경로·쿼리·응답 | 안 읽은 수, 전체 읽음, 안 읽은 것만 보기, 커서 페이지 |
| `notification-read` | 소켓 이벤트 이름 | 같은 사원의 다른 화면에서 읽음 처리했을 때 안 읽은 수를 맞추는 신호 (`notification`은 NotificationSender가 이미 씀) |
| `scope` = `mine` \| `created` \| `all` | `GET /tasks` 쿼리 | 내가 담당한 업무 / 내가 만든 업무 / 둘 다 |
| `assigneeName`, `creatorName` | 업무 응답 필드 | 목록에서 이름을 바로 보이려고 (계산값) |
