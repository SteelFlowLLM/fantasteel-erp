'use client';

// 상단 메신저 버튼 (SPEC 4장 1번): 누르면 최근 채팅방 드롭다운. 항목·메신저 열기는 왼쪽 메뉴 '메신저' 화면으로 간다.
// 숫자는 가짜 DB 변경(이 탭·다른 탭)마다 다시 읽어 실시간으로 바뀐다 (REQ-MSG-002·004).
import { useRouter } from 'next/navigation';
import { CHAT_ROOM_TYPE_LABEL } from '@/codes';
import { CountBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { Tag } from '@/components/Tag';
import { RoomIcon } from '@/features/messenger/components/RoomIcon';
import { PopFoot, PopHead, PopItem, PopList, PopNote, PopPanel } from '@/features/shell/PopPanel';
import { usePopover } from '@/hooks/usePopover';
import { useRecentChatRooms, useUnreadChatCount } from '@/hooks/useShellCounts';
import { relTime } from '@/lib/format';

export function MessengerMenu({ employeeId }: { employeeId: number }) {
  const popover = usePopover<HTMLDivElement>();
  const router = useRouter();
  const unread = useUnreadChatCount(employeeId).data ?? 0;
  const recent = useRecentChatRooms(employeeId, popover.open);

  const go = (href: string) => {
    popover.setOpen(false);
    router.push(href);
  };

  return (
    <div ref={popover.ref} className="relative">
      <IconButton
        icon="chat"
        iconSize="lg"
        label={`메신저 · 안 읽음 ${unread}건`}
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        onClick={() => popover.setOpen(!popover.open)}
      >
        <CountBadge count={unread} />
      </IconButton>
      {popover.open ? (
        <PopPanel label="최근 채팅방">
          <PopHead title="메신저" meta={`안 읽음 ${unread}건`} />
          <PopList>
            {recent.isPending ? <PopNote>불러오는 중…</PopNote> : null}
            {recent.error ? <PopNote>채팅방을 불러오지 못했어요</PopNote> : null}
            {recent.data?.map((room) => (
              <PopItem key={room.id} unread={room.unreadCount > 0} onClick={() => go(`/messenger?room=${room.id}`)}>
                <RoomIcon chatRoomType={room.chatRoomType} name={room.displayName} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <b className="truncate text-sm font-semibold">{room.displayName}</b>
                    {room.chatRoomType === 'WORK' ? (
                      <Tag size="sm" tone="brand" className="flex-none">
                        {CHAT_ROOM_TYPE_LABEL.WORK}
                      </Tag>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-ink-3">{room.lastMessagePreview ?? '아직 대화가 없어요'}</span>
                </span>
                <span className="flex flex-none flex-col items-end gap-1">
                  <time className="text-cap text-ink-3">{room.lastMessageAt ? relTime(room.lastMessageAt) : ''}</time>
                  <CountBadge count={room.unreadCount} placement="inline" tone={room.muted ? 'muted' : 'danger'} />
                </span>
              </PopItem>
            ))}
            {recent.data && recent.data.length === 0 ? <PopNote>참여 중인 채팅방이 없어요</PopNote> : null}
          </PopList>
          <PopFoot>
            <Button variant="ghost" size="sm" onClick={() => go('/messenger')}>
              메신저 열기
            </Button>
          </PopFoot>
        </PopPanel>
      ) : null}
    </div>
  );
}
