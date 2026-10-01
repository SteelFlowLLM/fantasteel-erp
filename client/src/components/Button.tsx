// B안 버튼 (옛 hl-btn). 종류: default · primary · ghost · danger · danger-outline · ai · ai-outline, 크기: sm · md · lg
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'danger-outline' | 'ai' | 'ai-outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium no-underline transition-colors [&_.ic]:size-3.5 ' +
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-3 disabled:text-ink-disabled';

const VARIANT: Record<ButtonVariant, string> = {
  default: 'border-line-strong bg-surface text-ink enabled:hover:border-[#a9b3be] enabled:hover:bg-surface-2',
  primary: 'border-brand bg-brand text-on-brand enabled:hover:border-brand-hover enabled:hover:bg-brand-hover',
  ghost: 'border-transparent bg-transparent text-ink-2 enabled:hover:bg-surface-3',
  danger: 'border-danger bg-danger text-white enabled:hover:opacity-90',
  'danger-outline': 'border-[#e3a7a2] bg-surface text-danger enabled:hover:bg-danger-bg',
  ai: 'border-ai bg-ai text-white enabled:hover:border-ai-strong enabled:hover:bg-ai-strong',
  'ai-outline': 'border-ai-line bg-surface text-ai-strong enabled:hover:border-ai enabled:hover:bg-ai-bg',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-10 px-4.5 text-base',
};

export function buttonClass({ variant = 'default', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
}

export function Button({ variant, size, icon, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}

/** 버튼 모양의 화면 이동 링크 */
export function ButtonLink({ href, variant, size, icon, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  );
}
