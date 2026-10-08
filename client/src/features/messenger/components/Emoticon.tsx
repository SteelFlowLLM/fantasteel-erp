'use client';

// 철강맨 이모티콘 (18번, 문서에 없는 추가 기능). 64px 도트 그림을 정수배로 키워 흐려지지 않게 보여 준다.
// 움직임은 GIF, '동작 줄이기'를 켠 사람에게는 멈춘 그림(PNG). 원본·다시 만들기는 docs/character/steelman-emoticon/
import { useState } from 'react';
import { MESSAGE_EMOTICONS, type MessageEmoticonKey } from '@fantasteel/shared';
import { Button } from '@/components/Button';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';

/** 그림 원본 크기 */
export const EMOTICON_SOURCE_PX = 64;

export const emoticonLabelOf = (key: MessageEmoticonKey): string => MESSAGE_EMOTICONS.find((e) => e.key === key)?.label ?? '이모티콘';

export function EmoticonImage({ emoticonKey, scale = 2, still = false, className }: { emoticonKey: MessageEmoticonKey; scale?: 1 | 2; still?: boolean; className?: string }) {
  const px = EMOTICON_SOURCE_PX * scale;
  const label = `이모티콘 ${emoticonLabelOf(emoticonKey)}`;
  const png = `/emoticons/${emoticonKey}.png`;
  return (
    <picture className={cn('block flex-none', className)}>
      {still ? null : <source srcSet={png} media="(prefers-reduced-motion: reduce)" />}
      <img src={still ? png : `/emoticons/${emoticonKey}.gif`} alt={label} title={label} width={px} height={px} draggable={false} className="block [image-rendering:pixelated]" />
    </picture>
  );
}

/** 입력창의 '이모티콘' 버튼과 고르기 창. 고르면 입력창 위에 미리 보이고, 보내기를 눌러야 간다 */
export function EmoticonPicker({ disabled, disabledReason, onPick }: { disabled: boolean; disabledReason?: string; onPick: (key: MessageEmoticonKey) => void }) {
  const popover = usePopover<HTMLDivElement>();
  // 고르기 창에서는 멈춘 그림을 보여 주고, 올리거나 포커스한 것만 움직인다 (여러 개가 한꺼번에 움직이면 정신없다)
  const [activeKey, setActiveKey] = useState<MessageEmoticonKey | null>(null);
  return (
    <div ref={popover.ref} className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        disabled={disabled}
        title={disabled ? disabledReason : '철강맨 이모티콘'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => popover.setOpen(!popover.open)}
      >
        이모티콘
      </Button>
      {popover.open ? (
        <div role="dialog" aria-label="이모티콘 고르기" className="absolute bottom-full left-0 z-30 mb-2 w-[312px] rounded-md border border-line bg-surface p-2 shadow-pop">
          <div className="px-1 pb-1.5 text-xs font-semibold text-ink-2">철강맨</div>
          <div className="grid grid-cols-4 gap-1">
            {MESSAGE_EMOTICONS.map(({ key, label }) => (
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
                <EmoticonImage emoticonKey={key} scale={1} still={activeKey !== key} />
                <span className="text-cap text-ink-3">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
