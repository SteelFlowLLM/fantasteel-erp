'use client';

// 메시지 한 개: 내 메시지는 오른쪽 말풍선, 남의 메시지는 왼쪽(보낸 사람·아바타). 본문(@멘션 강조, 업무 번호 링크, 작은 이모티콘)·첨부(그림은 미리보기)·ERP 이동 링크·메시지 메뉴(Message → ERP 확장 자리)
import Link from 'next/link';
import { useState } from 'react';
import { reactionLabel } from '@fantasteel/shared';
import { messengerApi, type ChatRoomDetailView, type MessageView } from '@/api/messenger';
import { Avatar } from '@/components/Avatar';
import { BubbleEmoticon, InlineEmoticon, ReactionGlyph } from '@/features/messenger/components/Emoticon';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { messageActionsFor } from '@/features/messenger/messageActions';
import { splitMessageText, type ErpLink } from '@/features/messenger/lib/messageText';
import { canOpenScreen, screenOfPath } from '@/features/shell/screens';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';
import { useImagePreview, useMessageFileDownload } from '@/hooks/useMessenger';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtHM } from '@/lib/format';

const getLinkLabel = (link: ErpLink): string => {
  if (link.href.startsWith('/sales-orders/')) return `수주 상세 ${link.text}`;
  if (link.href.startsWith('/purchase-requisitions/')) return `구매요청 보기 ${link.text}`;
  return `출하요청 보기 ${link.text}`;
};

/** 메뉴를 아래로 펼칠 때 필요한 높이 (항목 4개 정도) */
const MENU_SPACE_PX = 180;

const getFileExtension = (name: string) => (name.includes('.') ? name.split('.').pop()?.toUpperCase() ?? '' : '');

export function MessageBubble({
  message,
  room,
  mentionNames,
  myNames,
  isGroupStart = true,
  isGroupEnd = true,
  onJumpToMessage,
}: {
  message: MessageView;
  room: ChatRoomDetailView;
  mentionNames: readonly string[];
  myNames: readonly string[];
  /** 같은 사람이 이어 쓴 묶음의 첫 메시지: 이름·아바타를 붙인다 */
  isGroupStart?: boolean;
  /** 묶음의 마지막 메시지: 시각을 붙인다 */
  isGroupEnd?: boolean;
  /** 답글 원본을 누르면 그 메시지로 이동 */
  onJumpToMessage?: (messageId: number) => void;
}) {
  const me = useMe();
  const canOpen = (href: string) => {
    const screen = screenOfPath(href.split('?')[0]);
    return !screen || canOpenScreen(me, screen.access);
  };

  if (message.isSystem) {
    return (
      <div className="flex justify-center px-5 py-1.5">
        <span className="rounded-full bg-surface-3 px-3 py-1 text-xs text-ink-2">
          <b className="font-semibold">시스템</b> · {message.content ?? message.files[0]?.name} · {fmtHM(message.createdAt)}
        </span>
      </div>
    );
  }

  const mine = message.isMine;
  const segments = message.content ? splitMessageText(message.content, { mentionNames, myNames, links: message.erpLinks }) : [];
  const openableLinks = message.erpLinks.filter((link) => canOpen(link.href)).slice(0, 3);

  const parent = message.parent;
  const body = (
    <div className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {parent ? (
        <button
          type="button"
          onClick={() => onJumpToMessage?.(parent.id)}
          disabled={parent.isDeleted}
          title={parent.isDeleted ? undefined : '원본 메시지로 이동'}
          className="flex max-w-full flex-col rounded-md border-l-2 border-line-strong bg-surface-3 px-2.5 py-1 text-left text-cap text-ink-2 enabled:hover:bg-surface-2"
        >
          <b className="font-semibold">{parent.senderName}님에게 답장</b>
          <span className="truncate text-ink-3">{parent.isDeleted ? '삭제된 메시지예요' : parent.preview}</span>
        </button>
      ) : null}
      {message.isDeleted ? (
        <p className={cn('rounded-lg border border-dashed border-line px-3 py-2 text-sm text-ink-3 italic')}>삭제된 메시지예요</p>
      ) : null}
      {message.emoticonKey ? <BubbleEmoticon emoticonKey={message.emoticonKey} alignEnd={mine} /> : null}
      {segments.length > 0 ? (
        <p
          className={cn(
            'max-w-full rounded-lg px-3 py-2 text-sm leading-normal break-words whitespace-pre-wrap',
            mine ? 'bg-brand text-on-brand' : 'border border-line bg-surface-2 text-ink',
            mine && isGroupEnd && 'rounded-br-xs',
            !mine && isGroupStart && 'rounded-tl-xs',
          )}
        >
          {segments.map((segment, index) => {
            if (segment.kind === 'mention') {
              return (
                <span
                  key={index}
                  className={cn('rounded-xs px-0.5 font-semibold', mine ? 'bg-white/20 text-on-brand' : segment.isMe ? 'bg-wait-bg text-wait' : 'bg-run-bg text-run')}
                >
                  {segment.text}
                </span>
              );
            }
            if (segment.kind === 'emoticon') return <InlineEmoticon key={index} emoticonKey={segment.key} />;
            if (segment.kind === 'link') {
              return canOpen(segment.href) ? (
                <Link
                  key={index}
                  href={segment.href}
                  className={cn('font-mono font-semibold underline-offset-2', mine ? 'text-on-brand underline' : 'text-brand hover:underline')}
                >
                  {segment.text}
                </Link>
              ) : (
                <span key={index} className="font-mono" title="이 화면을 열 권한이 없어요">
                  {segment.text}
                </span>
              );
            }
            return <span key={index}>{segment.text}</span>;
          })}
        </p>
      ) : null}
      {message.files.length > 0 ? (
        <div className={cn('flex max-w-full flex-wrap gap-1.5', message.isMine && 'justify-end')}>
          {message.files.map((file) => (
            <FileChip key={file.id} messageId={message.id} fileId={file.id} name={file.name} size={file.size} />
          ))}
        </div>
      ) : null}
      {message.reactions.length > 0 ? <ReactionChips message={message} /> : null}
      {openableLinks.length > 0 ? (
        <div className={cn('flex flex-wrap gap-x-3 gap-y-1', mine && 'justify-end')}>
          {openableLinks.map((link) => (
            <Link key={link.href} href={link.href} className="text-xs font-medium text-brand hover:underline">
              {getLinkLabel(link)} →
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
  // 안 읽은 사람 수는 메시지마다 달라 묶음 중간에도 보이고, 시각은 묶음 마지막에만 붙인다
  const unread =
    message.unreadMemberCount > 0 && !message.isDeleted ? (
      <span className="text-cap font-semibold text-brand" title={`아직 ${message.unreadMemberCount}명이 읽지 않았어요`} aria-label={`안 읽은 사람 ${message.unreadMemberCount}명`}>
        {message.unreadMemberCount}
      </span>
    ) : null;
  const time =
    unread || isGroupEnd || (message.editedAt && !message.isDeleted) ? (
      <span className={cn('flex flex-none flex-col pb-0.5', mine ? 'items-end' : 'items-start')}>
        {unread}
        {message.editedAt && !message.isDeleted ? <span className="text-cap text-ink-3">수정됨</span> : null}
        {isGroupEnd ? <time className="text-cap text-ink-3">{fmtHM(message.createdAt)}</time> : null}
      </span>
    ) : null;

  if (mine) {
    return (
      <div className={cn('group flex items-center justify-end gap-1.5 px-5', isGroupStart ? 'pt-2' : 'pt-0.5', isGroupEnd ? 'pb-1' : 'pb-0')}>
        <MessageMenu message={message} room={room} />
        <div className="flex max-w-[70%] min-w-0 items-end gap-1.5">
          {time}
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex gap-2.5 px-5',
        isGroupStart ? 'pt-2' : 'pt-0.5',
        isGroupEnd ? 'pb-1' : 'pb-0',
        message.mentionsMe && 'bg-wait-bg/60',
      )}
    >
      <span className="w-7 flex-none">{isGroupStart ? <Avatar name={message.senderName} tone="neutral" /> : null}</span>
      <div className="flex max-w-[70%] min-w-0 flex-col gap-1">
        {isGroupStart ? (
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <b className="text-sm font-semibold">{message.senderName}</b>
            <span className="text-cap text-ink-3">
              {message.senderDepartmentName} · {message.senderJobGradeName}
            </span>
          </div>
        ) : null}
        <div className="flex min-w-0 items-end gap-1.5">
          {body}
          {time}
        </div>
      </div>
      <span className="self-center">
        <MessageMenu message={message} room={room} />
      </span>
    </div>
  );
}

/** 말풍선 아래 반응 칩: 누르면 내 반응을 더하거나 뺀다, 올리면 누가 했는지 */
function ReactionChips({ message }: { message: MessageView }) {
  const toggle = useAction(messengerApi.toggleReaction);
  return (
    <div className={cn('flex flex-wrap gap-1', message.isMine && 'justify-end')} aria-label="반응">
      {message.reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          title={`${reactionLabel(reaction.emoji)} · ${reaction.employeeNames.join(', ')}`}
          aria-pressed={reaction.reactedByMe}
          aria-label={`${reactionLabel(reaction.emoji)} ${reaction.count}명${reaction.reactedByMe ? ', 내 반응 취소' : ', 반응 더하기'}`}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ messageId: message.id, emoji: reaction.emoji })}
          className={cn(
            'inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-xs',
            reaction.reactedByMe ? 'border-brand bg-brand-tint text-brand' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
          )}
        >
          <ReactionGlyph value={reaction.emoji} />
          <span className="font-semibold">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}

function FileChip({ messageId, fileId, name, size }: { messageId: number; fileId: number; name: string; size: number | null }) {
  const download = useMessageFileDownload();
  const preview = useImagePreview(messageId, fileId, name);
  const [enlarged, setEnlarged] = useState(false);
  if (preview.data) {
    const src = preview.data.dataUrl;
    return (
      <>
        <button type="button" onClick={() => setEnlarged(true)} className="block w-fit max-w-full overflow-hidden rounded-md border border-line bg-surface" title={`${name} 크게 보기`}>
          <img src={src} alt={name} className="block max-h-48 max-w-60 object-contain" />
        </button>
        {enlarged ? (
          <Modal
            title={name}
            width={880}
            onClose={() => setEnlarged(false)}
            footer={
              <>
                <span className="mr-auto self-center text-cap text-ink-3">{fmtBytes(size)}</span>
                <Button icon="download" disabled={download.isPending} onClick={() => download.mutate({ messageId, fileId, fileName: name })}>
                  내려받기
                </Button>
                <Button variant="primary" onClick={() => setEnlarged(false)}>
                  닫기
                </Button>
              </>
            }
          >
            <img src={src} alt={name} className="mx-auto block max-h-[70vh] max-w-full object-contain" />
          </Modal>
        ) : null}
      </>
    );
  }
  return (
    <div className="flex w-fit max-w-full items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
      <Icon name="file" className="text-ink-3" />
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-sm font-medium">{name}</b>
        <span className="text-cap text-ink-3">
          {fmtBytes(size)}
          {getFileExtension(name) ? ` · ${getFileExtension(name)}` : ''}
        </span>
      </span>
      <IconButton icon="download" label={`${name} 내려받기`} size="sm" disabled={download.isPending} onClick={() => download.mutate({ messageId, fileId, fileName: name })} />
    </div>
  );
}

/** 메시지 메뉴: messageActions.ts에 등록된 동작 (지금은 없음 → 버튼을 숨긴다) */
function MessageMenu({ message, room }: { message: MessageView; room: ChatRoomDetailView }) {
  const me = useMe();
  const popover = usePopover<HTMLDivElement>();
  // 아래 공간이 모자라면(대화 맨 아래 메시지 등) 위로 펼친다. 대화 영역이 스크롤 상자라 넘치면 잘린다
  const [openUp, setOpenUp] = useState(false);
  const actions = messageActionsFor(message, room, me);
  if (actions.length === 0) return null;
  const toggle = () => {
    const button = popover.ref.current;
    const box = button?.closest('.overflow-auto')?.getBoundingClientRect();
    if (button && box) setOpenUp(box.bottom - button.getBoundingClientRect().bottom < MENU_SPACE_PX);
    popover.setOpen(!popover.open);
  };
  return (
    <div ref={popover.ref} className={cn('relative flex-none', popover.open ? 'visible' : 'invisible group-hover:visible group-focus-within:visible')}>
      <IconButton icon="more" label="메시지 메뉴" size="sm" aria-haspopup="menu" aria-expanded={popover.open} onClick={toggle} className="bg-surface shadow-1" />
      {popover.open ? (
        <div
          role="menu"
          aria-label="메시지 메뉴"
          className={cn('absolute right-0 z-30 flex w-56 flex-col overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop', openUp ? 'bottom-8' : 'top-8')}
        >
          {actions.map(({ key, Component }) => (
            <Component key={key} message={message} room={room} closeMenu={() => popover.setOpen(false)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
