// 채팅방 아이콘: 1:1 = 상대 이름 첫 글자, 그룹 = #, 업무방 = 수주 아이콘
import type { ChatRoomType } from '@/codes';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';

export function RoomIcon({ chatRoomType, name, size = 'md' }: { chatRoomType: ChatRoomType; name: string; size?: 'md' | 'lg' }) {
  if (chatRoomType === 'DIRECT') return <Avatar name={name} size={size} tone="neutral" />;
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center rounded-full',
        size === 'lg' ? 'size-9' : 'size-7',
        chatRoomType === 'WORK' ? 'bg-brand-tint text-brand' : 'bg-surface-3 text-ink-2',
      )}
      aria-hidden="true"
    >
      <Icon name={chatRoomType === 'WORK' ? 'clipboard' : 'hash'} size="sm" />
    </span>
  );
}
