// 역할 × 권한 행렬의 화면 계산. 칸 값: USE 사용 / VIEW 조회 / null 없음(행 없음, PERMISSION_LEVEL).
import {
  PERMISSION_AREAS,
  PERMISSION_AREA,
  PERMISSION_LEVEL,
  PERMISSION_LEVEL_LABEL,
  PERMISSIONS,
  type Permission,
  type PermissionArea,
  type PermissionLevel,
} from '@/codes';

export type MatrixLevel = PermissionLevel | null;
/** 역할 하나의 권한 표 */
export type RoleLevels = Partial<Record<Permission, PermissionLevel>>;
/** 저장 전 변경: 역할 id → 권한 → 바꾼 값 */
export type MatrixDraft = Record<number, Partial<Record<Permission, MatrixLevel>>>;

/** 칸을 누르면 사용 → 조회 → 없음 → 사용 순으로 바뀐다 */
export function nextLevelOf(level: MatrixLevel): MatrixLevel {
  if (level === 'USE') return 'VIEW';
  if (level === 'VIEW') return null;
  return 'USE';
}

export function levelsOf(permissions: readonly { permission: Permission; permissionLevel: PermissionLevel }[]): RoleLevels {
  const levels: RoleLevels = {};
  for (const row of permissions) levels[row.permission] = row.permissionLevel;
  return levels;
}

/** 저장된 값 위에 저장 전 변경을 덮은 값 */
export function effectiveLevelOf(saved: RoleLevels, draft: MatrixDraft[number] | undefined, permission: Permission): MatrixLevel {
  if (draft && permission in draft) return draft[permission] ?? null;
  return saved[permission] ?? null;
}

/** 저장된 값과 실제로 다른 칸만 남긴 변경 (같은 값으로 되돌린 칸은 뺀다) */
export function changedCellsOf(saved: RoleLevels, draft: MatrixDraft[number] | undefined): Permission[] {
  if (!draft) return [];
  return PERMISSIONS.filter((permission) => permission in draft && (draft[permission] ?? null) !== (saved[permission] ?? null));
}

/** 저장할 권한 목록: 없음은 보내지 않는다 (권한이 없으면 행이 없다) */
export function permissionsToSave(saved: RoleLevels, draft: MatrixDraft[number] | undefined): { permission: Permission; permissionLevel: PermissionLevel }[] {
  return PERMISSIONS.flatMap((permission) => {
    const level = effectiveLevelOf(saved, draft, permission);
    return level ? [{ permission, permissionLevel: level }] : [];
  });
}

/** 사용 N · 조회 M */
export function countLevels(levels: RoleLevels): { use: number; view: number } {
  let use = 0;
  let view = 0;
  for (const permission of PERMISSIONS) {
    if (levels[permission] === 'USE') use += 1;
    else if (levels[permission] === 'VIEW') view += 1;
  }
  return { use, view };
}

/** 권한 없음(행 없음)의 화면 글자. 행이 없다는 뜻이라 PERMISSION_LEVEL 코드 값이 아니다. */
export const NO_PERMISSION_LEVEL_LABEL = '없음';

/** 칸 글자: 사용·조회는 PERMISSION_LEVEL_LABEL, 행이 없으면 '없음' */
export function levelLabelOf(level: MatrixLevel): string {
  return level ? PERMISSION_LEVEL_LABEL[level] : NO_PERMISSION_LEVEL_LABEL;
}

/** '사용 N · 조회 M' (표시명은 PERMISSION_LEVEL_LABEL) */
export function levelCountText(counts: { use: number; view: number }): string {
  return `${PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.USE]} ${counts.use} · ${PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.VIEW]} ${counts.view}`;
}

/** 행렬의 행: 영역별로 묶은 권한 (공통 코드 정의서 PERMISSION 표 순서) */
export function permissionRowsByArea(): { area: PermissionArea; permissions: Permission[] }[] {
  return PERMISSION_AREAS.map((area) => ({ area, permissions: PERMISSIONS.filter((permission) => PERMISSION_AREA[permission] === area) }));
}
