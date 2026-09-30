// 번호를 치면 후보를 보여주고, 고르면 칩으로 바뀌는 입력. 작업 로그의 수주번호·LOT 번호 필터에 쓴다.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui';
import { useDebounced } from './traceHooks';

export interface PickItem { key: string; label: string; sub?: string }

export function PickerInput({ kind, icon, placeholder, ariaLabel, width = 210, selected, onClear, search, onPick, mono = true }: {
  kind: string; // 후보 조회 캐시 키
  icon: string;
  placeholder: string;
  ariaLabel: string;
  width?: number;
  /** 이미 고른 값의 표시 (있으면 입력 대신 칩) */
  selected: string | null;
  onClear: () => void;
  search: (q: string) => Promise<PickItem[]>;
  onPick: (item: PickItem) => void;
  mono?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dq = useDebounced(text.trim(), 250);
  // 통합 검색 캐시 키는 실시간 주제가 아니라서 서버 변경 알림으로 다시 불리지 않는다
  const q = useQuery({ queryKey: ['search', kind, dq], queryFn: () => search(dq), enabled: dq.length > 0 });
  const items = q.data ?? [];

  if (selected) {
    return (
      <span className="hl-chip is-on" style={{ height: 32, borderRadius: 'var(--radius-sm)' }}>
        <Icon name={icon} size="sm" />
        <span className={mono ? 'mono' : undefined} style={{ color: 'inherit' }}>{selected}</span>
        <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ color: 'inherit', width: 20, height: 20 }} aria-label={`${ariaLabel} 해제`} onClick={onClear}><Icon name="x" size="sm" /></button>
      </span>
    );
  }
  const pick = (it: PickItem) => { setText(''); setOpen(false); setMsg(null); onPick(it); };
  return (
    <span className="be-picker" style={{ width }}>
      <span className="hl-inputwrap">
        <Icon name="search" size="sm" />
        <input
          className={`hl-input${mono ? ' mono' : ''}`}
          type="search"
          value={text}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={open && dq.length > 0}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setOpen(true); setMsg(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              const t = text.trim();
              if (!t) return;
              const exact = items.find((i) => i.label.toLowerCase() === t.toLowerCase());
              const hit = exact ?? (items.length === 1 ? items[0] : undefined);
              if (hit) pick(hit);
              else setMsg(items.length ? '목록에서 골라 주세요' : `'${t}'에 맞는 번호가 없어요`);
            }
          }}
        />
      </span>
      {msg ? <span className="hl-cap hl-danger-text be-picker__msg" role="alert">{msg}</span> : null}
      {open && dq.length > 0 ? (
        <ul className="be-picker__pop" role="listbox" aria-label={`${ariaLabel} 후보`}>
          {q.isLoading ? <li className="hl-cap" style={{ padding: '8px 12px' }}>찾는 중…</li> : null}
          {items.map((i) => (
            <li key={i.key} role="option" aria-selected="false">
              <button type="button" className="be-picker__opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                <span className={mono ? 'mono' : undefined}>{i.label}</span>
                {i.sub ? <span className="hl-cap">{i.sub}</span> : null}
              </button>
            </li>
          ))}
          {q.data && !items.length ? <li className="hl-cap" style={{ padding: '8px 12px' }}>번호가 맞는 항목이 없어요</li> : null}
        </ul>
      ) : null}
    </span>
  );
}
