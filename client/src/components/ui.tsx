// 공용 UI 부품. 모양은 B안 디자인 CSS(hl-*) 클래스를 그대로 쓴다.
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';

export type Tone = 'ok' | 'run' | 'wait' | 'danger' | 'ai' | 'neutral';
export const badgeClass = (tone: Tone = 'neutral') => (tone === 'neutral' ? 'hl-badge' : `hl-badge hl-badge--${tone}`);

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={badgeClass(tone)} title={title}>{children}</span>;
}

export function Icon({ name, size, style }: { name: string; size?: 'sm' | 'lg'; style?: CSSProperties }) {
  return <i className={`ic ic-${name}${size ? ` ic--${size}` : ''}`} style={style} aria-hidden="true" />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="hl-row" style={{ gap: 8, color: 'var(--ink-3)' }}>
      <i className="ic ic-refresh hl-spinner" aria-hidden="true" />
      {label ?? '불러오는 중…'}
    </span>
  );
}

/** 목록·표가 비었을 때 같은 자리에 보여주는 짧은 안내. */
export function EmptyNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="hl-cap" style={{ padding: '20px 16px', textAlign: 'center', ...style }}>{children}</div>;
}

/** 화면 단위 상태: 로딩 / 오류 / 권한 없음 / 빈 상태 (디자인 42~45번 화면). */
export function StateView({ kind, title, text, code, actions }: { kind: 'loading' | 'error' | 'lock' | 'empty'; title?: string; text?: ReactNode; code?: string; actions?: ReactNode }) {
  if (kind === 'loading') {
    return (
      <div className="hl-state" style={{ flex: 1 }}>
        <Spinner label={title ?? '불러오는 중…'} />
      </div>
    );
  }
  const icon = kind === 'error' ? 'alert' : kind === 'lock' ? 'lock' : 'inbox';
  return (
    <div className={`hl-state${kind === 'error' ? ' hl-state--error' : kind === 'lock' ? ' hl-state--lock' : ''}`} style={{ flex: 1 }}>
      <span className="hl-state__icon"><Icon name={icon} size="lg" /></span>
      <b className="hl-state__title">{title ?? (kind === 'error' ? '불러오지 못했어요' : kind === 'lock' ? '이 화면을 볼 권한이 없어요' : '표시할 내용이 없어요')}</b>
      {text ? <p className="hl-state__text">{text}</p> : null}
      {code ? <span className="hl-state__code mono">{code}</span> : null}
      {actions ? <div className="hl-state__actions">{actions}</div> : null}
    </div>
  );
}

/** useQuery 결과를 받아 로딩·오류를 처리하고, 성공하면 children(data)을 그린다. */
export function QueryBoundary<T>({ query, children, loadingLabel }: { query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode; loadingLabel?: string }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isLoading) return <StateView kind="loading" title={loadingLabel} />;
  if (query.error) {
    const e = query.error;
    const isLock = e instanceof ApiError && e.status === 403;
    return (
      <StateView
        kind={isLock ? 'lock' : 'error'}
        text={e instanceof Error ? e.message : undefined}
        code={e instanceof ApiError ? e.code : undefined}
        actions={<button type="button" className="hl-btn" onClick={() => void query.refetch()}>다시 시도</button>}
      />
    );
  }
  return null;
}

export function Modal({ title, onClose, children, footer, width = 520 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="hl-scrim hl" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hl-modal" style={{ width }}>
        <header className="hl-modal__head">
          <h2>{title}</h2>
          <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }} aria-label="닫기" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="hl-modal__body">{children}</div>
        {footer ? <footer className="hl-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, style }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="hl-field" style={style}>
      <span className="hl-field__label">{label}</span>
      {children}
      {error ? <span className="hl-field__hint hl-danger-text">{error}</span> : hint ? <span className="hl-field__hint">{hint}</span> : null}
    </label>
  );
}

/** P2·EX 기능 표시: 디자인(버튼·화면)은 남기고 기능은 뺀다 (SPEC 3번). */
export function ComingSoon({ grade = 'P2' }: { grade?: 'P2' | 'EX' | 'AI' }) {
  return <span className="app-soon">준비 중{grade === 'AI' ? '' : ` (${grade})`}</span>;
}

/** 준비 중 화면: 위에 안내 띠를 두르고 본문(디자인)은 흐리게·조작 불가로 보여준다. */
export function ComingSoonArea({ grade = 'P2', title, children }: { grade?: 'P2' | 'EX'; title: string; children: ReactNode }) {
  return (
    <div className="app-soon-area hl-col" style={{ gap: 12, flex: 1, minHeight: 0 }}>
      <div className="app-soon-banner">
        <ComingSoon grade={grade} />
        <span><b>{title}</b>은(는) {grade === 'P2' ? '2등급(AI) 기능' : '추가 기능'}이라 지금은 화면만 볼 수 있어요. 1등급 기능이 끝난 뒤 하나씩 추가돼요.</span>
      </div>
      <div className="app-soon-area__body hl-col" style={{ gap: 16, flex: 1, minHeight: 0 }} aria-hidden="true">{children}</div>
    </div>
  );
}

/** 준비 중 버튼: 눌러도 아무 일도 하지 않고 안내만 한다. */
export function SoonButton({ children, grade = 'P2', className = 'hl-btn' }: { children: ReactNode; grade?: 'P2' | 'EX' | 'AI'; className?: string }) {
  return (
    <button type="button" className={className} disabled title={`준비 중${grade === 'AI' ? '' : ` (${grade})`}`}>
      {children} <ComingSoon grade={grade} />
    </button>
  );
}

export function Progress({ pct, tone }: { pct: number; tone?: 'ok' | 'wait' | 'danger' }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="hl-progress-cell">
      <div className={`hl-progress${tone ? ` hl-progress--${tone}` : ''}`}><span style={{ width: `${v}%` }} /></div>
      <b>{v}%</b>
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: 's' | 'm' | 'lg' }) {
  return <span className={`hl-avatar${size ? ` hl-avatar--${size}` : ''}`}>{name.slice(0, 1)}</span>;
}

export function Toaster() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="app-toasts hl" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`app-toast app-toast--${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
