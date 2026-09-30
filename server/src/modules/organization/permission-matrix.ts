import { PERMISSION, PERMISSIONS, PERMISSION_LEVEL, ROLE_CODE, type PermissionLevel } from '@fantasteel/shared';
import { badInput } from '../../common/errors/app.exception';

export interface PermissionEntry {
  permissionCode: string;
  permissionLevel: PermissionLevel;
}

/** 관리자 역할에서 빼면 아무도 사원·권한을 고칠 수 없게 되는 권한 */
export const ADMIN_LOCKOUT_GUARD: readonly string[] = [PERMISSION.EMPLOYEE_MANAGE, PERMISSION.ORG_MANAGE];

const KNOWN_CODES = new Set<string>(Object.values(PERMISSION));
const KNOWN_LEVELS = new Set<string>(Object.values(PERMISSION_LEVEL));
const ORDER = new Map(PERMISSIONS.map((p, i) => [p.code as string, i]));

export const permissionLabel = (code: string) => PERMISSIONS.find((p) => p.code === code)?.label ?? code;

/** 권한 행렬을 검증하고 정렬한다. 목록에 없는 권한 = 권한 없음. */
export function normalizePermissionMatrix(roleCode: string, entries: readonly PermissionEntry[]): PermissionEntry[] {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!KNOWN_CODES.has(e.permissionCode)) throw badInput(`알 수 없는 권한 코드입니다: ${e.permissionCode}`);
    if (!KNOWN_LEVELS.has(e.permissionLevel)) throw badInput(`권한 수준은 USE 또는 VIEW여야 합니다: ${e.permissionCode}`);
    if (seen.has(e.permissionCode)) throw badInput(`권한 코드가 중복되었습니다: ${e.permissionCode}`);
    seen.add(e.permissionCode);
  }
  if (roleCode === ROLE_CODE.ADMIN) {
    for (const code of ADMIN_LOCKOUT_GUARD) {
      const level = entries.find((e) => e.permissionCode === code)?.permissionLevel;
      if (level !== PERMISSION_LEVEL.USE) {
        throw badInput(`관리자 역할에서 ${permissionLabel(code)}(${code}) 사용 권한을 뺄 수 없습니다 (아무도 관리할 수 없게 됩니다)`);
      }
    }
  }
  return sortPermissionEntries(entries.map((e) => ({ permissionCode: e.permissionCode, permissionLevel: e.permissionLevel })));
}

/** 화면 표시 순서(shared PERMISSIONS 순서)로 정렬한 사본 */
export function sortPermissionEntries(entries: readonly PermissionEntry[]): PermissionEntry[] {
  return [...entries].sort((a, b) => (ORDER.get(a.permissionCode) ?? 999) - (ORDER.get(b.permissionCode) ?? 999));
}

export interface PermissionDiff {
  added: PermissionEntry[];
  removed: PermissionEntry[];
  changed: { permissionCode: string; from: PermissionLevel; to: PermissionLevel }[];
}

export function diffPermissionMatrix(before: readonly PermissionEntry[], after: readonly PermissionEntry[]): PermissionDiff {
  const b = new Map(before.map((e) => [e.permissionCode, e.permissionLevel]));
  const a = new Map(after.map((e) => [e.permissionCode, e.permissionLevel]));
  const diff: PermissionDiff = { added: [], removed: [], changed: [] };
  for (const [code, level] of a) {
    const prev = b.get(code);
    if (prev === undefined) diff.added.push({ permissionCode: code, permissionLevel: level });
    else if (prev !== level) diff.changed.push({ permissionCode: code, from: prev, to: level });
  }
  for (const [code, level] of b) if (!a.has(code)) diff.removed.push({ permissionCode: code, permissionLevel: level });
  return diff;
}

export const isEmptyDiff = (d: PermissionDiff) => !d.added.length && !d.removed.length && !d.changed.length;

/** 작업 로그 한 줄. 예: "추가 수주 등록(USE) · 변경 발주 VIEW→USE · 제거 입고 확정(VIEW)" */
export function summarizeDiff(d: PermissionDiff): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`추가 ${d.added.map((e) => `${permissionLabel(e.permissionCode)}(${e.permissionLevel})`).join(', ')}`);
  if (d.changed.length) parts.push(`변경 ${d.changed.map((e) => `${permissionLabel(e.permissionCode)} ${e.from}→${e.to}`).join(', ')}`);
  if (d.removed.length) parts.push(`제거 ${d.removed.map((e) => `${permissionLabel(e.permissionCode)}(${e.permissionLevel})`).join(', ')}`);
  return parts.join(' · ');
}
