// 메시지 메뉴 한 줄 (messageActions.ts에 등록한 동작이 쓴다)
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export interface MessageActionItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  /** 오른쪽 작은 글자 (예: 준비 중) */
  aside?: ReactNode;
}

export function MessageActionItem({ icon, aside, className, type = 'button', children, ...rest }: MessageActionItemProps) {
  return (
    <button
      type={type}
      role="menuitem"
      className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-transparent', className)}
      {...rest}
    >
      {icon ? <Icon name={icon} size="sm" className="text-ink-3" /> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {aside ? <span className="flex-none text-cap text-ink-3">{aside}</span> : null}
    </button>
  );
}
