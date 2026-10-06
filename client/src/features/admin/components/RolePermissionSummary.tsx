// 역할 권한 요약: 사용 권한 · 조회 권한 · 권한 없음 (PERMISSION_LEVEL)
import { PERMISSION_LABEL, PERMISSION_LEVEL, PERMISSION_LEVEL_LABEL, PERMISSIONS, type Permission, type PermissionLevel } from '@/codes';
import { Icon } from '@/components/Icon';

export function RolePermissionSummary({ permissions }: { permissions: readonly { permission: Permission; permissionLevel: PermissionLevel }[] }) {
  const use = permissions.filter((p) => p.permissionLevel === PERMISSION_LEVEL.USE).map((p) => p.permission);
  const view = permissions.filter((p) => p.permissionLevel === PERMISSION_LEVEL.VIEW).map((p) => p.permission);
  const none = PERMISSIONS.filter((permission) => !permissions.some((p) => p.permission === permission));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-12 flex-none whitespace-nowrap text-xs text-ink-3">{PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.USE]}</span>
        {use.length > 0 ? (
          use.map((permission) => (
            <span key={permission} className="inline-flex items-center gap-1 text-ok">
              <Icon name="check" size="sm" />
              <span className="text-ink">{PERMISSION_LABEL[permission]}</span>
            </span>
          ))
        ) : (
          <span className="text-cap text-ink-3">없어요</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-12 flex-none whitespace-nowrap text-xs text-ink-3">{PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.VIEW]}</span>
        {view.length > 0 ? (
          view.map((permission) => (
            <span key={permission} className="inline-flex items-center gap-1 text-run">
              <Icon name="eye" size="sm" />
              <span className="text-ink-2">{PERMISSION_LABEL[permission]}</span>
            </span>
          ))
        ) : (
          <span className="text-cap text-ink-3">없어요</span>
        )}
      </div>
      {none.length > 0 ? (
        <div className="flex items-center gap-x-3 text-ink-3">
          <span className="min-w-12 flex-none whitespace-nowrap text-xs">권한 없음</span>
          <span className="inline-flex items-center gap-1 text-cap">
            <Icon name="lock" size="sm" />
            {none
              .slice(0, 3)
              .map((permission) => PERMISSION_LABEL[permission])
              .join(', ')}
            {none.length > 3 ? ` 외 ${none.length - 3}개` : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
