# auth — 로그인·로그아웃·내 정보

> 근거 약어: [02] 요구사항 정의서 · [04] 업무 프로세스 정의서 · [05] 코드 컨벤션 · [06] 공통 코드 정의서 · [ERD] `docs/erd/fantasteel_erp_p1.dbml` · [CSV] API 목록(`docs/notion/api-spec/API 목록 …csv`) · [권한표] 역할별 메뉴 (v2) 3장. 🟡 = 확인 필요.
> 경로는 컨트롤러에 쓰는 모양이다. 전역 prefix `/api/v1`은 `main.ts`가 붙이므로 컨트롤러에는 쓰지 않는다([05] 5장 [강제]).

**상태: 구현 완료.** `server/src/modules/auth/`(API)와 `server/src/common/auth/`(가드·데코레이터·토큰·부서장 확인)에 있다. 이 문서는 다른 모듈이 인증을 쓰는 방법과 남은 확인 사항을 정리한다.

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| REQ | REQ-AUTH-001(로그인·로그아웃). 역할별 권한 확인(REQ-AUTH-003)과 부서장 판단(REQ-AUTH-004)의 기반 코드도 `common/auth`에 있다 |
| BP | BP-AUTH-01 로그인·조직·권한([04] 6장). 조직·권한 데이터 관리는 organization 모듈 |
| 등급 | P1 |

## 2. 테이블

| 구분 | 테이블 | 쓰는 컬럼 |
| --- | --- | --- |
| 읽기 | `employee` | `employee_no`(로그인 ID, unique), `password_hash`(bcrypt), `is_active`, `department_id`, `job_grade_id`, `role_id` |
| 읽기 | `role`, `role_permission` | `role_code`, `(role_id, permission)` unique, `permission_level`(USE·VIEW). 권한이 없으면 행이 없다([ERD]) |
| 읽기 | `department` | `head_employee_id` → `AuthUser.headDepartmentIds`(이 사원이 부서장인 부서) |
| 쓰기 | 없음 | |

- `password_hash`는 응답·로그에 내보내지 않는다([ERD] employee Note). 응답 인터셉터(`common/http/response.interceptor.ts`)도 `passwordHash` 키를 지운다.

## 3. API

| Method | Path | 이름 | 권한 | 비고 ([CSV]) |
| --- | --- | --- | --- | --- |
| POST | `auth/login` | 로그인 | `@Public()` | 12.2 명시. 비활성 계정·인증 실패 차단, bcrypt |
| POST | `auth/logout` | 로그아웃 | 로그인만 | 쿠키 삭제 |
| GET | `auth/me` | 내 정보·권한 조회 | 로그인만 | `AuthUser` 반환 |

구현된 동작:

- 로그인 요청 `{ employeeNo, password }` → 성공하면 JWT를 httpOnly 쿠키 `access_token`(Secure, SameSite=Lax, path `/`)으로 내려주고, 본문에는 `AuthUser`만 준다(토큰은 본문에 없음, [05] 6·9장).
- 없는 사원번호·틀린 비밀번호·퇴사(`is_active = false`)는 모두 같은 `AUTH-001`로 답한다(계정 존재 여부를 알려 주지 않음).
- 토큰 서명: `JWT_SECRET`, 만료 `JWT_EXPIRES_IN`(기본 `12h`). 만료·갱신 정책은 NFR 결정 전 임시값([05] 6장).

## 4. 다른 모듈이 쓰는 방법

| 무엇 | 위치 | 사용법 |
| --- | --- | --- |
| 전역 인증 가드 | `common/auth/auth.guard.ts` | `app.module.ts`에 `APP_GUARD`로 등록됨. 모든 API는 기본으로 로그인 필요. 매 요청마다 사원·역할 권한·부서장 부서를 DB에서 다시 읽는다 → 권한 변경·퇴사가 다음 요청부터 바로 반영 |
| 기능 권한 | `@RequirePermission(PERMISSION.X, 'USE' \| 'VIEW')` | 변경 API는 `'USE'`, 조회 API는 `'VIEW'`(VIEW·USE 모두 통과). 권한이 없으면 `COM-002` |
| 로그인 사원 | `@CurrentUser() user: AuthUser` | 클라이언트가 보낸 사원 id·역할값은 쓰지 않는다([04] 2장 구현 제안) |
| 조건부 권한 | `hasPermission(user, { permission, level })` (`auth.guard.ts` export) | 배정처럼 목적에 따라 필요한 권한이 다를 때 service에서 직접 확인 |
| 부서장 확인 | `assertDepartmentHead(user, requesterDepartmentId)` (`common/auth/department-head.ts`) | 구매요청 승인·반려 전용. 아니면 `COM-002` |
| 공개 API | `@Public()` | 로그인에만 쓴다 |
| WebSocket 인증 | `AuthTokenService.verifyCookieHeader(cookieHeader)` + `AuthUserService.load(id)` | messenger Gateway handshake에서 쓴다([05] 6장) |

```ts
@Post('sales-orders')
@RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'USE')
create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
  return this.service.create(dto, user);
}
```

## 5. 오류 코드·작업 로그

| 코드 | 언제 | 출처 |
| --- | --- | --- |
| AUTH-001 (401) | 로그인 실패 | `shared/src/errors.ts` 🟡(9.3에 없음) |
| AUTH-002 (401) | 쿠키 없음·토큰 무효·퇴사 | 〃 🟡 |
| COM-002 (403) | 기능 권한 없음 | [04] 9.3 |
| COM-004 (400) | DTO 검증 실패 | `shared/src/errors.ts` 🟡 |

작업 로그: 없음. [02] REQ-LOG-002 기록 대상에 로그인·로그아웃이 없다.

## 6. 다른 모듈과의 경계

- organization 모듈이 `role_permission`·`department.head_employee_id`·`employee.is_active`를 바꾸면 가드가 다음 요청부터 반영한다. 별도 캐시 무효화가 필요 없다.
- `AuthUser` 타입은 `shared/src/api.ts`에 있어 프론트도 같은 모양을 쓴다.

## 7. 테스트

- 이미 있는 단위 테스트: `server/src/common/auth/auth.spec.ts`(권한 수준 비교, 부서장 확인, 쿠키 읽기). `npm run test:unit -w @fantasteel/server`.
- [05] 11장 필수 대상은 아니다. 로그인 API를 바꾸면 성공·실패·퇴사 계정 3가지를 DB 테스트(`npm test -w @fantasteel/server -- auth`)로 확인한다.
- 시드 계정: 15명, 비밀번호 `fantasteel`(`SEED_PASSWORD`로 변경 가능). 예: 관리자 1503001, 영업 2103003, 영업부장 1608002, 구매 2207005, 구매부장 1702004.

## 8. 확인 필요 🟡

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 오류 코드 | AUTH-001·AUTH-002·COM-004·COM-999는 [04] 9.3에 없다. 팀 확인 후 9.3에 올려야 한다 | `shared/src/errors.ts` 주석 |
| 토큰 만료·갱신·실패 제한 | NFR 미정. 지금은 12시간 고정, 갱신 없음, 로그인 실패 횟수 제한 없음 | [02] 19장, [04] BP-AUTH-01 예외 처리, [05] 6장 |
| 로그아웃 | 쿠키만 지운다. 토큰 자체는 만료 전까지 유효하다(ERD에 토큰 차단 테이블 없음) | [ERD], `auth.controller.ts` |
| SPEC과의 관계 | SPEC.md 5장은 "로그인은 나중에, 지금은 계정 선택 화면"이라고 적었다(화면 재작업 기준). 서버 로그인은 이미 구현돼 있으므로 프론트 연결 시점은 팀이 정한다 | `SPEC.md` 5장 |
