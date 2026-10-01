// B안 아이콘. 모양은 src/styles/icons.css의 CSS mask이고 색은 글자색(currentColor)을 따른다.
import { cn } from '@/lib/cn';

export const ICON_NAMES = [
  'dashboard', 'clipboard', 'stock', 'factory', 'trace', 'quality', 'truck', 'chat', 'note', 'file',
  'database', 'users', 'user', 'search', 'bell', 'chevron-down', 'chevron-up', 'chevron-right', 'chevron-left', 'plus',
  'filter', 'check', 'x', 'alert', 'lock', 'send', 'clip', 'upload', 'download', 'mic',
  'clock', 'logout', 'panel', 'refresh', 'arrow-right', 'calendar', 'more', 'hash', 'info', 'book',
  'eye', 'edit', 'trash', 'flame', 'coil', 'slab', 'link', 'share', 'check-circle', 'x-circle',
  'inbox', 'sort', 'gauge', 'flow', 'grid', 'downgrade', 'wave', 'maximize', 'minimize', 'key',
  'shield', 'copy', 'thumb', 'cart', 'box', 'history', 'task', 'calc', 'building', 'pin',
  'grip', 'widget', 'radar', 'print', 'approve',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps {
  name: IconName;
  /** sm 14px · 기본 16px · lg 20px */
  size?: 'sm' | 'lg';
  className?: string;
}

export function Icon({ name, size, className }: IconProps) {
  return <i className={cn('ic', `ic-${name}`, size === 'sm' && 'ic--sm', size === 'lg' && 'ic--lg', className)} aria-hidden="true" />;
}
