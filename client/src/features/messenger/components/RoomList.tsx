'use client';

// 채팅방 목록 (REQ-MSG-001 유형, REQ-MSG-004 안 읽은 수). 최근 대화 순, 검색·유형 필터.
import { useMemo, useState } from 'react';
import { CHAT_ROOM_TYPE_LABEL, type ChatRoomType } from '@/codes';
import type { ChatRoomListItem } from '@/api/messenger';
import { CountBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { EmptyNote } from '@/components/StateView';
import { Segmented } from '@/components/Tabs';
import { Tag } from '@/components/Tag';
import { RoomIcon } from '@/features/messenger/components/RoomIcon';
import { formatShortTime } from '@/features/messenger/lib/dayLabel';
import { cn } from '@/lib/cn';
import { fmtMD } from '@/lib/format';

type RoomFilter = 'all' | 'unread' | ChatRoomType;

const GROUP_ORDER: readonly ChatRoomType[] = ['WORK', 'GROUP', 'DIRECT'];

function matches(room: ChatRoomListItem, keyword: string): boolean {
  if (!keyword) return true;
  const haystack = [room.displayName, room.salesOrder?.salesOrderNo, room.salesOrder?.customerName, room.lastMessage?.preview, ...room.memberNames]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

export function RoomList({ rooms, activeId, onSelect, onNew }: { rooms: ChatRoomListItem[]; activeId: number | null; onSelect: (id: number) => void; onNew: () => void }) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const totalUnread = rooms.reduce((sum, room) => sum + room.unreadCount, 0);
  const workCount = rooms.filter((room) => room.chatRoomType === 'WORK').length;
  const unreadRooms = rooms.filter((room) => room.unreadCount > 0).length;

  const visible = useMemo(
    () =>
      rooms
        .filter((room) => matches(room, keyword.trim()))
        .filter((room) => (filter === 'all' ? true : filter === 'unread' ? room.unreadCount > 0 : room.chatRoomType === filter)),
    [rooms, keyword, filter],
  );
  const grouped = filter === 'all' && !keyword.trim();

  return (
    <section className="flex min-h-0 w-80 flex-none flex-col border-r border-line bg-surface" aria-label="채팅방 목록">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <b className="text-lg font-semibold">채팅방</b>
          <span className="text-cap text-ink-3">
            {rooms.length}개 · 안 읽음 {totalUnread}
          </span>
          <Button size="sm" variant="primary" icon="plus" className="ml-auto" onClick={onNew}>
            새 채팅방
          </Button>
        </div>
        <Input leadingIcon="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="방 이름·수주번호·멤버 검색" aria-label="채팅방 검색" />
        <Segmented
          ariaLabel="채팅방 유형"
          className="self-start"
          active={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: '전체' },
            { key: 'unread', label: `안 읽음 ${unreadRooms}` },
            { key: 'DIRECT', label: CHAT_ROOM_TYPE_LABEL.DIRECT },
            { key: 'GROUP', label: CHAT_ROOM_TYPE_LABEL.GROUP },
            { key: 'WORK', label: `${CHAT_ROOM_TYPE_LABEL.WORK} ${workCount}` },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <EmptyNote className="py-10">
            {rooms.length === 0 ? '참여 중인 채팅방이 없어요 · [새 채팅방]으로 시작해 보세요' : '조건에 맞는 채팅방이 없어요'}
          </EmptyNote>
        ) : grouped ? (
          GROUP_ORDER.map((type) => {
            const group = visible.filter((room) => room.chatRoomType === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <div className="sticky top-0 z-[1] bg-surface-2 px-4 py-1.5 text-cap font-semibold text-ink-3">
                  {CHAT_ROOM_TYPE_LABEL[type]} {group.length}
                </div>
                {group.map((room) => (
                  <RoomRow key={room.id} room={room} active={room.id === activeId} showType={false} onSelect={onSelect} />
                ))}
              </div>
            );
          })
        ) : (
          visible.map((room) => <RoomRow key={room.id} room={room} active={room.id === activeId} showType onSelect={onSelect} />)
        )}
      </div>
    </section>
  );
}

function RoomRow({ room, active, showType, onSelect }: { room: ChatRoomListItem; active: boolean; showType: boolean; onSelect: (id: number) => void }) {
  const last = room.lastMessage;
  const lastLine = last ? `${last.isMine ? '나' : last.senderName}: ${last.preview}` : '아직 대화가 없어요';
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(room.id)}
      className={cn('flex w-full gap-2.5 border-b border-line px-4 py-2.5 text-left hover:bg-surface-2', active && 'bg-brand-tint hover:bg-brand-tint')}
    >
      <RoomIcon chatRoomType={room.chatRoomType} name={room.displayName} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <b className={cn('min-w-0 truncate text-sm', room.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{room.displayName}</b>
          {showType ? (
            <Tag size="sm" tone={room.chatRoomType === 'WORK' ? 'brand' : 'neutral'}>
              {CHAT_ROOM_TYPE_LABEL[room.chatRoomType]}
            </Tag>
          ) : null}
          <time className="ml-auto flex-none text-cap text-ink-3">{formatShortTime(last?.createdAt ?? room.createdAt)}</time>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{lastLine}</span>
          <CountBadge count={room.unreadCount} placement="inline" />
        </span>
        {room.salesOrder ? (
          <span className="truncate text-cap text-ink-3">
            {room.salesOrder.customerName}
            {room.salesOrder.dueDate ? ` · 납기 ${fmtMD(room.salesOrder.dueDate)}` : ''} · 멤버 {room.memberCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}
