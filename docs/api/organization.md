# organization API

사원·부서·역할(권한 행렬)과 승인권자 결정. 모든 경로는 `/api/v1` 아래, 로그인 필요(`Authorization: Bearer …`).
응답은 `{ success: true, data }` / 실패는 `{ success: false, error: { code, message } }` (`ApiResponse<T>`). 날짜·시각은 ISO 8601 문자열.
아래 타입과 예시는 실제 서버(포트 8801, DB `fs_org`)에 curl로 호출한 응답에서 옮겼다.

## 권한 요약

| API | 필요한 권한 |
|---|---|
| `GET /employees/directory` | 로그인만 (권한 없음) |
| `GET /employees`, `GET /employees/:id` | `EMPLOYEE_MANAGE` VIEW 이상 |
| `POST/PATCH /employees…`, `unlock`, `reset-password` | `EMPLOYEE_MANAGE` USE |
| `GET /departments`, `GET /departments/tree` | 로그인만 (조직도는 누구나, REQ-ORG-003) |
| `POST/PATCH /departments` | `ORG_MANAGE` USE |
| `GET /roles`, `GET /roles/:id/permissions` | `ORG_MANAGE` 또는 `EMPLOYEE_MANAGE` VIEW 이상 |
| `PUT /roles/:id/permissions` | `ORG_MANAGE` USE |

권한이 없으면 `403 COM-002 해당 업무 권한이 없습니다`. 권한 행렬은 요청마다 DB에서 읽으므로 `PUT` 직후부터 바로 적용된다.

## 타입

```ts
type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';   // @fantasteel/shared EMPLOYEE_STATUS

/** GET /employees, GET /employees/:id, POST·PATCH 결과. passwordHash는 어디에도 없다. */
interface EmployeeView {
  id: number;
  employeeNo: string;          // 숫자 7자리, 로그인 ID
  employeeName: string;
  email: string | null;
  departmentId: number;
  departmentName: string;
  roleId: number;
  roleCode: string;            // 'SALES' | 'PURCHASE' | 'PRODUCTION' | 'QUALITY' | 'LOGISTICS' | 'ADMIN'
  roleName: string;
  jobGrade: string;
  employeeStatus: EmployeeStatus;
  failedLoginCount: number;
  lastLoginAt: string | null;
  isDepartmentHead: boolean;   // 어느 부서든 부서장으로 지정돼 있으면 true
  createdAt: string;
  updatedAt: string;
}

/** GET /employees/directory — 로그인한 누구나. ACTIVE 사원만. 메신저 멤버 선택·업무 담당자 지정용. */
interface EmployeeDirectoryEntry {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGrade: string;
  roleCode: string;
  isDepartmentHead: boolean;
}

/** GET /departments, POST·PATCH 결과 (평면 목록, sortOrder·id순) */
interface DepartmentView {
  id: number;
  departmentCode: string;
  departmentName: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeName: string | null;
  sortOrder: number;
  memberCount: number;         // ACTIVE 사원 수 (하위 부서 제외)
  createdAt: string;
  updatedAt: string;
}

/** GET /departments/tree — 조직도. 응답 data는 최상위 부서 배열. */
interface OrgChartNode {
  id: number;
  departmentCode: string;
  departmentName: string;
  sortOrder: number;
  head: { id: number; employeeName: string; jobGrade: string } | null;
  members: OrgChartMember[];   // ACTIVE 사원만. 부서장이 맨 앞, 나머지는 사원번호순
  children: OrgChartNode[];    // sortOrder·id순
}
interface OrgChartMember {
  id: number;
  employeeName: string;
  jobGrade: string;
  roleCode: string;
  isHead: boolean;             // 이 부서의 부서장인지
}

type PermissionLevel = 'USE' | 'VIEW';
interface PermissionEntry { permissionCode: string; permissionLevel: PermissionLevel }  // permissionCode는 shared PERMISSION 값
/** GET /roles (배열), GET /roles/:id/permissions, PUT 결과. 목록에 없는 권한 = 권한 없음. */
interface RoleView { id: number; roleCode: string; roleName: string; permissions: PermissionEntry[] }  // shared PERMISSIONS 표시 순서
```

## 사원

### `GET /employees/directory`
요청 없음. `data: EmployeeDirectoryEntry[]` (부서 id, 사원번호순).
```json
{"success":true,"data":[{"id":1,"employeeNo":"1001001","employeeName":"한소장","departmentId":1,"departmentName":"포항제철소","jobGrade":"소장","roleCode":"ADMIN","isDepartmentHead":true}, …]}
```
토큰이 없으면 `401 AUTH-002`.

### `GET /employees?departmentId=&roleCode=&employeeStatus=&keyword=`
```ts
interface ListEmployeesQuery {
  departmentId?: number;                 // 그 부서 소속만 (하위 부서 미포함)
  roleCode?: 'SALES'|'PURCHASE'|'PRODUCTION'|'QUALITY'|'LOGISTICS'|'ADMIN';
  employeeStatus?: EmployeeStatus;
  keyword?: string;                      // 이름(대소문자 무시) 또는 사원번호에 포함. 한글은 URL 인코딩
}
```
`data: EmployeeView[]` (사원번호순, 페이지 없음). 잘못된 값은 `400 COM-003`.

### `GET /employees/:id` → `data: EmployeeView` (없으면 `404 COM-004`)
```json
{"success":true,"data":{"id":3,"employeeNo":"2104012","employeeName":"김영업","email":"2104012@fantasteel.example","departmentId":2,"departmentName":"영업부","roleId":1,"roleCode":"SALES","roleName":"영업","jobGrade":"대리","employeeStatus":"ACTIVE","failedLoginCount":0,"lastLoginAt":"2026-09-30T11:16:09.505Z","isDepartmentHead":false,"createdAt":"2026-09-30T11:07:39.908Z","updatedAt":"2026-09-30T11:16:09.506Z"}}
```

### `POST /employees` → `201`, `data: EmployeeView`
```ts
interface CreateEmployeeBody {
  employeeNo: string;        // /^\d{7}$/ , 중복 불가
  employeeName: string;      // 1~50자
  departmentId: number;
  roleId: number;
  jobGrade: string;          // 1~20자
  email?: string;            // 이메일 형식
  initialPassword: string;   // 8~72자. 서버가 bcrypt로 저장, 응답·로그에 남지 않음
}
```
실패: 사원번호 중복 `400 COM-003 이미 사용 중인 사원번호입니다` · 없는 부서/역할 `400 COM-003` · 형식 오류(예: `"employeeNo":"12"`) `400 COM-003 사원번호는 숫자 7자리로 입력해 주세요` · 정의되지 않은 필드는 거부(`property passwordHash should not exist`).

### `PATCH /employees/:id` → `data: EmployeeView`
```ts
interface UpdateEmployeeBody {   // 생략 = 변경 없음. email만 null로 비울 수 있다.
  employeeName?: string;
  departmentId?: number;
  roleId?: number;
  jobGrade?: string;
  email?: string | null;
  employeeStatus?: 'ACTIVE' | 'INACTIVE';   // LOCKED는 로그인 실패로만 생김. 지정하면 400
}
```
- 사용 중지·재사용: `INACTIVE`로 바꾸면 로그인 불가(`AUTH-003`)이고 `directory`·조직도에서 빠진다. `ACTIVE`로 되돌리면 `failedLoginCount`가 0이 된다.
- `403 COM-002 본인의 역할과 사용 상태는 변경할 수 없습니다` — 로그인한 본인의 `roleId` 변경·`INACTIVE`.
- `409 COM-005 영업부의 부서장입니다. 부서장을 먼저 바꿔 주세요` — 부서장인 사원을 `INACTIVE`로 바꿀 때.

### `POST /employees/:id/unlock` → `200`, `data: EmployeeView`
`LOCKED → ACTIVE`, `failedLoginCount = 0`. 잠기지 않은 계정은 `409 COM-005 잠긴 계정만 풀 수 있습니다`.

### `POST /employees/:id/reset-password` → `200`, `data: EmployeeView`
```ts
interface ResetPasswordBody { newPassword: string }   // 8~72자
```
관리자가 정한 새 비밀번호로 바꾼다 (서버가 임시 비밀번호를 만들어 돌려주지 않는다). 상태·실패 횟수는 건드리지 않는다.

## 부서

### `GET /departments` → `data: DepartmentView[]`
```json
{"id":2,"departmentCode":"SALES","departmentName":"영업부","parentId":1,"headEmployeeId":2,"headEmployeeName":"오영업","sortOrder":1,"memberCount":3,"createdAt":"2026-09-30T11:07:39.846Z","updatedAt":"2026-09-30T11:07:39.908Z"}
```

### `GET /departments/tree` → `data: OrgChartNode[]`
```json
{"success":true,"data":[{"id":1,"departmentCode":"HQ","departmentName":"포항제철소","sortOrder":0,"head":{"id":1,"employeeName":"한소장","jobGrade":"소장"},"members":[{"id":1,"employeeName":"한소장","jobGrade":"소장","roleCode":"ADMIN","isHead":true}],"children":[{"id":2,"departmentCode":"SALES","departmentName":"영업부", … "members":[{"employeeName":"오영업","isHead":true, …},{"employeeName":"김영업","isHead":false, …}], "children":[]}, …]}]}
```
부서장이 그 부서 소속이 아니면 `head`에는 나오고 `members`에는 없을 수 있다.

### `POST /departments` → `201`, `data: DepartmentView`
```ts
interface CreateDepartmentBody {
  departmentCode: string;          // /^[A-Z0-9][A-Z0-9-]{0,29}$/ , 중복 불가. 만든 뒤 바꿀 수 없다
  departmentName: string;          // 1~50자
  parentId?: number | null;
  headEmployeeId?: number | null;  // ACTIVE 사원만
  sortOrder?: number;              // 기본 0
}
```

### `PATCH /departments/:id` → `data: DepartmentView`
```ts
interface UpdateDepartmentBody {   // 생략 = 변경 없음, null = 비움(상위 부서 없음 / 부서장 없음)
  departmentName?: string;
  parentId?: number | null;
  headEmployeeId?: number | null;
  sortOrder?: number;
}
```
- 순환 금지: 자기 자신이나 자신의 하위 부서를 상위로 지정하면 `400 COM-003 자기 자신이나 하위 부서를 상위 부서로 지정할 수 없습니다`.
- 부서장이 ACTIVE가 아니면 `400 COM-003 사용 중인 사원만 부서장으로 지정할 수 있습니다`, 없는 사원이면 `400 COM-003 존재하지 않는 사원입니다`.
- 부서장이 바뀌면 같은 트랜잭션에서 작업 로그 `MASTER_CHANGED`(대상 `MASTER`, `targetId` = 부서 id, `targetNo` = 부서 코드)를 남긴다. 예: `summary: "영업부 부서장 변경: 오영업 → 김영업"`, `before/after: { departmentId, headEmployeeId, headEmployeeName }`. 생성 시 부서장을 지정한 경우에도 남긴다.

## 역할·권한

### `GET /roles` → `data: RoleView[]`, `GET /roles/:id/permissions` → `data: RoleView`
```json
{"success":true,"data":{"id":1,"roleCode":"SALES","roleName":"영업","permissions":[{"permissionCode":"ORDER_CREATE","permissionLevel":"USE"},{"permissionCode":"ORDER_CANCEL","permissionLevel":"USE"},{"permissionCode":"SHIPMENT_REQUEST","permissionLevel":"USE"},{"permissionCode":"PLAN_CONFIRM","permissionLevel":"VIEW"},{"permissionCode":"GOODS_ISSUE_CONFIRM","permissionLevel":"VIEW"},{"permissionCode":"MILLSHEET_READ","permissionLevel":"USE"},{"permissionCode":"MASTER_MANAGE","permissionLevel":"VIEW"}]}}
```
없는 역할은 `404 COM-004`.

### `PUT /roles/:id/permissions` → `data: RoleView` (저장된 결과)
```ts
interface ReplaceRolePermissionsBody { permissions: PermissionEntry[] }   // 이 역할의 권한 전체. 없는 권한은 없어진다
```
- 검증: 알 수 없는 코드(`400 COM-003 알 수 없는 권한 코드입니다: NOPE`), 수준은 `USE`/`VIEW`, 코드 중복 금지(`권한 코드가 중복되었습니다: …`), 배열 최대 100개.
- 잠금 방지: `ADMIN` 역할은 `EMPLOYEE_MANAGE`·`ORG_MANAGE`를 반드시 `USE`로 유지해야 한다. 빼거나 VIEW로 낮추면 `400 COM-003 관리자 역할에서 부서·권한 관리(ORG_MANAGE) 사용 권한을 뺄 수 없습니다 (아무도 관리할 수 없게 됩니다)`.
- 실제로 바뀐 것이 있을 때만 작업 로그 `MASTER_CHANGED`(대상 `MASTER`, `targetId` = 역할 id, `targetNo` = 역할 코드)를 남긴다. 예: `summary: "영업 역할 권한 변경: 추가 사원 관리(VIEW) · 변경 생산계획·히트 편성 VIEW→USE · 제거 수주 취소(USE)"`, `before/after: { roleId, roleCode, permissions: { [permissionCode]: 'USE'|'VIEW' } }`. 같은 행렬을 다시 보내면 로그 없이 그대로 돌려준다.

## 승인권자 (서버 내부용, HTTP API 아님)

`OrganizationModule`은 `@Global()`이라 imports 없이 주입한다.

```ts
import { ApproverResolver } from '../organization/organization.module';   // 또는 ../organization/approver.resolver

constructor(private readonly approvers: ApproverResolver) {}

const found = await this.approvers.resolveApprover(tx, requesterEmployeeId);
// → { approverId: number; departmentId: number } | null   (null이면 제출 시 PUR-001)
```

규칙 (`approver.resolver.ts`):
1. 요청자 소속 부서의 부서장이 승인권자. 요청자 본인이면 안 된다.
2. 요청자가 그 부서의 부서장이면 상위 부서의 부서장으로 올라간다 (같은 규칙을 한 단계씩 반복. 상위 부서 부서장도 요청자 본인이면 한 단계 더).
3. 부서장이 비어 있거나 사용 중지(`INACTIVE`)이면 `null`. 상위 부서가 없어도(최상위 부서의 부서장 본인) `null`. 부서장이 비어 있다고 해서 위로 건너뛰지 않는다.
4. 잠김(`LOCKED`) 부서장은 승인권자로 인정한다 (계정을 풀면 승인할 수 있다).

`departmentId`는 항상 **요청자 소속 부서**다 (`purchase_requisition.department_id`에 그대로 넣는 값). 상위 부서 부서장이 승인해도 바뀌지 않는다. `tx`는 `PrismaService.tx()` 안의 트랜잭션.

시드 데이터로 실제 실행한 결과: 김영업 → 오영업(dept 2) · 오영업 → 한소장(dept 2) · 한소장 → null · 서구매 → 남구매(dept 3) · 최생산(제강파트 부서장) → 강생산 · 없는 사원 → null.

## 오류 코드
전용 코드는 없고 공통 코드를 쓴다: `COM-002`(권한/본인 변경 금지) · `COM-003`(입력값·규칙 위반) · `COM-004`(대상 없음) · `COM-005`(현재 상태에서 불가) · `AUTH-002`(토큰 없음).
