'use client';

// 철강맨 이모티콘 (18번·19번, 문서에 없는 추가 기능). 64px 도트 그림을 정수배로 키워 흐려지지 않게 보여 준다.
// 움직임은 GIF, '동작 줄이기'를 켠 사람에게는 멈춘 그림(PNG). 원본·다시 만들기는 docs/character/steelman-emoticon/
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_EMOTICON_SETS, MESSAGE_EMOTICONS, type MessageEmoticonKey, type MessageEmoticonSetKey } from '@fantasteel/shared';
import { Button } from '@/components/Button';
import { readRecentEmoticons } from '@/features/messenger/lib/emoticonRecent';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';

/** 그림 원본 크기 */
export const EMOTICON_SOURCE_PX = 64;

export const emoticonLabelOf = (key: MessageEmoticonKey): string => MESSAGE_EMOTICONS.find((e) => e.key === key)?.label ?? '이모티콘';

export function EmoticonImage({
  emoticonKey,
  scale = 2,
  still = false,
  lazy = false,
  className,
}: {
  emoticonKey: MessageEmoticonKey;
  scale?: 1 | 2;
  still?: boolean;
  /** 화면에 보일 때 불러온다 (고르기 창처럼 한꺼번에 많이 그릴 때) */
  lazy?: boolean;
  className?: string;
}) {
  const px = EMOTICON_SOURCE_PX * scale;
  const label = `이모티콘 ${emoticonLabelOf(emoticonKey)}`;
  const png = `/emoticons/${emoticonKey}.png`;
  return (
    <picture className={cn('block flex-none', className)}>
      {still ? null : <source srcSet={png} media="(prefers-reduced-motion: reduce)" />}
      <img
        src={still ? png : `/emoticons/${emoticonKey}.gif`}
        alt={label}
        title={label}
        width={px}
        height={px}
        loading={lazy ? 'lazy' : undefined}
        decoding={lazy ? 'async' : undefined}
        draggable={false}
        className="block [image-rendering:pixelated]"
      />
    </picture>
  );
}

type PickerTab = 'recent' | MessageEmoticonSetKey;

const PICKER_TABS: readonly { key: PickerTab; label: string }[] = [{ key: 'recent', label: '최근' }, ...MESSAGE_EMOTICON_SETS];
const FIRST_SET: MessageEmoticonSetKey = MESSAGE_EMOTICON_SETS[0].key;

/**
 * 입력창의 '이모티콘' 버튼과 고르기 창. 탭은 최근 · 묶음별. 고르면 입력창 위에 미리 보이고, 보내기를 눌러야 간다.
 * 최근 목록은 보낼 때 입력창이 쌓고(emoticonRecent), 여기서는 창을 열 때 읽는다.
 */
export function EmoticonPicker({
  employeeId,
  disabled,
  disabledReason,
  onPick,
}: {
  employeeId: number;
  disabled: boolean;
  disabledReason?: string;
  onPick: (key: MessageEmoticonKey) => void;
}) {
  const popover = usePopover<HTMLDivElement>();
  // 고르기 창에서는 멈춘 그림을 보여 주고, 올리거나 포커스한 것만 움직인다 (여러 개가 한꺼번에 움직이면 정신없다)
  const [activeKey, setActiveKey] = useState<MessageEmoticonKey | null>(null);
  const [recent, setRecent] = useState<MessageEmoticonKey[]>([]);
  const [tab, setTab] = useState<PickerTab>(FIRST_SET);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const tabId = (key: PickerTab) => `${baseId}-tab-${key}`;
  const panelId = `${baseId}-panel`;

  const toggle = () => {
    if (popover.open) {
      popover.setOpen(false);
      return;
    }
    const keys = readRecentEmoticons(employeeId);
    setRecent(keys);
    setTab(keys.length > 0 ? 'recent' : FIRST_SET);
    setActiveKey(null);
    popover.setOpen(true);
  };

  const selectTab = (key: PickerTab) => {
    setTab(key);
    setActiveKey(null);
  };

  // 탭 사이는 화살표·Home·End로 옮기고, 옮기면 바로 그 탭을 보여 준다 (WAI-ARIA 탭 패턴)
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = PICKER_TABS.length - 1;
    const targets: Record<string, number> = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last };
    const next: number | undefined = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(PICKER_TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  const keys: readonly MessageEmoticonKey[] = tab === 'recent' ? recent : MESSAGE_EMOTICONS.filter((e) => e.set === tab).map((e) => e.key);

  return (
    // 고르기 창은 이 묶음이 아니라 입력창(Composer, relative) 기준으로 띄운다. 좁은 화면에서도 입력창 밖으로 나가지 않게 하려고
    <div ref={popover.ref}>
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        disabled={disabled}
        title={disabled ? disabledReason : '철강맨 이모티콘'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        이모티콘
      </Button>
      {popover.open ? (
        <div
          role="dialog"
          aria-label="이모티콘 고르기"
          className="absolute bottom-full left-5 z-30 mb-1 w-[340px] max-w-[calc(100%-2.5rem)] rounded-md border border-line bg-surface p-2 shadow-pop"
        >
          <div role="tablist" aria-label="이모티콘 묶음" className="flex gap-1 border-b border-line px-1">
            {PICKER_TABS.map((item, index) => (
              <button
                key={item.key}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={tabId(item.key)}
                type="button"
                role="tab"
                aria-selected={item.key === tab}
                aria-controls={panelId}
                tabIndex={item.key === tab ? 0 : -1}
                onClick={() => selectTab(item.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className="-mb-px inline-flex h-8 items-center border-b-2 border-transparent px-2.5 text-xs font-medium text-ink-2 aria-selected:border-brand aria-selected:font-semibold aria-selected:text-brand"
              >
                {item.label}
              </button>
            ))}
          </div>
          {/* key: 탭을 바꾸면 스크롤을 맨 위로 되돌린다 */}
          <div key={tab} id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} className="mt-2 max-h-[320px] overflow-y-auto overscroll-contain">
            {keys.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-ink-3">보낸 이모티콘이 여기에 모여요</p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {keys.map((key) => {
                  const label = emoticonLabelOf(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={label}
                      title={label}
                      onMouseEnter={() => setActiveKey(key)}
                      onMouseLeave={() => setActiveKey(null)}
                      onFocus={() => setActiveKey(key)}
                      onBlur={() => setActiveKey(null)}
                      onClick={() => {
                        popover.setOpen(false);
                        onPick(key);
                      }}
                      className="flex flex-col items-center rounded-sm p-1 hover:bg-surface-2 focus-visible:bg-surface-2"
                    >
                      <EmoticonImage emoticonKey={key} scale={1} still={activeKey !== key} lazy />
                      <span className="break-keep text-center text-cap text-ink-3">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
