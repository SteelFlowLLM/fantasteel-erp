'use client';

// 상단 메신저 버튼 (SPEC 4장 1번): 누르면 최근 대화 드롭다운. 항목·메신저 열기는 왼쪽 메뉴 '메신저' 화면으로 간다.
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { CountBadge } from '@/components/Badge';
import { IconButton } from '@/components/IconButton';
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
        <PopPanel label="최근 대화">
          <PopHead title="메신저" meta={`안 읽음 ${unread}건`} />
          <PopList>
            {recent.isPending ? <PopNote>불러오는 중…</PopNote> : null}
            {recent.data?.map((room) => (
              <PopItem key={room.id} unread={room.unreadCount > 0} onClick={() => go(`/messenger?room=${room.id}`)}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="truncate text-sm font-semibold">{room.displayName}</b>
                  <span className="truncate text-xs text-ink-3">{room.lastMessagePreview ?? '아직 대화가 없어요'}</span>
                </span>
                <span className="flex flex-none flex-col items-end gap-1">
                  <time className="text-cap text-ink-3">{room.lastMessageAt ? relTime(room.lastMessageAt) : ''}</time>
                  <CountBadge count={room.unreadCount} placement="inline" />
                </span>
              </PopItem>
            ))}
            {recent.data && recent.data.length === 0 ? <PopNote>참여 중인 대화가 없어요</PopNote> : null}
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
