'use client';

// 시각 고르기 (내 일정 창). 브라우저 기본 <select>는 펼치는 방향을 브라우저가 정해 위로 펼쳐지기도 해서, 늘 칸 아래로 펼치는 목록을 둔다.
// 목록은 DateInput 달력처럼 화면 기준(fixed)으로 띄워 창(Modal) 안에서 잘리지 않게 하고, 글자 크기 설정(zoom)을 나눠 위치를 맞춘다.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { appZoom } from '@/lib/fontSize';

const LIST_MAX_HEIGHT = 240;
/** 아래 공간이 이보다 적어도 위로 뒤집지 않고 이 높이로 펼쳐 안에서 넘긴다 */
const LIST_MIN_HEIGHT = 120;
const TRIGGER_CLASS =
  'flex h-8 w-full items-center justify-between rounded-sm border border-line-strong bg-surface pr-2 pl-2.5 text-left font-mono text-sm text-ink tabular-nums outline-none ' +
  'focus:border-run focus:shadow-[0_0_0_2px_var(--color-run-bg)] focus-visible:outline-none';

export interface TimeSelectProps {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

export function TimeSelect({ value, options, onChange, ariaLabel }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0, maxHeight: LIST_MAX_HEIGHT });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  const optionId = (time: string) => `${uid}-${time.replace(':', '')}`;

  const close = (focusButton = false) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const openList = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const zoom = appZoom();
    const top = rect.bottom / zoom + 4;
    const room = window.innerHeight / zoom - top - 8;
    setBox({ top, left: rect.left / zoom, width: rect.width / zoom, maxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, room)) });
    setActive(value);
    setOpen(true);
  };

  const pick = (time: string) => {
    onChange(time);
    close(true);
  };

  // 열면 고른 시각이 목록 가운데쯤 보이게 넘긴다
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && selected) list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2;
    list?.focus();
  }, [open]);

  // 바깥을 누르거나, 바깥이 넘어가거나, 창 크기가 바뀌면 닫는다
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && listRef.current?.contains(event.target))) close();
    };
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const move = (delta: number) => {
    const index = Math.max(0, options.indexOf(active));
    const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`[data-time="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(active);
    } else if (event.key === 'Escape') {
      // 창(Modal)까지 닫히지 않게 목록만 닫는다
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        // 입력칸(inputClass)과 같은 모양. 다만 버튼은 :read-only에 걸려 inputClass의 읽기 전용 회색이 칠해지므로 그 규칙만 뺀다
        className={TRIGGER_CLASS}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openList();
          }
        }}
      >
        {value}
        <Icon name="chevron-down" className="text-ink-3" />
      </button>
      {open ? (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={optionId(active)}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="fixed z-[70] overflow-auto rounded-md border border-line bg-surface py-1 shadow-pop outline-none"
          // 칸 바로 아래 위치·너비·남은 높이는 열 때 재는 값이라 style로 준다
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
        >
          {options.map((time) => (
            <li
              key={time}
              id={optionId(time)}
              role="option"
              aria-selected={time === value}
              data-time={time}
              onPointerEnter={() => setActive(time)}
              onClick={() => pick(time)}
              className={cn(
                'cursor-pointer px-2.5 py-1.5 font-mono text-sm tabular-nums',
                time === value ? 'bg-brand text-white' : time === active ? 'bg-surface-3' : 'text-ink',
              )}
            >
              {time}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
