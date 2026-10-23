// 안내 띠 (옛 hl-banner). danger · wait · ok · run · neutral
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export type BannerTone = 'neutral' | 'danger' | 'wait' | 'ok' | 'run';

const TONE: Record<BannerTone, { box: string; icon: string; defaultIcon: IconName }> = {
  neutral: { box: 'border-line bg-surface-2 text-ink', icon: 'text-ink-3', defaultIcon: 'info' },
  danger: { box: 'border-[#f2c3be] bg-danger-bg text-[#8e231e]', icon: 'text-danger', defaultIcon: 'alert' },
  wait: { box: 'border-[#f2d2a8] bg-wait-bg text-[#7a3d00]', icon: 'text-wait', defaultIcon: 'alert' },
  ok: { box: 'border-[#b9dec8] bg-ok-bg text-[#115c38]', icon: 'text-ok', defaultIcon: 'check-circle' },
  run: { box: 'border-[#bcd0f3] bg-run-bg text-[#17479b]', icon: 'text-run', defaultIcon: 'info' },
};

export interface BannerProps {
  tone?: BannerTone;
  icon?: IconName | null;
  /** 오른쪽 버튼 자리 */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Banner({ tone = 'neutral', icon, actions, className, children }: BannerProps) {
  const style = TONE[tone];
  const iconName = icon === undefined ? style.defaultIcon : icon;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm leading-normal [&_b]:font-semibold', style.box, className)}
    >
      {iconName ? <Icon name={iconName} className={cn('mt-px', style.icon)} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="ml-auto flex flex-none gap-1.5">{actions}</div> : null}
    </div>
  );
}
