'use client';

// 메시지 한 개: 내 메시지는 오른쪽 말풍선, 남의 메시지는 왼쪽(보낸 사람·아바타). 본문(@멘션 강조, 업무 번호 링크)·첨부·ERP 이동 링크·메시지 메뉴(Message → ERP 확장 자리)
import Link from 'next/link';
import type { ChatRoomDetailView, MessageView } from '@/api/messenger';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { messageActionsFor } from '@/features/messenger/messageActions';
import { splitMessageText, type ErpLink } from '@/features/messenger/lib/messageText';
import { canOpenScreen, screenOfPath } from '@/features/shell/screens';
import { useMe } from '@/hooks/useMe';
import { useMessageFileDownload } from '@/hooks/useMessenger';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtHM } from '@/lib/format';

const getLinkLabel = (link: ErpLink): string => {
  if (link.href.startsWith('/sales-orders/')) return `수주 상세 ${link.text}`;
  if (link.href.startsWith('/purchase-requisitions/')) return `구매요청 보기 ${link.text}`;
  return `출하요청 보기 ${link.text}`;
};

const getFileExtension = (name: string) => (name.includes('.') ? name.split('.').pop()?.toUpperCase() ?? '' : '');

export function MessageBubble({
  message,
  room,
  mentionNames,
  myNames,
  isGroupStart = true,
  isGroupEnd = true,
}: {
  message: MessageView;
  room: ChatRoomDetailView;
  mentionNames: readonly string[];
  myNames: readonly string[];
  /** 같은 사람이 이어 쓴 묶음의 첫 메시지: 이름·아바타를 붙인다 */
  isGroupStart?: boolean;
  /** 묶음의 마지막 메시지: 시각을 붙인다 */
  isGroupEnd?: boolean;
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
          <b className="font-semibold">시스템</b> · {message.content ?? message.file?.name} · {fmtHM(message.createdAt)}
        </span>
      </div>
    );
  }

  const mine = message.isMine;
  const segments = message.content ? splitMessageText(message.content, { mentionNames, myNames, links: message.erpLinks }) : [];
  const openableLinks = message.erpLinks.filter((link) => canOpen(link.href)).slice(0, 3);

  const body = (
    <div className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
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
      {message.file ? <FileChip messageId={message.id} name={message.file.name} size={message.file.size} /> : null}
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
  const time = isGroupEnd ? <time className="flex-none pb-0.5 text-cap text-ink-3">{fmtHM(message.createdAt)}</time> : null;

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

function FileChip({ messageId, name, size }: { messageId: number; name: string; size: number | null }) {
  const download = useMessageFileDownload();
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
      <IconButton icon="download" label={`${name} 내려받기`} size="sm" disabled={download.isPending} onClick={() => download.mutate(messageId)} />
    </div>
  );
}

/** 메시지 메뉴: messageActions.ts에 등록된 동작 (지금은 없음 → 버튼을 숨긴다) */
function MessageMenu({ message, room }: { message: MessageView; room: ChatRoomDetailView }) {
  const me = useMe();
  const popover = usePopover<HTMLDivElement>();
  const actions = messageActionsFor(message, room, me);
  if (actions.length === 0) return null;
  return (
    <div ref={popover.ref} className={cn('relative flex-none', popover.open ? 'visible' : 'invisible group-hover:visible group-focus-within:visible')}>
      <IconButton icon="more" label="메시지 메뉴" size="sm" aria-haspopup="menu" aria-expanded={popover.open} onClick={() => popover.setOpen(!popover.open)} className="bg-surface shadow-1" />
      {popover.open ? (
        <div role="menu" aria-label="메시지 메뉴" className="absolute top-8 right-0 z-30 flex w-56 flex-col overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop">
          {actions.map(({ key, Component }) => (
            <Component key={key} message={message} room={room} closeMenu={() => popover.setOpen(false)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
