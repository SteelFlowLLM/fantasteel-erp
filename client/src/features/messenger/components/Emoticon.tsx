'use client';

// 철강맨 이모티콘 (18번~23번, 문서에 없는 추가 기능). 64px 도트 그림을 정수배(작게는 절반)로 바꿔 흐려지지 않게 보여 준다.
// 움직임은 GIF, '동작 줄이기'를 켠 사람에게는 멈춘 그림(PNG). 원본·다시 만들기는 docs/character/steelman-emoticon/
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  MESSAGE_EMOTICON_SETS,
  MESSAGE_EMOTICONS,
  reactionEmoticonKey,
  type MessageEmoticonKey,
  type MessageEmoticonSetKey,
  type MessageReactionEmoji,
} from '@fantasteel/shared';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { EMOTICON_FAVORITE_MAX, readFavoriteEmoticons, toggleFavoriteEmoticon } from '@/features/messenger/lib/emoticonFavorite';
import { readRecentEmoticons } from '@/features/messenger/lib/emoticonRecent';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/useToastStore';

/** 그림 원본 크기 */
export const EMOTICON_SOURCE_PX = 64;
/** 말풍선 이모티콘을 눌렀을 때 크게 보이는 시간 (가정값, 23번) */
export const EMOTICON_ENLARGE_MS = 2500;

export const emoticonLabelOf = (key: MessageEmoticonKey): string => MESSAGE_EMOTICONS.find((e) => e.key === key)?.label ?? '이모티콘';

const stillSrc = (key: MessageEmoticonKey) => `/emoticons/${key}.png`;

export function EmoticonImage({
  emoticonKey,
  scale = 2,
  still = false,
  lazy = false,
  replay = 0,
  className,
}: {
  emoticonKey: MessageEmoticonKey;
  scale?: 1 | 2;
  still?: boolean;
  /** 화면에 보일 때 불러온다 (고르기 창처럼 한꺼번에 많이 그릴 때) */
  lazy?: boolean;
  /**
   * 바뀔 때마다 GIF를 처음부터 다시 튼다 (23번). 같은 주소의 GIF는 브라우저가 움직임을 함께 쓰므로
   * 그림을 새로 그리는 것만으로는 처음으로 돌아가지 않아 주소 뒤에 번호를 붙인다
   */
  replay?: number;
  className?: string;
}) {
  const px = EMOTICON_SOURCE_PX * scale;
  const label = `이모티콘 ${emoticonLabelOf(emoticonKey)}`;
  const png = stillSrc(emoticonKey);
  const gif = replay > 0 ? `/emoticons/${emoticonKey}.gif?play=${replay}` : `/emoticons/${emoticonKey}.gif`;
  return (
    <picture key={replay} className={cn('block flex-none', className)}>
      {still ? null : <source srcSet={png} media="(prefers-reduced-motion: reduce)" />}
      <img
        src={still ? png : gif}
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

/** 글 속 작은 이모티콘 (23번): 멈춘 그림을 절반(32px)으로 글줄 안에 */
export function InlineEmoticon({ emoticonKey }: { emoticonKey: MessageEmoticonKey }) {
  const label = emoticonLabelOf(emoticonKey);
  return (
    <img
      src={stillSrc(emoticonKey)}
      alt={`(${label})`}
      title={label}
      width={EMOTICON_SOURCE_PX / 2}
      height={EMOTICON_SOURCE_PX / 2}
      draggable={false}
      className="inline-block align-middle [image-rendering:pixelated]"
    />
  );
}

/** 반응 하나의 모양: 이모지는 글자, 철강맨 반응(23번)은 멈춘 그림 32px. 읽는 이름은 부르는 쪽이 reactionLabel로 붙인다 */
export function ReactionGlyph({ value }: { value: MessageReactionEmoji }) {
  const key = reactionEmoticonKey(value);
  if (!key) return <span aria-hidden="true">{value}</span>;
  return (
    <img
      src={stillSrc(key)}
      alt=""
      width={EMOTICON_SOURCE_PX / 2}
      height={EMOTICON_SOURCE_PX / 2}
      draggable={false}
      className="block flex-none [image-rendering:pixelated]"
    />
  );
}

/**
 * 말풍선의 이모티콘 (23번): 누르면 처음부터 다시 틀고 잠깐 1.5배(원본의 3배)로 키운다.
 * 자리를 차지하며 커지면 대화가 밀려 스크롤이 튀어서, 크기는 transform으로만 바꾼다. '동작 줄이기'면 멈춘 그림이 애니메이션 없이 커진다
 */
export function BubbleEmoticon({ emoticonKey, alignEnd }: { emoticonKey: MessageEmoticonKey; alignEnd: boolean }) {
  const [play, setPlay] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    if (!enlarged) return;
    const timer = window.setTimeout(() => setEnlarged(false), EMOTICON_ENLARGE_MS);
    return () => window.clearTimeout(timer);
  }, [enlarged, play]);
  return (
    <button
      type="button"
      aria-label={`이모티콘 ${emoticonLabelOf(emoticonKey)} 크게 다시 보기`}
      title="누르면 크게 다시 보여요"
      onClick={() => {
        setPlay((count) => count + 1);
        setEnlarged(true);
      }}
      className={cn(
        'relative block rounded-md motion-safe:transition-transform motion-safe:duration-200',
        alignEnd ? 'origin-bottom-right' : 'origin-bottom-left',
        enlarged && 'z-10 scale-150',
      )}
    >
      <EmoticonImage emoticonKey={emoticonKey} replay={play} />
    </button>
  );
}

/** 글자로 추천 줄 (23번): 입력창 위에 글에 맞는 이모티콘을 보이고, 누르면 고르기 창에서 고른 것과 같다 */
export function EmoticonSuggestions({ keys, onPick, onDismiss }: { keys: readonly MessageEmoticonKey[]; onPick: (key: MessageEmoticonKey) => void; onDismiss: () => void }) {
  const [activeKey, setActiveKey] = useState<MessageEmoticonKey | null>(null);
  return (
    <div role="group" aria-label="글자로 추천한 이모티콘" className="flex w-fit max-w-full items-center gap-1 rounded-md border border-line bg-surface-2 py-1 pr-1 pl-2.5">
      <span className="mr-1 flex-none text-cap text-ink-3">추천</span>
      <div className="flex min-w-0 gap-0.5 overflow-x-auto">
        {keys.map((key) => {
          const label = emoticonLabelOf(key);
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label} 이모티콘 고르기`}
              title={label}
              // 입력창 포커스를 지키려고 마우스로 누를 때는 포커스를 옮기지 않는다 (Tab으로 와서 Enter는 된다)
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveKey(key)}
              onMouseLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(key)}
              onBlur={() => setActiveKey(null)}
              onClick={() => onPick(key)}
              className="flex-none rounded-sm p-0.5 hover:bg-surface focus-visible:bg-surface"
            >
              <EmoticonImage emoticonKey={key} scale={1} still={activeKey !== key} />
            </button>
          );
        })}
      </div>
      <IconButton icon="x" label="추천 닫기 (Esc)" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={onDismiss} />
    </div>
  );
}

type PickerTab = 'favorite' | 'recent' | MessageEmoticonSetKey;

const FIRST_SET: MessageEmoticonSetKey = MESSAGE_EMOTICON_SETS[0].key;

/** 탭: 즐겨찾기(있을 때만) · 최근 · 묶음별 */
const pickerTabsOf = (hasFavorites: boolean): { key: PickerTab; label: string }[] => [
  ...(hasFavorites ? [{ key: 'favorite' as const, label: '즐겨찾기' }] : []),
  { key: 'recent', label: '최근' },
  ...MESSAGE_EMOTICON_SETS,
];

/**
 * 입력창의 '이모티콘' 버튼과 고르기 창. 탭은 즐겨찾기 · 최근 · 묶음별. 고르면 입력창 위에 미리 보이고, 보내기를 눌러야 간다.
 * '글에 작게 넣기'를 켜면 고른 것이 입력창 글에 ':키:'로 들어가고 말풍선에서 작은 그림이 된다 (23번). 여러 개를 넣도록 창을 닫지 않는다.
 * 최근 목록은 보낼 때 입력창이 쌓고(emoticonRecent), 즐겨찾기는 칸의 별로 바꾼다(emoticonFavorite). 둘 다 창을 열 때 읽는다.
 */
export function EmoticonPicker({
  employeeId,
  disabled,
  disabledReason,
  smallOnlyReason,
  onPick,
  onInsert,
}: {
  employeeId: number;
  disabled: boolean;
  disabledReason?: string;
  /** 있으면 큰 이모티콘은 고를 수 없고 글에 작게만 넣는다 (파일을 고른 때) */
  smallOnlyReason?: string;
  onPick: (key: MessageEmoticonKey) => void;
  onInsert: (key: MessageEmoticonKey) => void;
}) {
  const popover = usePopover<HTMLDivElement>();
  // 고르기 창에서는 멈춘 그림을 보여 주고, 올리거나 포커스한 것만 움직인다 (여러 개가 한꺼번에 움직이면 정신없다)
  const [activeKey, setActiveKey] = useState<MessageEmoticonKey | null>(null);
  const [recent, setRecent] = useState<MessageEmoticonKey[]>([]);
  const [favorites, setFavorites] = useState<MessageEmoticonKey[]>([]);
  const [tab, setTab] = useState<PickerTab>(FIRST_SET);
  const [smallChosen, setSmallChosen] = useState(false);
  const small = smallChosen || smallOnlyReason !== undefined;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const tabId = (key: PickerTab) => `${baseId}-tab-${key}`;
  const panelId = `${baseId}-panel`;
  const tabs = pickerTabsOf(favorites.length > 0);

  const toggle = () => {
    if (popover.open) {
      popover.setOpen(false);
      return;
    }
    const recentKeys = readRecentEmoticons(employeeId);
    const favoriteKeys = readFavoriteEmoticons(employeeId);
    setRecent(recentKeys);
    setFavorites(favoriteKeys);
    // 내용이 있는 첫 탭을 연다
    setTab(favoriteKeys.length > 0 ? 'favorite' : recentKeys.length > 0 ? 'recent' : FIRST_SET);
    setActiveKey(null);
    popover.setOpen(true);
  };

  const selectTab = (key: PickerTab) => {
    setTab(key);
    setActiveKey(null);
  };

  const toggleFavorite = (key: MessageEmoticonKey) => {
    const { keys: next, result } = toggleFavoriteEmoticon(employeeId, key);
    if (result === 'full') toast.error(`즐겨찾기는 ${EMOTICON_FAVORITE_MAX}개까지 둘 수 있어요`);
    if (result === 'failed') toast.error('이 브라우저에 즐겨찾기를 저장하지 못했어요');
    if (result !== 'added' && result !== 'removed') return;
    setFavorites(next);
    // 즐겨찾기 탭에서 마지막 하나를 빼면 탭이 사라지므로 최근으로 옮긴다
    if (next.length === 0 && tab === 'favorite') selectTab('recent');
  };

  // 탭 사이는 화살표·Home·End로 옮기고, 옮기면 바로 그 탭을 보여 준다 (WAI-ARIA 탭 패턴)
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const targets: Record<string, number> = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last };
    const next: number | undefined = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next].key);
    tabRefs.current[next]?.focus();
  };

  const keys: readonly MessageEmoticonKey[] =
    tab === 'favorite' ? favorites : tab === 'recent' ? recent : MESSAGE_EMOTICONS.filter((e) => e.set === tab).map((e) => e.key);
  const emptyText = tab === 'favorite' ? '그림의 별을 누르면 여기에 모여요' : '보낸 이모티콘이 여기에 모여요';

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
          className="absolute bottom-full left-5 z-30 mb-1 w-[380px] max-w-[calc(100%-2.5rem)] rounded-md border border-line bg-surface p-2 shadow-pop"
        >
          <div role="tablist" aria-label="이모티콘 묶음" className="flex gap-1 overflow-x-auto border-b border-line px-1">
            {tabs.map((item, index) => (
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
                className="-mb-px inline-flex h-8 flex-none items-center border-b-2 border-transparent px-2.5 text-xs font-medium text-ink-2 aria-selected:border-brand aria-selected:font-semibold aria-selected:text-brand"
              >
                {item.label}
              </button>
            ))}
          </div>
          {/* key: 탭을 바꾸면 스크롤을 맨 위로 되돌린다 */}
          <div key={tab} id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} className="mt-2 max-h-[320px] overflow-y-auto overscroll-contain">
            {keys.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-ink-3">{emptyText}</p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {keys.map((key) => {
                  const label = emoticonLabelOf(key);
                  const favorite = favorites.includes(key);
                  return (
                    // 별 버튼을 고르기 버튼 안에 둘 수 없어(버튼 안 버튼) 나란히 두고 칸 위에 겹친다
                    <div key={key} className="group/cell relative">
                      <button
                        type="button"
                        aria-label={small ? `${label} 글에 작게 넣기` : label}
                        title={label}
                        onMouseEnter={() => setActiveKey(key)}
                        onMouseLeave={() => setActiveKey(null)}
                        onFocus={() => setActiveKey(key)}
                        onBlur={() => setActiveKey(null)}
                        onClick={() => {
                          if (small) {
                            onInsert(key);
                            return;
                          }
                          popover.setOpen(false);
                          onPick(key);
                        }}
                        className="flex w-full flex-col items-center rounded-sm p-1 hover:bg-surface-2 focus-visible:bg-surface-2"
                      >
                        <EmoticonImage emoticonKey={key} scale={1} still={activeKey !== key} lazy />
                        <span className="break-keep text-center text-cap text-ink-3">{label}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={favorite}
                        aria-label={favorite ? `${label} 즐겨찾기에서 빼기` : `${label} 즐겨찾기에 더하기`}
                        title={favorite ? '즐겨찾기에서 빼기' : '즐겨찾기에 더하기'}
                        onClick={() => toggleFavorite(key)}
                        className={cn(
                          'absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-sm text-sm leading-none hover:bg-surface-3 focus-visible:opacity-100',
                          favorite ? 'text-wait' : 'text-ink-3 opacity-0 group-focus-within/cell:opacity-100 group-hover/cell:opacity-100',
                        )}
                      >
                        <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <label className="mt-2 flex items-start gap-1.5 border-t border-line px-1 pt-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={small}
              disabled={smallOnlyReason !== undefined}
              onChange={(event) => setSmallChosen(event.target.checked)}
              className="mt-0.5 accent-brand"
            />
            <span className="flex flex-col">
              <b className="font-medium">글에 작게 넣기</b>
              <span className="text-cap text-ink-3">{smallOnlyReason ?? '켜면 고른 그림이 글 사이에 작게 들어가요 (여러 개 넣을 수 있어요)'}</span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
