// 상단 바 드롭다운 틀 (옛 app-pop): 알림·메신저·사용자 메뉴·통합 검색 결과가 함께 쓴다.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** right = 버튼 오른쪽 끝에 맞춤(기본 380px, narrow 272px), stretch = 검색칸 너비 그대로 */
export type PopPlacement = 'right' | 'right-narrow' | 'stretch';

const PLACEMENT: Record<PopPlacement, string> = {
  right: 'top-11 right-0 w-[380px]',
  'right-narrow': 'top-11 right-0 w-[272px]',
  stretch: 'top-[38px] left-0 w-full',
};

export function PopPanel({ label, role = 'dialog', placement = 'right', children }: { label: string; role?: 'dialog' | 'menu' | 'listbox'; placement?: PopPlacement; children: ReactNode }) {
  return (
    <div
      role={role}
      aria-label={label}
      className={cn('absolute z-40 flex max-h-[520px] flex-col overflow-hidden rounded-md border border-line bg-surface shadow-pop', PLACEMENT[placement])}
    >
      {children}
    </div>
  );
}

export function PopHead({ title, meta, stacked, children }: { title?: ReactNode; meta?: ReactNode; stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-none border-b border-line px-3.5 py-3', stacked ? 'flex-col items-start gap-1' : 'items-center gap-2')}>
      {title ? <b className="text-base font-semibold">{title}</b> : null}
      {meta ? <span className="text-cap text-ink-3">{meta}</span> : null}
      {children}
    </div>
  );
}

export function PopList({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-col overflow-auto">{children}</div>;
}

export interface PopItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  unread?: boolean;
  /** 한 줄짜리 항목(메뉴·검색 결과)은 가운데 정렬 */
  centered?: boolean;
}

export function PopItem({ unread, centered, className, type = 'button', children, ...rest }: PopItemProps) {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full gap-2.5 border-b border-line px-3.5 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface-2 disabled:opacity-55',
        centered ? 'items-center' : 'items-start',
        unread ? 'bg-[#f5f9ff]' : 'bg-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PopNote({ children }: { children: ReactNode }) {
  return <div className="px-4 py-5 text-center text-cap text-ink-3">{children}</div>;
}

export function PopFoot({ children }: { children: ReactNode }) {
  return <div className="flex flex-none justify-center border-t border-line bg-surface-2 px-3.5 py-2">{children}</div>;
}
