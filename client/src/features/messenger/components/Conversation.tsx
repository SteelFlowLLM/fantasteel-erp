'use client';

// 대화 영역: 방 머리 · 업무방 수주 정보 · 메시지 · 입력창 (REQ-MSG-001~006)
// 새 메시지 구분선: 방을 연 순간의 읽음 위치 뒤 첫 남의 메시지 위. 열자마자 읽음 처리돼도 남기고, 내가 보내면 지운다.
// 읽음 처리(REQ-MSG-004): 창을 보고 있고 맨 아래까지 봤을 때 남이 보낸 마지막 메시지까지 읽은 것으로 한다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAT_ROOM_TYPE_LABEL } from '@/codes';
import { isServerDataSource } from '@/api/http';
import { MESSAGE_PAGE_SIZE, type ChatRoomDetailView } from '@/api/messenger';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Spinner, StateView } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { Composer } from '@/features/messenger/components/Composer';
import { MessageBubble } from '@/features/messenger/components/MessageBubble';
import { DeleteMessageDialog, EditMessageModal } from '@/features/messenger/components/MessageEditActions';
import { OutboxBubble } from '@/features/messenger/components/OutboxBubble';
import { PinnedNotice } from '@/features/messenger/components/PinnedNotice';
import { RoomAside } from '@/features/messenger/components/RoomAside';
import { PresenceDot, useIsOnline } from '@/features/messenger/components/Presence';
import { RoomIcon } from '@/features/messenger/components/RoomIcon';
import { RoomSettingsButtons } from '@/features/messenger/components/RoomSettings';
import { InviteModal, RenameRoomModal } from '@/features/messenger/components/RoomModals';
import { WorkRoomPin } from '@/features/messenger/components/WorkRoomSalesOrder';
import { formatDayLabel } from '@/features/messenger/lib/dayLabel';
import { firstUnreadId, layoutMessages } from '@/features/messenger/lib/messageGroups';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/useToastStore';
import { useChatMessages, useChatRoom, useMarkRoomRead, useMessageOutbox } from '@/hooks/useMessenger';
import { useMessageComposeStore } from '@/stores/useMessageComposeStore';
import { typingText, useMessengerLiveStore } from '@/stores/useMessengerLiveStore';

const NO_TYPING: readonly never[] = [];
/** 이동한 메시지를 강조하는 시간 */
const HIGHLIGHT_MS = 2500;

/** 맨 아래로 볼 때의 여유 (px) */
const BOTTOM_SLACK = 48;

function buildRoomCaption(room: ChatRoomDetailView): string {
  const others = room.members.filter((m) => !m.isMe);
  if (room.chatRoomType === 'DIRECT') {
    const other = others[0];
    return other ? `${CHAT_ROOM_TYPE_LABEL.DIRECT} · ${other.departmentName} · ${other.jobGradeName}` : CHAT_ROOM_TYPE_LABEL.DIRECT;
  }
  if (room.chatRoomType === 'WORK') return `수주 연결 ${CHAT_ROOM_TYPE_LABEL.WORK} · 멤버 ${room.members.length}`;
  const departments = [...new Set(room.members.map((m) => m.departmentName))];
  return `${CHAT_ROOM_TYPE_LABEL.GROUP} · ${departments.slice(0, 3).join(', ')}${departments.length > 3 ? ' 외' : ''} · 멤버 ${room.members.length}`;
}

interface JumpProps {
  /** 이 메시지까지 스크롤해 잠깐 강조한다 (알림·검색에서 이동) */
  focusMessageId: number | null;
  /** 검색 결과를 눌렀을 때 */
  onJump: (messageId: number) => void;
  /** 이동이 끝났거나 찾지 못했을 때 (주소에서 message를 지운다) */
  onFocusDone: () => void;
}

export function Conversation({ chatRoomId, asideOpen, onToggleAside, onLeft, ...jump }: { chatRoomId: number; asideOpen: boolean; onToggleAside: () => void; onLeft: () => void } & JumpProps) {
  const room = useChatRoom(chatRoomId);
  return (
    <QueryBoundary query={room} loadingLabel="채팅방을 불러오는 중…">
      {(data) => <RoomView room={data} asideOpen={asideOpen} onToggleAside={onToggleAside} onLeft={onLeft} {...jump} />}
    </QueryBoundary>
  );
}

function RoomView({
  room,
  asideOpen,
  onToggleAside,
  onLeft,
  focusMessageId,
  onJump,
  onFocusDone,
}: { room: ChatRoomDetailView; asideOpen: boolean; onToggleAside: () => void; onLeft: () => void } & JumpProps) {
  const me = useMe();
  const [limit, setLimit] = useState(MESSAGE_PAGE_SIZE);
  const [inviting, setInviting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const messages = useChatMessages(room.id, limit);
  const outbox = useMessageOutbox(room.id);
  const editing = useMessageComposeStore((state) => (state.editing?.chatRoomId === room.id ? state.editing : null));
  const deleting = useMessageComposeStore((state) => (state.deleting?.chatRoomId === room.id ? state.deleting : null));
  const counterpartId = room.chatRoomType === 'DIRECT' ? (room.members.find((m) => !m.isMe)?.id ?? null) : null;
  const counterpartOnline = useIsOnline(counterpartId);
  const typing = typingText(useMessengerLiveStore((state) => state.typing[room.id] ?? NO_TYPING));
  const { mutate: markRead } = useMarkRoomRead();
  const feedRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [focused, setFocused] = useState(() => typeof document !== 'undefined' && document.hasFocus());
  /** 이전 메시지를 더 불러올 때 보던 자리를 지키려고 기억하는 스크롤 높이 */
  const keepFromHeight = useRef<number | null>(null);
  const lastMarkedId = useRef<number>(0);
  const initialScrollDone = useRef(false);
  const dividerRef = useRef<HTMLDivElement>(null);
  /** 방을 연 순간의 읽음 위치. 안 읽은 메시지가 없었거나 내가 보낸 뒤면 null */
  const [readBaseline, setReadBaseline] = useState<number | null>(() => (room.unreadCount > 0 ? (room.lastReadMessageId ?? 0) : null));

  const items = useMemo(() => messages.data?.items ?? [], [messages.data]);
  const lastId = items.at(-1)?.id ?? 0;
  const lastOthersId = [...items].reverse().find((m) => !m.isMine)?.id ?? 0;
  const newDividerId = readBaseline === null ? null : firstUnreadId(items, readBaseline);
  const layout = useMemo(() => layoutMessages(items, newDividerId), [items, newDividerId]);

  const mentionNames = useMemo(() => [...room.mentionTargets.map((t) => t.name), me.employeeName, me.departmentName], [room.mentionTargets, me.employeeName, me.departmentName]);
  const myNames = useMemo(() => [me.employeeName, me.departmentName], [me.employeeName, me.departmentName]);

  const scrollToBottom = useCallback(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, []);

  // 새 메시지가 오면 맨 아래를 보고 있을 때만 따라 내려간다. 이전 메시지를 불러왔으면 보던 자리를 지킨다.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (!initialScrollDone.current && items.length > 0) {
      // 처음 열 때: 새 메시지 구분선이 있으면 그 자리를 위쪽에 보여 준다
      initialScrollDone.current = true;
      const divider = dividerRef.current;
      if (divider) feed.scrollTop = divider.offsetTop - 8;
      else scrollToBottom();
      const bottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= BOTTOM_SLACK;
      atBottomRef.current = bottom;
      setAtBottom(bottom);
    } else if (keepFromHeight.current !== null) {
      feed.scrollTop += feed.scrollHeight - keepFromHeight.current;
      keepFromHeight.current = null;
    } else if (atBottomRef.current) {
      scrollToBottom();
    }
  }, [lastId, items.length, outbox.items.length, scrollToBottom]);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // 읽음 처리: 보고 있고(창 포커스 + 맨 아래) 읽지 않은 남의 메시지가 있을 때만
  useEffect(() => {
    if (!focused || !atBottom || !atBottomRef.current || lastOthersId === 0) return;
    if (lastOthersId <= (room.lastReadMessageId ?? 0) || lastOthersId <= lastMarkedId.current) return;
    lastMarkedId.current = lastOthersId;
    markRead({ chatRoomId: room.id, lastMessageId: lastOthersId });
  }, [focused, atBottom, lastOthersId, room.id, room.lastReadMessageId, markRead]);

  // 메시지로 이동: 지금 불러온 범위에 없으면 이전 메시지를 더 불러오고, 있으면 가운데로 스크롤해 잠깐 강조한다
  const [highlightId, setHighlightId] = useState<number | null>(null);
  useEffect(() => {
    if (focusMessageId === null || !messages.data || messages.isFetching) return;
    const target = feedRef.current?.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      onScroll();
      setHighlightId(focusMessageId);
      onFocusDone();
      return;
    }
    if (messages.data.hasMore) {
      setLimit((current) => current + MESSAGE_PAGE_SIZE);
      return;
    }
    toast.info('메시지를 찾을 수 없어요');
    onFocusDone();
    // onScroll·onFocusDone은 렌더마다 새로 만들어져 의존성에서 뺀다 (메시지·대상이 바뀔 때만 다시 본다)
  }, [focusMessageId, messages.data, messages.isFetching]);
  useEffect(() => {
    if (highlightId === null) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const onScroll = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const bottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= BOTTOM_SLACK;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  };

  const loadOlder = () => {
    keepFromHeight.current = feedRef.current?.scrollHeight ?? null;
    setLimit((current) => current + MESSAGE_PAGE_SIZE);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface" aria-label={`${room.displayName} 대화`}>
        <header className="flex flex-none items-center gap-2.5 border-b border-line px-5 py-3">
          <span className="relative flex-none">
            <RoomIcon chatRoomType={room.chatRoomType} name={room.displayName} size="lg" />
            <PresenceDot employeeId={counterpartId} />
          </span>
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-lg font-semibold">{room.displayName}</b>
            <span className="truncate text-cap text-ink-3">
              {buildRoomCaption(room)}
              {counterpartOnline === null ? null : counterpartOnline ? ' · 접속 중' : ' · 접속 안 함'}
            </span>
          </div>
          <div className="ml-auto flex flex-none items-center gap-1.5">
            {room.chatRoomType === 'WORK' ? (
              <Tag tone="brand" size="sm">
                수주 연결 업무방
              </Tag>
            ) : null}
            {room.canInvite ? (
              <Button size="sm" icon="users" onClick={() => setInviting(true)}>
                멤버 초대
              </Button>
            ) : null}
            <RoomSettingsButtons room={room} onLeft={onLeft} />
            <IconButton icon="panel" label={asideOpen ? '방 정보 닫기' : '방 정보 열기'} aria-pressed={asideOpen} onClick={onToggleAside} />
          </div>
        </header>
        <WorkRoomPin room={room} />
        <PinnedNotice room={room} onJump={onJump} />
        <div ref={feedRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto py-2">
          {messages.isPending ? <Spinner className="py-10" /> : null}
          {messages.error ? <StateView kind="error" title="메시지를 불러오지 못했어요" /> : null}
          {messages.data ? (
            <>
              <div className="flex justify-center py-2">
                {messages.data.hasMore ? (
                  <Button size="sm" variant="ghost" disabled={messages.isFetching} onClick={loadOlder}>
                    {messages.isFetching ? '불러오는 중…' : '이전 메시지 더 보기'}
                  </Button>
                ) : items.length > 0 ? (
                  <span className="text-cap text-ink-3">대화의 처음이에요</span>
                ) : null}
              </div>
              {items.length === 0 && outbox.items.length === 0 ? <StateView kind="empty" icon="chat" title="아직 메시지가 없어요" text="첫 메시지를 보내 보세요" /> : null}
              {items.map((message, index) => {
                const { showDay, showNewDivider, isGroupStart, isGroupEnd } = layout[index];
                return (
                  <div key={message.id} data-message-id={message.id} className={cn('transition-colors duration-700', highlightId === message.id && 'bg-brand-tint')}>
                    {showDay ? (
                      <div className="flex items-center gap-3 px-5 py-2 text-cap font-medium text-ink-3" role="separator">
                        <span className="h-px flex-1 bg-line" />
                        {formatDayLabel(message.createdAt)}
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    ) : null}
                    {showNewDivider ? (
                      <div ref={dividerRef} className="flex items-center gap-3 px-5 py-2 text-cap font-semibold text-danger" role="separator">
                        <span className="h-px flex-1 bg-danger/40" />
                        여기부터 새 메시지
                        <span className="h-px flex-1 bg-danger/40" />
                      </div>
                    ) : null}
                    <MessageBubble
                      message={message}
                      room={room}
                      mentionNames={mentionNames}
                      myNames={myNames}
                      isGroupStart={isGroupStart}
                      isGroupEnd={isGroupEnd}
                      onJumpToMessage={onJump}
                    />
                  </div>
                );
              })}
              {outbox.items.map((item) => (
                <OutboxBubble key={item.localId} item={item} onRetry={() => outbox.retry(item.localId)} onDiscard={() => outbox.discard(item.localId)} />
              ))}
            </>
          ) : null}
        </div>
        {!atBottom && room.unreadCount > 0 ? (
          <div className="relative">
            <Button
              size="sm"
              variant="primary"
              className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full shadow-pop"
              onClick={() => {
                scrollToBottom();
                onScroll();
              }}
            >
              새 메시지 {room.unreadCount}건
            </Button>
          </div>
        ) : null}
        {/* 입력 중 줄은 높이를 미리 잡아 두어 표시가 생겨도 대화가 밀리지 않게 한다 (서버 모드만) */}
        {isServerDataSource() ? (
          <div className="h-5 flex-none px-5 text-cap text-ink-3" aria-live="polite">
            {typing}
          </div>
        ) : null}
        <Composer
          room={room}
          onSent={() => {
            setReadBaseline(null);
            atBottomRef.current = true;
            setAtBottom(true);
          }}
        />
      </section>
      {asideOpen ? <RoomAside room={room} onInvite={() => setInviting(true)} onRename={() => setRenaming(true)} onJump={onJump} /> : null}
      {inviting ? <InviteModal room={room} onClose={() => setInviting(false)} /> : null}
      {renaming ? <RenameRoomModal room={room} onClose={() => setRenaming(false)} /> : null}
      {editing ? <EditMessageModal message={editing} onClose={() => useMessageComposeStore.getState().setEditing(null)} /> : null}
      {deleting ? <DeleteMessageDialog message={deleting} onClose={() => useMessageComposeStore.getState().setDeleting(null)} /> : null}
    </div>
  );
}
