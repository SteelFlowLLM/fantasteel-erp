'use client';

// 방 위 공지 줄 (12번): 고정한 메시지 요약, 누르면 그 메시지로 이동, [내리기]
import { messengerApi, type ChatRoomDetailView } from '@/api/messenger';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';

export function PinnedNotice({ room, onJump }: { room: ChatRoomDetailView; onJump: (messageId: number) => void }) {
  const unpin = useAction(messengerApi.unpinMessage, { success: '공지를 내렸어요' });
  const pinned = room.pinnedMessage;
  if (!pinned) return null;
  return (
    <div className="flex flex-none items-center gap-2 border-b border-line bg-wait-bg/50 px-5 py-2 text-xs" aria-label="공지">
      <Icon name="pin" size="sm" className="flex-none text-wait" />
      <button type="button" onClick={() => onJump(pinned.id)} className="min-w-0 flex-1 truncate text-left hover:underline" title="공지 메시지로 이동">
        <b className="font-semibold">공지</b> · {pinned.preview} <span className="text-ink-3">· {pinned.senderName}</span>
      </button>
      <IconButton icon="x" label="공지 내리기" size="sm" disabled={unpin.isPending} onClick={() => unpin.mutate(room.id)} />
    </div>
  );
}
