// 날짜 입력 (SPEC 5-2): 숫자로 직접 입력할 수 있고, 달력 아이콘을 누르면 아래에 달력이 떠서 고를 수 있다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { todayStr } from '@/lib/format';

const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** "20261012", "2026.10.12", "26-10-12", "10/12" 같은 입력을 YYYY-MM-DD로 바꾼다. 해석할 수 없으면 null. */
export function parseDateText(text: string, baseYear = Number(todayStr().slice(0, 4))): string | null {
  const s = text.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const digits = s.replace(/\D/g, '');
  const parts = s.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    [y, m, d] = parts.map(Number);
    if (y < 100) y += 2000;
  } else if (parts.length === 2) {
    y = baseYear;
    [m, d] = parts.map(Number);
  } else if (digits.length === 8) {
    y = Number(digits.slice(0, 4)); m = Number(digits.slice(4, 6)); d = Number(digits.slice(6, 8));
  } else if (digits.length === 6) {
    y = 2000 + Number(digits.slice(0, 2)); m = Number(digits.slice(2, 4)); d = Number(digits.slice(4, 6));
  } else if (digits.length === 4) {
    y = baseYear; m = Number(digits.slice(0, 2)); d = Number(digits.slice(2, 4));
  } else return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last || y < 2000 || y > 2100) return null;
  return toStr(y, m, d);
}

export interface DateInputProps {
  /** YYYY-MM-DD 또는 '' */
  value: string;
  onChange: (value: string) => void;
  /** 이 날짜(포함)보다 이전은 고를 수 없다 */
  min?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  width?: number;
  invalid?: boolean;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function DateInput({ value, onChange, min, placeholder = 'YYYY-MM-DD', ariaLabel, disabled, width = 150, invalid }: DateInputProps) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const today = todayStr();
  const base = value || today;
  const [view, setView] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });

  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (raw: string) => {
    if (!raw.trim()) {
      setBad(false);
      onChange('');
      return;
    }
    const parsed = parseDateText(raw);
    if (!parsed || (min && parsed < min)) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(parsed);
    onChange(parsed);
  };

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1));
    const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86_400_000);
      return { str: toStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), out: d.getUTCMonth() + 1 !== view.m };
    });
  }, [view]);
  const move = (delta: number) => setView((v) => {
    const d = new Date(Date.UTC(v.y, v.m - 1 + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });
  const toggle = () => {
    if (!open) {
      const b = value || today;
      setView({ y: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) });
    }
    setOpen(!open);
  };

  return (
    <span className="app-date" ref={root} style={{ width }}>
      <input
        className={`hl-input tnum${bad || invalid ? ' is-error' : ''}`}
        style={{ width: '100%' }}
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={bad || invalid || undefined}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
          if (e.key === 'ArrowDown' && !open) toggle();
        }}
      />
      <button type="button" className="hl-iconbtn hl-iconbtn--sm app-date__btn" aria-label="달력 열기" aria-expanded={open} disabled={disabled} onClick={toggle}>
        <i className="ic ic-calendar" aria-hidden="true" />
      </button>
      {open ? (
        <div className="app-cal" role="dialog" aria-label="날짜 선택">
          <div className="app-cal__head">
            <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label="이전 달" onClick={() => move(-1)}><i className="ic ic-chevron-left" /></button>
            <b>{view.y}년 {view.m}월</b>
            <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label="다음 달" onClick={() => move(1)}><i className="ic ic-chevron-right" /></button>
          </div>
          <div className="app-cal__grid">
            {DOW.map((d) => <span key={d} className="app-cal__dow">{d}</span>)}
            {cells.map((c) => (
              <button
                key={c.str}
                type="button"
                className={`app-cal__day${c.out ? ' is-out' : ''}${c.str === today ? ' is-today' : ''}${c.str === value ? ' is-selected' : ''}`}
                disabled={!!min && c.str < min}
                aria-label={c.str}
                aria-pressed={c.str === value}
                onClick={() => {
                  onChange(c.str);
                  setText(c.str);
                  setBad(false);
                  setOpen(false);
                }}
              >
                {c.day}
              </button>
            ))}
          </div>
          <div className="app-cal__foot">
            <button type="button" className="hl-btn hl-btn--ghost hl-btn--sm" onClick={() => { onChange(''); setText(''); setOpen(false); }}>지우기</button>
            <button type="button" className="hl-btn hl-btn--sm" disabled={!!min && today < min} onClick={() => { onChange(today); setText(today); setOpen(false); }}>오늘</button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
