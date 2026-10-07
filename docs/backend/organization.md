# organization — 사원·부서·직급·역할 권한·조직도

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록 · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외). 스켈레톤은 `@Controller()`이므로 메서드마다 전체 경로를 쓴다(예: `@Get('departments')`).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-AUTH-002(사원·부서·직급 관리), REQ-AUTH-003(역할별 권한 데이터), REQ-AUTH-004(승인권자 데이터), REQ-ORG-001~004 |
| BP | BP-AUTH-01 로그인·조직·권한([04] 6장, 조직관리 토글) |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 핵심 컬럼·규칙 |
| --- | --- | --- |
| 쓰기 | `employee` | `employee_no` unique(로그인 ID), `password_hash`(bcrypt), `department_id`·`job_grade_id`·`role_id` not null, `is_active`(퇴사 처리. **사원은 삭제하지 않음**) |
| 쓰기 | `department` | `department_code` unique, `parent_id`(상위 부서, **순환 금지는 service**), `head_employee_id`(부서장 1명, 역할 아님) |
| 쓰기 | `job_grade` | `job_grade_name`, `sort_order`(표시 순서) |
| 쓰기 | `role_permission` | `(role_id, permission)` unique, `permission_level` = USE·VIEW. **권한이 없으면 행을 두지 않는다** |
| 읽기 | `role` | `role_code` = ROLE 6개(SALES·PURCHASE·PRODUCTION·QUALITY·LOGISTICS·ADMIN). 역할 추가 API는 없다 |

- Prisma 관계 이름: `Department.parent`/`departmentsAsParent`(하위 부서), `Department.headEmployee`, `Department.employees`, `Employee.departmentsAsHeadEmployee`, `Role.rolePermissions`.
- 시드(`server/prisma/seed.ts`): 부서 10개(영업부·구매부·생산부와 하위 제선·제강·연주·열연파트·품질부·물류부·경영지원부), 직급 5개, 사원 15명(부서마다 부서장 1명), 역할 권한은 [권한표] 그대로.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| GET | `employees` | 사원 목록 조회 | `EMPLOYEE_MANAGE` VIEW | 페이징 page·size·sort |
| POST | `employees` | 사원 등록 | `EMPLOYEE_MANAGE` USE | 비밀번호 bcrypt 저장 |
| PATCH | `employees/:id` | 사원 수정 | `EMPLOYEE_MANAGE` USE | 삭제 대신 `isActive`로 퇴사 |
| GET | `departments` | 부서 트리·조직도 조회 | 로그인만(전 사용자) | 메신저 멤버·알림 대상 선택에도 사용(REQ-ORG-004) |
| POST | `departments` | 부서 등록 | `ORG_MANAGE` USE | |
| PATCH | `departments/:id` | 부서 수정·부서장 지정 | `ORG_MANAGE` USE | 계층 순환 차단 |
| GET | `job-grades` | 직급 목록 조회 | 로그인만 | 조직도 직급 표시(REQ-ORG-003) |
| POST | `job-grades` | 직급 등록 | `EMPLOYEE_MANAGE` USE 🟡 | [CSV]: 직급 관리 권한 코드가 따로 없음 |
| GET | `roles` | 역할·권한 조회 | `ORG_MANAGE` VIEW | ROLE·PERMISSION·PERMISSION_LEVEL |
| PUT | `roles/:id/permissions` | 역할별 권한 변경 | `ORG_MANAGE` USE | 승인 권한 코드는 없음(REQ-AUTH-004) |

[권한표] 기본값: `EMPLOYEE_MANAGE`·`ORG_MANAGE`는 관리자만 USE, 다른 역할은 권한 행 없음.

**구현 상태:** 조회 4개(`GET employees`·`departments`·`job-grades`·`roles`) 구현. 응답 타입은 `shared/src/organization.ts`.
- `GET employees`: 정렬은 부서코드 → 직급 `sort_order` → 사원번호로 고정. [CSV]에 없는 거르기 `departmentId`·`roleCode`·`isActive`·`keyword`(이름·사원번호)는 사원 관리 화면용으로 추가했다.
- `GET departments`: 최상위부터 부서코드 순 트리. 부서마다 사용 중인 인원(직급 순, 부서장 여부)을 넣는다.
- 직급·역할의 `employeeCount`는 사용 중인 사원 수(계산값).

## 4. 업무 규칙

- **사원 등록**: `employeeNo` 중복 불가. 비밀번호는 `bcryptjs`의 `hash`로 저장하고 평문을 저장·로그 출력하지 않는다([05] 6장 [강제]). 응답 매퍼(`toEmployeeResponse`)에서 `passwordHash`를 뺀다. `departmentId`·`jobGradeId`·`roleId`는 조회해서 없으면 `COM-003`([05] 7-2).
- **퇴사**: `isActive = false`. 다음 요청부터 인증 가드가 `AUTH-002`로 막는다(`common/auth/auth-user.service.ts`). 사원·부서·직급 삭제 API는 [CSV]에 없으므로 만들지 않는다.
- **부서 계층**(REQ-ORG-001): `parentId`를 바꿀 때 새 상위 부서에서 위로 올라가며 자기 자신이 나오면 거부한다(자기 자신을 상위로 지정 포함, [04] BP-AUTH-01 예외 처리).
- **부서장 지정**(REQ-ORG-002): 부서마다 1명(`head_employee_id`). 역할이 아니다. 구매요청 최종 승인권자는 "요청자 소속 부서의 부서장"이다(REQ-AUTH-004).
- **조직도**(REQ-ORG-003): 부서 트리 + 부서별 인원(이름, 직급, 부서장 여부). 직급은 `sort_order` 순.
- **역할 권한 변경**: 요청 `{ permissions: [{ permission, permissionLevel }] }`을 받아 해당 역할의 행 집합을 통째로 바꾼다(빠진 권한은 행 삭제). 값은 `@IsIn(Object.values(PERMISSION))`, `@IsIn(Object.values(PERMISSION_LEVEL))`로 검증([05] 4장). 한 트랜잭션에서 처리한다.
- 응답은 매퍼로 만든다([05] 6장). 날짜는 인터셉터가 ISO로 바꾼다.

## 5. 오류 코드·작업 로그

| 코드 | 언제 |
| --- | --- |
| COM-003 | 부서·직급·역할·사원 id가 없음 |
| COM-004 | DTO 검증 실패(전역 ValidationPipe) |
| COM-002 | 권한 없음(가드) |
| COM-001 | `employee_no`·`department_code` 중복 → Prisma P2002를 전역 필터가 COM-001로 바꿈 🟡(문구가 "버전 충돌"이라 맞지 않음) |

작업 로그: 없음. REQ-LOG-002와 BUSINESS_EVENT_TYPE([06])에 조직 변경 이벤트가 없다. 새 이벤트를 임의로 만들지 않는다.

## 6. 다른 모듈과의 경계

| 상대 | 관계 | 권장 |
| --- | --- | --- |
| auth(common) | 가드가 `role_permission`·`head_employee_id`·`is_active`를 매 요청 읽음 | 별도 처리 없음 |
| purchasing | 승인권자 = 요청자 부서의 `head_employee_id`. 없으면 `PUR-001` | `OrganizationService.findDepartmentHeadId(tx, departmentId)`를 export하거나 purchasing repository가 직접 조회 |
| notification | 부서 단위 알림은 부서원별 행으로 펼친다([ERD] notification Note) | `findActiveMemberIds(tx, departmentId)` export |
| messenger | 멤버 선택은 조직 정보에서(REQ-MSG-001·ORG-004). `GET employees`는 관리자만 볼 수 있으므로 화면은 `GET departments`(조직도, 전 사용자)를 쓴다 | 조직도 응답에 사원 id를 넣는다 |

다른 모듈에서 쓰려면 `organization.module.ts`에 `exports: [OrganizationService]`를 추가하고, 쓰는 모듈이 `imports: [OrganizationModule]` 한다.

## 7. 테스트

[05] 11장 필수 대상은 아니다. 다음을 권장한다(`npm test -w @fantasteel/server -- organization`, 묶음 DB `fs_common`).

- 부서 순환 지정 거부(A→B→A, 자기 자신).
- 사원 응답에 `passwordHash`가 없음, 저장값은 bcrypt 해시.
- 역할 권한 PUT 후 빠진 권한 행이 삭제되고, 해당 역할 사원의 다음 요청에서 `COM-002`가 남.
- 퇴사 처리 사원의 요청이 `AUTH-002`.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 오류 코드 없음 | 부서 순환, 부서장 지정 오류(퇴사자·없는 사원)용 코드가 9.3에 없다. 임시로 `COM-004`를 쓸지 팀 결정 | [04] 9.3, BP-AUTH-01 예외 처리 |
| 직급 권한 | 직급 등록에 쓸 권한 코드가 없다(EMPLOYEE_MANAGE vs ORG_MANAGE) | [CSV] 직급 등록 비고 |
| 부서장 자격 | 다른 부서 사원·퇴사자를 부서장으로 지정할 수 있는지 정해지지 않았다 | [02] REQ-ORG-002 |
| 부서장 변경·부재·자기 요청 | 승인 경로 TBD. 자동 승인은 하지 않는다 | [04] 2장 구현 제안, 16장 |
| 비밀번호 변경·초기화 | API가 없다. SPEC은 "비밀번호 재설정은 로그인 때 다시 봄" | [CSV], `SPEC.md` 5장 |
| 직급 수정·삭제 | [CSV]에 GET·POST만 있다. 기준정보 삭제 규칙([05] 7-2)은 있으나 API가 없으므로 만들지 않는다 | [CSV], [05] 7-2 |
| 권한표 근거 | SPEC.md 5장은 "역할별 메뉴 (v2)는 보지 않는다"고 했지만 시드(`seed.ts`)와 [06] PERMISSION 기본값은 [권한표]를 따른다. 기준을 하나로 정해야 한다 | `SPEC.md` 5장, `seed.ts` |
