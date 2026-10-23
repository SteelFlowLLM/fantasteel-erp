// 화면에서 권한 확인: 조회 권한만 있으면 화면은 열리고(RouteGuard), 변경 버튼은 사용 권한이 있을 때만 켠다.
// const canEdit = useCanUse(PERMISSION.MASTER_MANAGE);
// <Button disabled={!canEdit} title={canEdit ? undefined : permissionNeedText([PERMISSION.MASTER_MANAGE])}>…</Button>
import type { Permission } from '@/codes';
import { canOpenHref } from '@/features/shell/screens';
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

/**
 * 주소를 받아 그 화면을 열 수 있는지 알려 주는 함수. 열 수 없는 화면으로 가는 링크·버튼은 보이지 않게 한다
 * (잠금 화면으로 보내지 않는다, 역할별 메뉴 v2 3장 2026-10-15 결정)
 */
export function useCanOpenHref(): (href: string) => boolean {
  const me = useMe();
  return (href) => canOpenHref(me, href);
}

/** 부서장인지 (승인권자, REQ-AUTH-004) */
export function useIsDepartmentHead(): boolean {
  return isDepartmentHead(useMe());
}
