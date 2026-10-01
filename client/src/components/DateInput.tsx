'use client';

// 날짜 입력 (SPEC 4장 2번): 숫자로 바로 입력하거나(예: 20261020) 달력 아이콘을 눌러 고른다. 값은 YYYY-MM-DD 또는 ''.
// 옛 components/DateInput.tsx를 옮겼다. 달력은 화면 기준(fixed)으로 띄워 창·카드 안에서 잘리지 않게 한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { inputClass } from '@/components/Input';
import { cn } from '@/lib/cn';
import { parseDateText, toDateText } from '@/lib/dateText';
import { todayStr } from '@/lib/format';

export interface DateInputProps {
  /** YYYY-MM-DD 또는 '' */
  value: string;
  onChange: (value: string) => void;
  /** 이 날짜(포함)보다 앞은 고를 수 없다 */
  min?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** 바깥 너비 (기본 150px) */
  className?: string;
}

const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const CALENDAR_HEIGHT = 320;
const DAY_MS = 86_400_000;

interface MonthView {
  year: number;
  month: number;
}

const monthOf = (date: string): MonthView => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

export function DateInput({ value, onChange, min, id, placeholder = 'YYYY-MM-DD', ariaLabel, disabled, invalid, className = 'w-[150px]' }: DateInputProps) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const [previousValue, setPreviousValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [view, setView] = useState<MonthView>(() => monthOf(value || todayStr()));
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  // 바깥에서 값이 바뀌면 입력칸 글자도 맞춘다
  if (value !== previousValue) {
    setPreviousValue(value);
    setText(value);
    setBad(false);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); // 창(Modal) 안에서는 달력만 닫는다
      close();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = Date.UTC(view.year, view.month - 1, 1);
    const start = first - new Date(first).getUTCDay() * DAY_MS;
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start + index * DAY_MS);
      return {
        date: toDateText(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()),
        day: day.getUTCDate(),
        outside: day.getUTCMonth() + 1 !== view.month,
      };
    });
  }, [view]);

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

  const pick = (date: string) => {
    setText(date);
    setBad(false);
    onChange(date);
    setOpen(false);
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = rect.bottom + 4 + CALENDAR_HEIGHT <= window.innerHeight;
      setPosition({ top: below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - CALENDAR_HEIGHT), left: rect.left });
    }
    setView(monthOf(value || today));
    setOpen(true);
  };

  const moveMonth = (delta: number) =>
    setView((current) => {
      const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });

  return (
    <span ref={rootRef} className={cn('relative inline-flex items-center', className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={bad || invalid || undefined}
        disabled={disabled}
        className={inputClass('pr-8 pl-2.5 tabular-nums')}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
          if (event.key === 'ArrowDown' && !open) toggle();
        }}
      />
      <IconButton
        icon="calendar"
        label="달력 열기"
        size="sm"
        aria-expanded={open}
        disabled={disabled}
        className="absolute top-1/2 right-0.5 -translate-y-1/2"
        onClick={toggle}
      />
      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="날짜 선택"
          className="fixed z-[70] w-[268px] rounded-md border border-line bg-surface p-2.5 shadow-pop"
          // 입력칸 위치에 맞춰 띄우는 값이라 style로 준다
          style={{ top: position.top, left: position.left }}
        >
          <div className="mb-1.5 flex items-center gap-1">
            <IconButton icon="chevron-left" label="이전 달" size="sm" onClick={() => moveMonth(-1)} />
            <b className="flex-1 text-center text-sm font-semibold">
              {view.year}년 {view.month}월
            </b>
            <IconButton icon="chevron-right" label="다음 달" size="sm" onClick={() => moveMonth(1)} />
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {DAYS_OF_WEEK.map((dayName) => (
              <span key={dayName} className="py-1 text-center text-cap text-ink-3">
                {dayName}
              </span>
            ))}
            {cells.map((cell) => (
              <button
                key={cell.date}
                type="button"
                aria-label={cell.date}
                aria-pressed={cell.date === value}
                disabled={Boolean(min) && cell.date < (min ?? '')}
                onClick={() => pick(cell.date)}
                className={cn(
                  'h-8 rounded-sm text-sm tabular-nums disabled:opacity-40',
                  cell.date === value ? 'bg-brand text-white' : 'enabled:hover:bg-surface-3',
                  cell.date !== value && (cell.outside ? 'text-ink-disabled' : 'text-ink'),
                  cell.date === today && cell.date !== value && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                )}
              >
                {cell.day}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => pick('')}>
              지우기
            </Button>
            <Button size="sm" disabled={Boolean(min) && today < (min ?? '')} onClick={() => pick(today)}>
              오늘
            </Button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
