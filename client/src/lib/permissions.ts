// 권한 확인. USE = 입력·변경·확정, VIEW = 보기만. 권한이 없으면 값이 없다 (PERMISSION_LEVEL).
// 승인은 권한 코드가 아니라 요청자 소속 부서의 부서장인지로 판단한다 (REQ-AUTH-004).
import type { Permission, PermissionLevel } from '@/codes';

export type PermissionMap = Partial<Record<Permission, PermissionLevel>>;

interface WithPermissions {
  permissions: PermissionMap;
}

/** 하나라도 사용(USE) 권한이 있는지. 변경 버튼을 켤 때 쓴다. */
export function canUse(user: WithPermissions, ...anyOf: Permission[]): boolean {
  return anyOf.some((permission) => user.permissions[permission] === 'USE');
}

/** 하나라도 조회(VIEW) 이상 권한이 있는지. 메뉴·화면 접근에 쓴다. */
export function canView(user: WithPermissions, ...anyOf: Permission[]): boolean {
  return anyOf.some((permission) => user.permissions[permission] !== undefined);
}

export function isDepartmentHead(user: { headDepartmentIds: readonly number[] }): boolean {
  return user.headDepartmentIds.length > 0;
}
