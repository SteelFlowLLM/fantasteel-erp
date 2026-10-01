// 화면 단위 상태: 불러오는 중 / 오류 / 권한 없음 / 빈 상태 (옛 hl-state). 목록이 비었을 때는 EmptyNote를 쓴다.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';

export function Spinner({ label = '불러오는 중…', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-ink-3', className)}>
      <Icon name="refresh" className="animate-spin" />
      {label}
    </span>
  );
}

export type StateKind = 'loading' | 'error' | 'lock' | 'empty';

const DEFAULT_TITLE: Record<Exclude<StateKind, 'loading'>, string> = {
  error: '불러오지 못했어요',
  lock: '이 화면을 볼 권한이 없어요',
  empty: '표시할 내용이 없어요',
};

const DEFAULT_ICON: Record<Exclude<StateKind, 'loading'>, IconName> = {
  error: 'alert',
  lock: 'lock',
  empty: 'inbox',
};

export interface StateViewProps {
  kind: StateKind;
  title?: string;
  text?: ReactNode;
  /** 오류 코드 (예: COM-002) */
  code?: string;
  icon?: IconName;
  actions?: ReactNode;
  className?: string;
}

export function StateView({ kind, title, text, code, icon, actions, className }: StateViewProps) {
  if (kind === 'loading') {
    return (
      <div className={cn('flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
        <Spinner label={title} />
      </div>
    );
  }
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full [&_.ic]:size-6',
          kind === 'error' ? 'bg-danger-bg text-danger' : 'bg-surface-3 text-ink-2',
        )}
      >
        <Icon name={icon ?? DEFAULT_ICON[kind]} />
      </span>
      <b className="text-lg font-semibold text-ink">{title ?? DEFAULT_TITLE[kind]}</b>
      {text ? <p className="max-w-[420px] text-sm leading-5 text-ink-2">{text}</p> : null}
      {code ? <span className="font-mono text-[11.5px] text-ink-3">{code}</span> : null}
      {actions ? <div className="flex justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 목록·표가 비었을 때 같은 자리에 보이는 짧은 안내 */
export function EmptyNote({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-5 text-center text-cap text-ink-3', className)}>{children}</div>;
}

/** 셸 없이 화면 전체를 쓰는 상태 (처음 불러올 때, 로그인 확인 중) */
export function FullScreenState(props: StateViewProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg">
      <StateView {...props} />
    </div>
  );
}
