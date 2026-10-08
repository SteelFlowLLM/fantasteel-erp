'use client';

// 내 방 설정 버튼 (14번, 문서에 없는 추가 기능): 목록 위 고정·알림 끄기. 나에게만 적용된다.
// 알림을 끄면 업무방 새 메시지 알림을 받지 않고 메신저 배지 합계에서 빠진다. 멘션 알림은 그대로 받는다.
import { messengerApi, type ChatRoomDetailView } from '@/api/messenger';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/useToastStore';

export function RoomSettingsButtons({ room }: { room: ChatRoomDetailView }) {
  const update = useAction(messengerApi.updateSettings, {
    onSuccess: (_data, input) => toast.ok(input.muted === undefined ? (input.pinned ? '목록 위에 고정했어요' : '고정을 풀었어요') : input.muted ? '이 방 알림을 껐어요 · 멘션은 받아요' : '이 방 알림을 켰어요'),
  });
  const pinned = room.pinnedAt !== null;
  return (
    <>
      <IconButton
        icon="pin"
        label={pinned ? '목록 고정 풀기' : '목록 위에 고정'}
        aria-pressed={pinned}
        disabled={update.isPending}
        className={cn(pinned && 'text-brand')}
        onClick={() => update.mutate({ chatRoomId: room.id, pinned: !pinned })}
      />
      <IconButton
        icon="bell"
        label={room.muted ? '알림 켜기 (지금 꺼짐)' : '알림 끄기'}
        aria-pressed={room.muted}
        disabled={update.isPending}
        className={cn(room.muted && 'opacity-40')}
        onClick={() => update.mutate({ chatRoomId: room.id, muted: !room.muted })}
      />
    </>
  );
}
