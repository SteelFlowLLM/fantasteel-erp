// 화면에서 권한 확인: 조회 권한만 있으면 화면은 열리고(RouteGuard), 변경 버튼은 사용 권한이 있을 때만 켠다.
// const canEdit = useCanUse(PERMISSION.MASTER_MANAGE);
// <Button disabled={!canEdit} title={canEdit ? undefined : permissionNeedText([PERMISSION.MASTER_MANAGE])}>…</Button>
import type { Permission } from '@/codes';
import { useMe } from '@/hooks/useMe';
import { canUse, canView, isDepartmentHead } from '@/lib/permissions';

/** 이 중 하나라도 사용(USE) 권한이 있는지 */
export function useCanUse(...anyOf: Permission[]): boolean {
  return canUse(useMe(), ...anyOf);
}

/** 이 중 하나라도 조회(VIEW) 이상 권한이 있는지 */
export function useCanView(...anyOf: Permission[]): boolean {
  return canView(useMe(), ...anyOf);
}

/** 부서장인지 (승인권자, REQ-AUTH-004) */
export function useIsDepartmentHead(): boolean {
  return isDepartmentHead(useMe());
}
