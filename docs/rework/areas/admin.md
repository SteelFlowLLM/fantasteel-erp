# 관리자 — 사원·부서·직급·권한·조직도 (2단계 관리자 1·2번)

- 2026-10-01, 워크트리 브랜치. 근거: stage2.md "관리자" 1·2번, reports/5 A-3·A-4·A-6·C절, PLAN 7장 관리자, 요구사항 REQ-AUTH-002~004·REQ-ORG-001~004, 업무 프로세스 BP-AUTH-01, 용어 사전 TRM-032~037.
- 기준정보(`/admin/master-data`)는 이 작업 범위가 아니다(다른 영역).

## 1. 화면

### `/admin/employees` 사원 (REQ-AUTH-002·003)
- 왼쪽 목록: 검색(이름·사원번호, 0.25초 뒤 조회), 역할·부서(계층 들여쓰기) 선택, 사용 여부(전체/사용/사용 안 함). 행 = 아바타·이름·역할 꼬리표·부서장 꼬리표·사용 여부 배지, 둘째 줄 '부서 · 직급 · 사원번호 · 최근 접속'. 건수는 필터를 쓰면 'n / 전체'.
- 오른쪽 상세: 이름·역할·사용 여부·부서장·'나', '부서·직급·권한' 이동, '정보 수정', '사용 안 함'(확인 창). 사용 안 함 사원은 안내 띠 + '다시 사용'.
  - 카드 '사원 정보'(사원번호·이름·부서·직급·역할·사용 여부·최근 접속(읽기 전용)·등록일), '역할 권한'(사용·조회·없음 요약 + '행렬에서 보기' → `/admin/organization?tab=permissions&role=코드`), '부서장 지정'.
- 등록·수정 창: 이름, 사원번호(등록만, 수정 때는 읽기 전용), 부서, 직급(선택), 역할 카드 6개 중 1개, 권한 미리보기. 수정은 바뀐 게 없으면 저장이 막힌다.
- 부서장은 역할이 아니라 `department.head_employee_id`에서 계산한 꼬리표(outline)로 보인다.

### `/admin/organization` 부서·직급·권한 (탭 주소 `?tab=departments|job-grades|permissions|org-chart`)
- **부서** (REQ-ORG-001·002): 왼쪽 부서 계층(코드·인원·부서장/부서장 없음), 오른쪽 편집(부서 코드·부서명·상위 부서·부서장·정렬 순서) + 되돌리기·저장·삭제. 상위 부서 목록에서 자기 자신·하위 부서는 막힌다. 부서장 후보 = 그 부서의 사용 중인 사원. '부서 만들기' 창(부서장은 만든 뒤 지정).
- **직급** (새 탭, TRM-036): 표시 순서·직급 코드·직급명·사원 수 표, 추가·수정 창, 삭제(사원이 있으면 막힘).
- **권한** (REQ-AUTH-003): 역할 6 × 권한 17 행렬, 영역(영업→구매→생산→품질→물류→관리)별 묶음. 칸을 누르면 사용 → 조회 → 없음. 저장 전 변경은 주황 칸, 탭에 '변경 N', 역할마다 '취소'·'저장'. 저장하면 이 탭은 조회 무효화로, 다른 탭은 BroadcastChannel로 메뉴·버튼이 바로 바뀐다. 내 역할의 부서·권한 관리 사용 권한이 빠지는 변경이면 빨간 경고 띠.
- **조직도** (REQ-ORG-003): 부서 트리(하위 부서는 들여쓰기) + 사용 중인 인원(이름·직급·부서장 여부). 부서 안 정렬은 직급 표시 순서 → 사원번호. 하위 부서가 있으면 '하위 부서 N개 · 전체 N명'.
- 머리: 탭마다 부제(REQ ID 없음), 사원 화면 이동, 읽기 전용 표시.

### 권한·읽기 전용
- 화면 열기는 기존 `screens.ts`(사원 = EMPLOYEE_MANAGE 조회 이상, 부서·직급·권한 = ORG_MANAGE 조회 이상)를 그대로 쓴다.
- 사용 권한이 없으면 모든 변경 버튼·입력칸이 막히고 툴팁·`ReadOnlyHint`에 "사원 관리 사용 권한이 필요해요" / "부서·권한 관리 사용 권한이 필요해요". API도 `requireActor`로 다시 확인한다(COM-002). 시드에서는 관리자만 이 권한을 가지므로, 행렬에서 다른 역할에 조회를 주면 읽기 전용 화면을 볼 수 있다.

## 2. 보고서 C절 반영
- '사용자' → '사원'(C-2), 직급 엔티티·관리 탭(C-1 AUTH-002), 권한 17개(C-3), 조직도 정렬 = 직급 표시 순서(C-1 ORG-003), 조직도에서 역할 표시 제거(C-4 #10).
- 없앤 것(PLAN 5장): 잠김·잠금 해제·실패 횟수, 비밀번호 재설정·초기 비밀번호, 이메일, 사원 상태 3값(EMPLOYEE_STATUS) → is_active만, 권한 칸 '기본값과 다름' 표시(C-4 #11), "부서장이 직접 올린 요청은 상위 부서장이 승인" 같은 미결정 규칙 문구(C-4 #8), '바꾸면 작업 로그에 남아요'(C-4 #9).
- 결함 수정: 권한이 없으면 부서 편집의 상위 부서·부서장 선택도 막힌다(결함 #3). 사원 창은 권한이 없으면 아예 열리지 않는다(결함 #4).

## 3. API (`client/src/api/`)
| 함수 | 권한 | 검증·오류 |
|---|---|---|
| `employeeAdminApi.create` | EMPLOYEE_MANAGE 사용 | 사원번호 필수·숫자 7자리·중복, 이름 1~50자, 부서·직급·역할 필수(입력 오류) → 없는 id는 COM-003 |
| `employeeAdminApi.update` | 〃 | 위 + COM-001(연 뒤 바뀜), 없는 사원 COM-003, 부서장인 사원을 다른 부서로 옮기면 입력 오류 |
| `employeeAdminApi.deactivate` / `activate` | 〃 | COM-001·COM-003, 부서장인 사원은 사용 안 함 불가(입력 오류) |
| `departmentAdminApi.create` / `update` / `remove` | ORG_MANAGE 사용 | 부서 코드 필수·형식·중복, 부서명 1~50자, 정렬 순서 0 이상 정수, 순환 금지, 부서장 = 그 부서의 사용 중인 사원, 없는 상위 부서·사원 COM-003, COM-001. 삭제는 소속 사원·하위 부서·구매요청·부서 알림이 있으면 거부 |
| `jobGradeAdminApi.create` / `update` / `remove` | ORG_MANAGE 사용 | 직급 코드 필수·형식·중복, 직급명 1~30자, 표시 순서 0 이상 정수, COM-001·COM-003, 사원이 있으면 삭제 거부 |
| `roleAdminApi.replacePermissions` | ORG_MANAGE 사용 | 없는 역할 COM-003, 옛 화면 값이면 COM-001(역할 `updated_at`을 저장 때 갱신), 잘못된 코드·중복은 입력 오류. 보내지 않은 권한은 행 삭제(= 없음) |
| `adminOrgApi.getOrgChart` (`adminOrgKeys.orgChart`) | — | 조회 |

- 9.3에 없는 거부(필수·형식·중복·순환·참조 중 삭제)는 `InputError`(입력칸 안내), 권한 COM-002, 참조 없음 COM-003, 동시 수정 COM-001.
- 순수 함수: `features/admin/lib/orgRules.ts`(형식 규칙, 하위 부서·순환 판정, 인원 합계, 부서 목록 들여쓰기), `features/admin/lib/permissionMatrix.ts`(칸 순환, 저장 전 변경 계산, 저장 목록, 영역별 행).
- 훅: 목록은 기존 `hooks/useDirectory.ts`, 조직도는 `hooks/useAdminOrganization.ts`(`useAdminOrgChart`). 변경은 `useAction`.
- 테스트: `api/adminEmployees.test.ts` 13개, `api/adminOrganization.test.ts` 13개, `features/admin/lib/admin.test.ts` 10개 (전체 113개 통과) (actAs로 권한별 정상·오류 코드 확인). (2026-10-08: 조직 관리 api의 가짜 DB 분기를 지우며 `adminOrganization.test.ts`·`adminEmployees.test.ts` 삭제, 직급 코드 규칙도 삭제)
- 작업 로그: 조직 변경에 맞는 BUSINESS_EVENT_TYPE이 29개 안에 없어 남기지 않는다(cross-cutting 7장). 알림도 보내지 않는다.

## 4. 시드
- 새 시드 없음(1단계 조직 시드 그대로). 시드 등록부 변경 없음. `MOCK_DB_VERSION` 그대로.

## 5. 가정값
| 무엇 | 값 | 이유·출처 |
|---|---|---|
| 사원번호 형식 | 숫자 7자리 | 옛 화면 규칙, seed-assumptions 1-4. ERD는 varchar(20)만 |
| 부서 코드 형식 | `^[A-Z0-9][A-Z0-9-]{0,29}$` | 옛 화면 규칙, ERD varchar(30) |
| 직급 코드 형식 | `^[A-Z][A-Z0-9_]{0,29}$` (예 MANAGER) | 시드 직급 코드 모양(대문자 스네이크), ERD varchar(30) |
| 직급 관리 권한 | ORG_MANAGE 사용 | 직급 탭이 부서·직급·권한 화면에 있어서. 문서는 "관리자가 등록·수정"(TRM-036)만 |
| 부서장 범위 | 그 부서의 사용 중인 사원 1명 | stage2 지시. 그래서 부서장인 사원은 다른 부서 이동·사용 안 함 전에 부서장을 먼저 바꿔야 한다 |
| 부서 코드 수정 | 수정 가능(중복만 막음) | stage2 지시의 편집 칸 목록에 department_code가 있음. 참조는 id라 영향 없음 |
| 사용 여부 표시 | '사용' / '사용 안 함' | is_active. 옛 '사용 중지'와 기준정보 '사용 안 함'이 섞여 있던 것을 하나로(C-2) |

## 6. 공유 파일 변경
- `client/src/api/directory.ts` (허용된 추가만): `JobGradeView.updatedAt`, `RoleView.updatedAt` 필드와 매핑 두 줄. 직급 수정·역할 권한 저장의 COM-001 확인에 쓴다.
- `screens.ts`·`routeTitles.ts`·`queryKeys.ts`·시드·코드 파일은 바꾸지 않았다.

## 7. 확인 필요 (사용자)
1. 옛 화면의 사원 보호 규칙(내 역할 변경 금지·나를 사용 안 함 금지·관리자 역할은 사원/부서·권한 관리 사용 유지)은 문서에 없어 막지 않고 **경고만** 보인다(사용 안 함 확인 창, 내 역할 변경 띠, 내 부서·권한 관리 권한이 빠지는 행렬 띠). 막아야 하면 알려 주세요. 막지 않으면 시연 중 관리 권한을 모두 잃을 수 있고, 그때는 '시드로 초기화'로 되돌린다.
2. 조직도는 지금 ORG_MANAGE 조회 이상만 연다(화면 접근표 그대로). 옛 화면은 "누구나 볼 수 있어요"였다. 모든 사원에게 열지 결정이 필요하다(screens.ts 변경 필요).
3. 직급을 ORG_MANAGE로 관리하는 것(5장 가정값)이 맞는지.

## 8. 알려진 빈틈
- 브라우저 확인(next dev·build)은 병렬 규칙상 하지 않았다. typecheck·Vitest만 돌렸다. 합치는 단계에서 화면을 눌러 확인이 필요하다.
- 사원 목록의 선택은 주소에 남기지 않는다(새로 고치면 첫 사원). 다른 화면에서 특정 사원으로 바로 여는 링크는 없다.
- 부서 삭제 거부 사유 중 구매요청·부서 알림 참조는 저장할 때 API에서만 알 수 있다(화면 버튼은 소속 사원·하위 부서만 보고 막는다).

## 9. 검토 반영
| 지적 | 근거 | 고친 내용 |
|---|---|---|
| 사원 수정 창이 COM-001을 못 냄 (다른 탭 저장 뒤 옛 값으로 덮어씀) | 04 9.3 COM-001 · cross-cutting.md "수정 폼은 연 시점의 updatedAt" · 3장 `employeeAdminApi.update` | `features/admin/lib/employeeForm.ts` `openEmployeeForm`으로 창을 연 시점의 값·updatedAt을 `useState` 초기값으로 한 번만 잡는다. 저장은 그 updatedAt을 보내고, 바뀐 칸 비교(`isEmployeeFormDirty`)와 '내 역할' 띠도 연 시점 값과 비교한다. 목록이 새로 불러와져도 바뀌지 않아 다른 탭 저장 뒤에는 COM-001이 난다 |
| 역할 칸을 `<label>`(Field)로 감싸 label·도움말 클릭이 첫 역할(영업) 버튼을 누름 | 03 TRM-037 · common.md 접근성 | 역할 묶음을 `<fieldset>` + `<legend>역할 *</legend>`로 바꿨다. 도움말·오류는 `aria-describedby`로 묶고, radiogroup에 `aria-required`·`aria-invalid`. 공유 `components/Field.tsx`는 바꾸지 않았다 |
| 권한 수준 표시명(사용·조회)을 화면에서 다시 정의 | 05 4장 [강제] · 보고서 5 C-3 PERMISSION_LEVEL · C-6 #6 | `permissionMatrix.ts`에 `levelLabelOf`(사용·조회 = `PERMISSION_LEVEL_LABEL`, 행 없음 = `NO_PERMISSION_LEVEL_LABEL` '없음')와 `levelCountText`('사용 N · 조회 M')를 두고, 권한 행렬 칸·제목 줄·범례·저장 전 title, 역할 요약(`RolePermissionSummary`) 줄 이름, 사원 창 역할 카드 개수 줄이 모두 이것을 쓴다. 화면에는 칸 색만 남겼다. 'USE'/'VIEW' 글자 비교도 `PERMISSION_LEVEL` 상수로 바꿨다 |

- 테스트: `features/admin/lib/employeeForm.test.ts`(연 시점 값 고정·바뀐 칸 비교·표시명), `api/adminEmployees.test.ts`에 "창을 연 뒤 다른 탭이 저장 → 연 시점 값으로 저장하면 COM-001, 다른 탭 값 유지" 추가.
- 같은 모양을 다른 관리 화면에서도 확인했다: 직급 수정 창은 누른 시점의 행을 상태로 들고 있어 문제없고, 부서 상세는 `key`에 updatedAt이 있어 새 값으로 다시 열린다(덮어쓰기 없음).
- 공유 파일 변경 없음.
