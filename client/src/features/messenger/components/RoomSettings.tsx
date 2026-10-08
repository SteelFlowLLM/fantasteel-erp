'use client';

// 내 방 설정 버튼 (14번, 문서에 없는 추가 기능): 목록 위 고정·알림 끄기. 나에게만 적용된다. 방 나가기(15번)도 여기 둔다.
// 알림을 끄면 업무방 새 메시지 알림을 받지 않고 메신저 배지 합계에서 빠진다. 멘션 알림은 그대로 받는다.
import { useState } from 'react';
import { messengerApi, type ChatRoomDetailView } from '@/api/messenger';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/hooks/useAction';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/useToastStore';

export function RoomSettingsButtons({ room, onLeft }: { room: ChatRoomDetailView; onLeft: () => void }) {
  const [leaving, setLeaving] = useState(false);
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
      {room.chatRoomType === 'DIRECT' ? null : <IconButton icon="logout" label="방 나가기" onClick={() => setLeaving(true)} />}
      {leaving ? <LeaveRoomDialog room={room} onClose={() => setLeaving(false)} onLeft={onLeft} /> : null}
    </>
  );
}

/** 방 나가기 확인. 1:1 방은 버튼이 없다 */
function LeaveRoomDialog({ room, onClose, onLeft }: { room: ChatRoomDetailView; onClose: () => void; onLeft: () => void }) {
  const leave = useAction(messengerApi.leaveRoom, {
    success: '채팅방에서 나왔어요',
    onSuccess: () => {
      onClose();
      onLeft();
    },
  });
  return (
    <ConfirmDialog title="방 나가기" confirmLabel="나가기" tone="danger" pending={leave.isPending} onConfirm={() => leave.mutate(room.id)} onCancel={onClose}>
      &lsquo;{room.displayName}&rsquo;에서 나갈까요? 목록에서 사라지고 남은 멤버에게 나갔다고 알려요.
      {room.chatRoomType === 'WORK' ? ' 업무방은 수주 화면에서 다시 열면 돌아올 수 있어요.' : ' 다시 들어오려면 멤버가 초대해야 해요.'}
    </ConfirmDialog>
  );
}
