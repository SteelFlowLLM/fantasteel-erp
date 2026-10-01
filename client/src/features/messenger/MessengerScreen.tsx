'use client';

// 메신저 /messenger[?room=<id>] (REQ-MSG-001~006, BP-MSG-01): 채팅방 목록 | 대화 | 방 정보
// 다른 탭에서 보낸 메시지는 가짜 DB의 탭 동기화로 바로 보인다 (REQ-MSG-002).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Spinner, StateView } from '@/components/StateView';
import { Conversation } from '@/features/messenger/components/Conversation';
import { NewRoomModal } from '@/features/messenger/components/RoomModals';
import { RoomList } from '@/features/messenger/components/RoomList';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useChatRoomList } from '@/hooks/useMessenger';

export function MessengerScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const roomParam = Number(params.get('room'));
  const chatRoomId = Number.isInteger(roomParam) && roomParam > 0 ? roomParam : null;
  const rooms = useChatRoomList();
  const [creating, setCreating] = useState(false);
  const [asideOpen, setAsideOpen] = useState(true);

  const list = rooms.data ?? [];
  const current = list.find((room) => room.id === chatRoomId);
  const totalUnread = list.reduce((sum, room) => sum + room.unreadCount, 0);
  useShellTitle(undefined, current ? current.displayName : rooms.data ? `채팅방 ${list.length}개 · 안 읽음 ${totalUnread}` : undefined);

  const openRoom = (id: number) => router.replace(`${pathname}?room=${id}`);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {rooms.data ? (
        <RoomList rooms={list} activeId={chatRoomId} onSelect={openRoom} onNew={() => setCreating(true)} />
      ) : (
        <section className="flex w-80 flex-none flex-col border-r border-line bg-surface">
          {rooms.error ? <StateView kind="error" title="채팅방을 불러오지 못했어요" actions={<Button size="sm" onClick={() => void rooms.refetch()}>다시 시도</Button>} /> : <Spinner className="py-10" />}
        </section>
      )}
      {chatRoomId !== null ? (
        <Conversation key={chatRoomId} chatRoomId={chatRoomId} asideOpen={asideOpen} onToggleAside={() => setAsideOpen((open) => !open)} />
      ) : (
        <div className="flex min-w-0 flex-1 bg-surface">
          <StateView
            kind="empty"
            icon="chat"
            title="채팅방을 골라 주세요"
            text="왼쪽 목록에서 방을 고르거나 새 채팅방을 만들어 보세요"
            actions={
              <Button variant="primary" icon="plus" size="sm" onClick={() => setCreating(true)}>
                새 채팅방
              </Button>
            }
          />
        </div>
      )}
      {creating ? (
        <NewRoomModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openRoom(id);
          }}
        />
      ) : null}
    </div>
  );
}
