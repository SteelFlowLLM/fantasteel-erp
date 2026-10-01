// 읽기 전용 표시 (옛 hl-lockhint): 조회 권한만 있어 변경 버튼이 막힌 화면의 머리에 둔다.
// 예: "조회만 할 수 있어요 · 기준정보 관리 사용 권한이 필요해요"
import type { Permission } from '@/codes';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { permissionNeedText } from '@/lib/permissions';

export function ReadOnlyHint({ permissions, className }: { permissions: readonly Permission[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-cap text-ink-3', className)}>
      <Icon name="lock" size="sm" />
      조회만 할 수 있어요 · {permissionNeedText(permissions)}
    </span>
  );
}
