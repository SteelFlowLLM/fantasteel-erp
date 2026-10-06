// 사원별 위젯 배치 (SPEC 4장 3번): 이 브라우저의 localStorage에 사원마다 저장한다. 저장값이 없으면 기본 배치.
import { useCallback, useMemo, useState } from 'react';
import type { RoleCode } from '@/codes';
import { buildDefaultPlacements, compactPlacements, isDefaultLayout, readStoredLayout, writeStoredLayout, type WidgetPlacement } from '@/features/dashboard/lib/layout';

export interface DashboardLayoutState {
  placements: WidgetPlacement[];
  /** 기본 배치와 다른 배치를 저장해 두었는지 */
  isCustom: boolean;
  /** 저장 (기본 배치와 같으면 저장값을 지운다). 브라우저가 저장을 막으면 false */
  save: (next: readonly WidgetPlacement[]) => boolean;
}

/** roleCode: 기본 배치는 역할마다 조금 다르다 (볼 권한이 없는 기본 위젯 대신 다른 위젯, layout.ts ROLE_DEFAULT_SWAPS) */
export function useDashboardLayout(employeeId: number, roleCode?: RoleCode): DashboardLayoutState {
  const [owner, setOwner] = useState(employeeId);
  const [stored, setStored] = useState<WidgetPlacement[] | null>(() => readStoredLayout(employeeId));
  // 이 탭의 계정이 바뀌면 그 사원의 배치를 다시 읽는다
  if (owner !== employeeId) {
    setOwner(employeeId);
    setStored(readStoredLayout(employeeId));
  }
  const placements = useMemo(() => stored ?? buildDefaultPlacements(roleCode), [stored, roleCode]);
  const save = useCallback(
    (next: readonly WidgetPlacement[]) => {
      const ok = writeStoredLayout(employeeId, next, undefined, roleCode);
      setStored(isDefaultLayout(next, roleCode) ? null : compactPlacements(next));
      return ok;
    },
    [employeeId, roleCode],
  );
  return { placements, isCustom: stored !== null, save };
}
