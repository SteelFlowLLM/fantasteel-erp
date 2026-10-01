// 아이콘만 있는 버튼 (옛 hl-iconbtn). 화면 낭독기용 이름(label)이 꼭 필요하다.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md';
  iconSize?: 'sm' | 'lg';
  /** ai = 보라색 (AI 패널 안) */
  tone?: 'default' | 'ai';
  /** 아이콘 위에 겹쳐 그릴 것 (숫자 배지 등) */
  children?: ReactNode;
}

export function IconButton({ icon, label, size = 'md', iconSize, tone = 'default', className, type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-sm disabled:opacity-55',
        tone === 'ai' ? 'text-ai-strong hover:bg-[#e9e3fb]' : 'text-ink-2 hover:bg-surface-3',
        size === 'sm' ? 'size-7' : 'size-9',
        children ? 'relative' : undefined,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
      {children}
    </button>
  );
}
