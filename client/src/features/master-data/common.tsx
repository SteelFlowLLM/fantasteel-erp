// 기준정보 탭이 함께 쓰는 작은 부품·도우미.
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { canUse, useMe } from '@/stores/auth';

/** 기준정보 변경 권한 (MASTER_MANAGE USE). 서버가 다시 검사한다. */
export const useCanManage = () => canUse(useMe(), 'MASTER_MANAGE');
export const LOCK_TITLE = '기준정보 관리 사용 권한이 필요해요';

export const errMsg = (e: unknown, fallback = '저장하지 못했어요') => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback);

/** 변경 요청: 성공하면 기준정보 전체 조회(준비 상태 포함)를 다시 불러온다. 실패는 서버 메시지를 토스트로 띄운다. */
export function useMasterAction<I, O>(fn: (input: I) => Promise<O>, success?: string | ((data: O) => string), onSuccess?: (data: O, input: I) => void) {
  return useAction(fn, { success, invalidate: ['master-data'], onSuccess });
}

/** 소수 문자열 → 숫자 (자리수 초과·음수·문자는 null). */
export function parseDec(s: string, maxDp: number): number | null {
  const t = s.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${maxDp}})?$`).test(t)) return null;
  return Number(t);
}
/** 빈 값이면 null, 잘못된 값이면 undefined. */
export function parseOptDec(s: string, maxDp: number): number | null | undefined {
  if (!s.trim()) return null;
  return parseDec(s, maxDp) ?? undefined;
}

export function LockHint({ text = '조회만 할 수 있어요 · 기준정보 관리 권한이 필요해요' }: { text?: string }) {
  return <span className="hl-lockhint"><Icon name="lock" size="sm" />{text}</span>;
}

export function SelectBox({ value, onChange, children, disabled, label, style }: { value: string | number; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; label?: string; style?: React.CSSProperties }) {
  return (
    <span className="hl-selectwrap" style={style}>
      <select className="hl-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>{children}</select>
      <Icon name="chevron-down" size="sm" />
    </span>
  );
}

/** 사용 여부 배지 버튼: 누르면 사용 ↔ 사용 안 함. (삭제 대신) */
export function ActiveToggle({ active, canEdit, pending, onToggle }: { active: boolean; canEdit: boolean; pending?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={active ? 'hl-badge hl-badge--ok' : 'hl-badge'}
      style={{ border: 0, cursor: canEdit ? 'pointer' : 'default' }}
      onClick={onToggle}
      disabled={!canEdit || pending}
      title={!canEdit ? LOCK_TITLE : active ? '누르면 사용 안 함으로 바꿔요 (삭제 대신)' : '누르면 다시 사용해요'}
    >
      {active ? '사용' : '사용 안 함'}
    </button>
  );
}

/** 삭제 버튼: 한 번 더 눌러 확인한다. 서버가 거절하면 메시지가 토스트로 나온다. */
export function DeleteButton({ label, canEdit, pending, disabledReason, onConfirm }: { label: string; canEdit: boolean; pending?: boolean; disabledReason?: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="hl-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" className="hl-btn hl-btn--sm hl-btn--danger" disabled={pending} onClick={() => { setAsking(false); onConfirm(); }}>삭제</button>
        <button type="button" className="hl-btn hl-btn--sm" onClick={() => setAsking(false)}>취소</button>
      </span>
    );
  }
  const blocked = !canEdit || !!disabledReason;
  return (
    <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label={`${label} 삭제`} title={!canEdit ? LOCK_TITLE : disabledReason ?? `${label} 삭제`} disabled={blocked || pending} onClick={() => setAsking(true)}>
      <Icon name="trash" />
    </button>
  );
}

export function EditButton({ label, canEdit, onClick }: { label: string; canEdit: boolean; onClick: () => void }) {
  return (
    <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label={`${label} 수정`} title={canEdit ? `${label} 수정` : LOCK_TITLE} disabled={!canEdit} onClick={onClick}>
      <Icon name="edit" />
    </button>
  );
}

export function AddButton({ children, canEdit, onClick }: { children: ReactNode; canEdit: boolean; onClick: () => void }) {
  return (
    <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" onClick={onClick} disabled={!canEdit} title={canEdit ? undefined : LOCK_TITLE}>
      <Icon name="plus" />
      {children}
    </button>
  );
}

/** 모달 바닥: 서버 오류는 그대로 보여준다. */
export function FormFooter({ error, hint, onClose, onSubmit, pending, disabled, submitLabel = '저장' }: { error?: string | null; hint?: ReactNode; onClose: () => void; onSubmit: () => void; pending?: boolean; disabled?: boolean; submitLabel?: string }) {
  return (
    <>
      {error ? <span className="hl-cap hl-danger-text md-foot-error" role="alert">{error}</span> : hint ? <span className="hl-cap md-foot-error">{hint}</span> : null}
      <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>취소</button>
      <button type="button" className="hl-btn hl-btn--primary" onClick={onSubmit} disabled={pending || disabled}>
        <Icon name="check" />
        {pending ? '저장 중…' : submitLabel}
      </button>
    </>
  );
}

/** 카드 머리: 제목 + 개수 + 오른쪽 조작. */
export function CardHead({ title, count, sub, children }: { title: ReactNode; count?: number; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="hl-card__head" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 44, padding: '6px 16px' }}>
      <h3>{title}</h3>
      {count !== undefined ? <span className="hl-tag">{count}</span> : null}
      {sub ? <span className="hl-cap">{sub}</span> : null}
      {children ? <div className="hl-card__actions" style={{ flexWrap: 'wrap' }}>{children}</div> : null}
    </header>
  );
}

export const CODE_RE_UPPER = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;

export const ACTIVE_OPTIONS = (
  <>
    <option value="">전체</option>
    <option value="true">사용</option>
    <option value="false">사용 안 함</option>
  </>
);
