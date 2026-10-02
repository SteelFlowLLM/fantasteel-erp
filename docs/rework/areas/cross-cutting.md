# 화면 공통 — 권한 확인·화면 접근 제한·레일 조회 메뉴 (2단계 0번)

- 2026-10-01, 브랜치 `feature/screen-rework`. 근거: stage2.md "0. Cross-cutting", 업무 프로세스 BP-AUTH-01("각 API에서 권한 재확인"), 요구사항 REQ-AUTH-003·004, 컨벤션 5장·6장·7-2·9장, 9.3 에러 코드.
- 다른 영역(조직·기준정보·검사 기준·업무·알림·메신저와 이후 단계)은 아래 도우미를 그대로 쓴다. 새로 만들지 않는다.

## 1. 변경 함수의 권한 확인 — `client/src/api/actor.ts`

모든 변경 함수는 트랜잭션 안에서 맨 먼저 요청 사원을 확인한다(실제 서버가 JWT로 사원을 읽는 자리).

```ts
import { requireActor, requireDepartmentHead } from '@/api/actor';

create: (input: CustomerInput) =>
  mockMutation((tx) => {
    const actor = requireActor(tx.tables, { use: [PERMISSION.MASTER_MANAGE] }); // USE 없으면 COM-002
    // … 검증 → 저장 (actor.employee.id = 요청한 사원)
  }),
```

- `requireActor(tables, { use?: Permission[], view?: Permission[] })` → `{ employee, permissions, headDepartmentIds }`
  - 계정 선택이 없거나, 없는 사원이거나, 사용 안 함(`is_active = false`)이면 `ApiError('COM-002')`.
  - `use`: 하나라도 USE가 있어야 한다. `view`: 하나라도 VIEW 이상이어야 한다(조회 API를 막을 때). 없으면 `ApiError('COM-002', '기준정보 관리 사용 권한이 필요해요')`.
  - 규칙 없이 `requireActor(tx.tables)`만 부르면 "로그인한 사용 중 사원"만 확인한다(업무·메신저처럼 권한 코드가 없는 기능).
- `requireDepartmentHead(tables)` — 부서장이 아니면 COM-002 (구매요청 승인 등, REQ-AUTH-004).
- 요청 사원은 이 탭의 계정 선택(`lib/sessionEmployee.ts`의 sessionStorage 키)에서 읽는다. 테스트에서는 `setActingEmployeeForTest(id)`(아래 6장 `actAs`)로 바꾼다.
- 권한이 없어 던진 오류는 `mockMutation`의 트랜잭션을 통째로 취소한다(아무것도 저장되지 않음).

## 2. 오류 — `client/src/api/client.ts`, `client/src/api/validation.ts`

| 쓰임 | 던질 것 | 화면에 보이는 모양 |
|---|---|---|
| 9.3 에러 코드가 있는 거부 | `new ApiError('MST-002')`, 대상을 덧붙이려면 `new ApiError('COM-003', '부서 12')` | `message`는 늘 9.3 문구 그대로, 덧붙임은 `detail`. 토스트: "참조 대상이 없습니다 · 부서 12 (COM-003)" |
| 9.3 코드가 없는 입력 확인(필수·형식·길이·중복·참조 중 삭제·순환 등) | `new InputError(요약, { 입력칸: 안내 })` 또는 `FieldErrors`로 모아서 `throwIfAny()` | 입력칸 아래 안내(`error.fieldErrors`), 토스트에는 요약 |

- `InputError`는 실제 서버의 요청 검증(ValidationPipe, 400)·서비스 규칙 거부(409)에 해당한다. 9.3에 없는 코드를 새로 만들지 않으려고 코드 없이 둔다. (9.3에 "중복"·"참조 중 삭제 거부" 코드를 넣을지는 사용자 확인 필요)
- `api/validation.ts`
  - `requireRow(tables, 'department', id, '부서')` — 요청으로 받은 id가 없으면 `COM-003` (컨벤션 7-2)
  - `assertUnchanged(row.updatedAt, input.expectedUpdatedAt, '부서')` — 화면을 연 뒤 다른 탭에서 바뀌었으면 `COM-001`(검토 이후 데이터 변경). 수정 폼은 연 시점의 `updatedAt`을 함께 보낸다.
  - `requiredText` · `optionalText`(길이 = ERD varchar), `decimalText`(ERD decimal(p,s)의 자리수, `positive`·`allowNegative`·`max`), `nonNegativeInteger`, `optionalDate`
  - 안내 문구의 조사는 `lib/josa.ts`(`withEulReul`·`withEunNeun`·`withIGa`·`withGwaWa`)로 받침에 맞춘다.
- 토스트 문구는 `stores/useToastStore.ts`의 `errorMessageOf`가 만든다(`useAction`이 자동으로 띄움). `QueryBoundary`는 COM-002면 잠금 모양으로 보인다.

## 3. 화면 접근 — `client/src/features/shell/screens.ts`, `RouteGuard.tsx`

- 모든 (main) 화면의 여는 조건은 `SCREEN` 표 한 곳에 있다. 레일 메뉴와 화면 잠금이 같은 표를 쓴다. **페이지 파일에서 따로 선언하지 않는다.**
  - `view(...)` = 조회 이상이면 열림(사용 권한이 없으면 읽기 전용) · `use(...)` = 사용 권한이 있어야 열림(수주 등록·출하요청 등록) · `departmentHead` = 승인함 · `everyone` = 대시보드·LOT 추적·작업 로그·업무·알림·메신저·재고·준비 중 화면
  - 새 화면을 만들거나 여는 조건을 바꿀 때는 `SCREEN`에 항목을 넣고(`area`를 주면 레일의 다른 영역 묶음에 들어간다), `routeTitles.ts`에 제목을 둔다.
- `RouteGuard`(셸 `AppFrame` 안)가 주소에 맞는 화면을 찾아, 열 수 없으면 화면 대신 잠금 상태(`COM-002 해당 업무 권한 없음` + 필요한 권한)를 보인다.
- 화면 안 읽기 전용 처리(`hooks/usePermission.ts`, `components/ReadOnlyHint.tsx`, `lib/permissions.ts`)
  ```tsx
  const canEdit = useCanUse(PERMISSION.MASTER_MANAGE);
  {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.MASTER_MANAGE]} />}
  <Button disabled={!canEdit} title={canEdit ? undefined : permissionNeedText([PERMISSION.MASTER_MANAGE])}>추가</Button>
  ```
  - 변경 버튼은 숨기거나 막고, 막을 때는 툴팁에 `permissionNeedText`("기준정보 관리 사용 권한이 필요해요")를 쓴다. API 쪽 COM-002 덧붙임과 같은 문구다.
  - `useCanView(...)`, `useIsDepartmentHead()`도 있다.

## 4. 레일 — `client/src/features/shell/navigation.ts`

순서: 대시보드 → 역할의 업무 메뉴(1단계와 같음, 열 수 있는 것만) → 승인함(부서장) → **구분선 + 조회·사용 권한으로 여는 다른 영역 화면(영업 → 구매 → 생산 → 품질 → 물류 → 관리, 재고는 끝)** → 구분선 + 공통 → 구분선 + 준비 중. 권한 행렬을 저장하면 세션 조회가 무효화되어 이 탭과 다른 탭(BroadcastChannel)의 메뉴·버튼이 바로 바뀐다. 레일은 길어지면 세로로 스크롤된다. 예시 표는 `seed-assumptions.md` 2-2.

## 5. 첨부 파일 가짜 저장소 — `client/src/mock/fileStorage.ts` (메신저 영역용)

- `message.file_path`에는 저장소 경로(예: `chat/{방}/{메시지}/{파일명}`)만 두고, 내용(data URL)은 `putMockFile(path, dataUrl)`로 따로 둔다. 꺼낼 때는 `getMockFile(path, SEED_FILES)`(시드 첨부 내용은 코드의 표를 넘긴다).
- `MOCK_FILE_MAX_BYTES` = 512KB(가정값, seed-assumptions 4장). 저장 공간이 모자라면 `MockFileStorageFullError` → API에서 `InputError`로 바꿔 알린다.
- 시드로 초기화(`mockDataApi.resetToSeed`)하면 `clearMockFiles()`로 지운다.

## 6. 테스트 — `client/vitest.config.ts` → `client/src/test/setup.ts`, `client/src/test/actors.ts`

- 모든 테스트 전에: 응답 지연 0(`setMockLatencyForTest(0)`), 가짜 DB를 시드로 되돌림(`resetToSeed()`), 첨부 저장소 비움, 요청 사원 초기화. api 함수를 그대로 `await`해서 시험한다.
- `actAs(SEED_EMPLOYEE_NO.admin)` — 그 사원으로 요청(시드 사원번호 상수: admin·salesHead·sales·purchaseHead·purchase·productionHead·steelmakingHead·steelmaking·qualityHead·quality·logisticsHead·logistics). `employeeIdOf(no)`, `departmentIdOf(code)`도 있다.
- 오류 확인 예: `await expect(customerApi.create(input)).rejects.toMatchObject({ code: 'COM-002' })`, 입력 오류는 `rejects.toBeInstanceOf(InputError)` + `fieldErrors`. 예시는 `api/actor.test.ts`, `api/validation.test.ts`.

## 7. 영역 작업자가 알아 둘 것

- **작업 로그**: 2단계의 변경(조직·기준정보·검사 기준·업무·알림·메신저)에 맞는 BUSINESS_EVENT_TYPE이 29개 안에 없다. 코드를 새로 만들 수 없으므로 작업 로그를 남기지 않는다(각 영역 메모에 적는다).
- **시드를 바꾸는 영역**은 `mock/store.ts`의 `MOCK_DB_VERSION`을 `2`로 올린다(여러 영역이 올려도 같은 값 2. 옛 브라우저 데이터를 버리고 새 시드로 만들기 위함). 이 커밋에서는 1 그대로 두었다.
- **제선 계획 수율**(stage2.md 0번 마지막 항목)은 이 커밋에서 하지 않았다. 기준정보 영역이 준비 상태 띠·라우팅 탭에서 처리한다: 4.4는 제선 수율을 쓰지 않으므로(원료 → 용선은 용선 t당 원단위) 누락으로 표시하지 않고 "—"와 "계산에 쓰지 않음" 안내로 보인다. 필수 수율은 제강·연주(열연 = 매핑 계산값). 사용자 확인이 필요한 결정으로 적는다.
- 세션 키(`fantasteel.session.employee-id`)는 `lib/sessionEmployee.ts` 한 곳에만 둔다(`useSessionStore`와 `api/actor.ts`가 함께 씀).
- 조직 조회 도우미(`api/orgViews.ts`)에 `descendantDepartmentIds`(하위 부서 전체)와 `compareByJobGrade`(조직도 인원 정렬: 직급 표시 순서 → 사원번호)를 더해 두었다. 조직 영역에서 쓴다.

## 8. 확인

- `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 77개 통과(새 테스트: 권한 확인 7, 입력 확인 4, 조사 2, 첨부 저장소 1, 레일·화면 잠금 갱신), `npm run build -w @fantasteel/client` 성공.

## 9. 병렬 작업용 뼈대 (메인 세션이 추가)

- **오류 클래스 위치:** `ApiError`·`InputError`·`FieldErrors`는 `client/src/api/errors.ts`에 있다. `@/api/client`에서도 그대로 다시 내보낸다. 가짜 서버 서비스(`client/src/mock/services/**`)는 순환 참조를 피하려고 반드시 `@/api/errors`에서 가져온다.
- **알림 만들기:** `client/src/mock/services/notifications.ts`의 `createNotifications(tx, { notificationType, title, body?, linkPath?, recipientEmployeeIds?, departmentId?, businessEventId?, excludeEmployeeIds? })` 하나만 쓴다.
  - 개인 발송과 부서 발송을 모두 받는다. 부서 발송은 그 부서의 사용 중 사원 수만큼 행을 만든다.
  - 같은 작업 로그·받는 사람 조합은 한 번만 만든다.
- **거래·협업 시드 등록부:** `client/src/mock/seeds/index.ts`의 `AREA_SEEDERS`에 영역별 `seed<영역>(tx)`를 순서대로 등록한다.
  - 날짜를 바꿀 때는 `seedTxAt(tx, iso)`를 쓴다.
  - `createSeedTables()`가 기준정보 시드를 만든 뒤 `runAreaSeeders(tx)`로 실행한다.
- **조회 무효화:** `useAction`은 변경이 성공하면 모든 조회를 무효화한다. 한 번의 변경이 수주·재고·LOT·알림 배지 같은 여러 화면에 걸치기 때문이다. `invalidate` 옵션은 먼저 다시 불러올 키로만 쓰인다.
