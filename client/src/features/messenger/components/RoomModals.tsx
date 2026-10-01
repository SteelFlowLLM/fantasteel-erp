'use client';

// 새 채팅방(1:1·그룹)과 멤버 초대 창. 멤버는 조직도에서 고른다 (REQ-MSG-001, REQ-ORG-004).
// 업무방은 수주 1건에 1개씩 수주 상세에서 연다.
import { useState } from 'react';
import { CHAT_ROOM_TYPE_LABEL } from '@/codes';
import { InputError } from '@/api/client';
import { CHAT_ROOM_NAME_MAX, messengerApi, type ChatRoomDetailView } from '@/api/messenger';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Segmented } from '@/components/Tabs';
import { MemberPicker } from '@/features/messenger/components/MemberPicker';
import { useAction } from '@/hooks/useAction';
import { useMe } from '@/hooks/useMe';

type NewRoomType = 'DIRECT' | 'GROUP';

export function NewRoomModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const me = useMe();
  const [chatRoomType, setChatRoomType] = useState<NewRoomType>('DIRECT');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [chatRoomName, setChatRoomName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const create = useAction(messengerApi.createRoom, {
    success: (result) => (result.reused ? '이미 있는 1:1 채팅방을 열었어요' : '채팅방을 만들었어요'),
    onSuccess: (result) => onCreated(result.id),
    onError: (error) => setFieldErrors(error instanceof InputError ? error.fieldErrors : {}),
  });
  const valid = chatRoomType === 'DIRECT' ? memberIds.length === 1 : memberIds.length >= 1;

  return (
    <Modal
      title="새 채팅방"
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-cap text-ink-3">
            {chatRoomType === 'DIRECT' ? '같은 상대와의 1:1 채팅방이 이미 있으면 그 방이 열려요' : `${memberIds.length}명 선택 · 나는 자동으로 들어가요`}
          </span>
          <Button onClick={onClose} disabled={create.isPending}>
            취소
          </Button>
          <Button
            variant="primary"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate({ chatRoomType, memberIds, chatRoomName: chatRoomType === 'GROUP' ? chatRoomName : null })}
          >
            {create.isPending ? '만드는 중…' : '대화 시작'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">채팅방 유형</span>
        <Segmented
          ariaLabel="채팅방 유형"
          className="self-start"
          active={chatRoomType}
          onChange={(next) => {
            setChatRoomType(next);
            if (next === 'DIRECT') setMemberIds((current) => current.slice(0, 1));
          }}
          items={[
            { key: 'DIRECT', label: CHAT_ROOM_TYPE_LABEL.DIRECT },
            { key: 'GROUP', label: CHAT_ROOM_TYPE_LABEL.GROUP },
          ]}
        />
      </div>
      {chatRoomType === 'GROUP' ? (
        <Field label="방 이름" htmlFor="new-room-name" hint={`비워 두면 멤버 이름으로 보여요 (${CHAT_ROOM_NAME_MAX}자까지)`} error={fieldErrors.chatRoomName}>
          <Input id="new-room-name" value={chatRoomName} maxLength={CHAT_ROOM_NAME_MAX} placeholder="예: 출하 조율" onChange={(event) => setChatRoomName(event.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">
          {chatRoomType === 'DIRECT' ? '대화 상대 (1명)' : '멤버 (1명 이상)'}
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </span>
        <MemberPicker single={chatRoomType === 'DIRECT'} selected={memberIds} onChange={setMemberIds} excludeIds={[me.employeeId]} />
        {fieldErrors.memberIds ? (
          <span role="alert" className="text-cap text-danger">
            {fieldErrors.memberIds}
          </span>
        ) : null}
      </div>
      <Banner tone="neutral">업무방은 수주 1건에 1개씩 연결되는 방이라 여기서 만들지 않아요. 수주 상세에서 열어요</Banner>
    </Modal>
  );
}

export function InviteModal({ room, onClose }: { room: ChatRoomDetailView; onClose: () => void }) {
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const invite = useAction(messengerApi.inviteMembers, { success: '멤버를 초대했어요', onSuccess: onClose });
  return (
    <Modal
      title={`멤버 초대 · ${room.displayName}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-cap text-ink-3">새 멤버도 이전 대화를 볼 수 있어요</span>
          <Button onClick={onClose} disabled={invite.isPending}>
            취소
          </Button>
          <Button variant="primary" disabled={memberIds.length === 0 || invite.isPending} onClick={() => invite.mutate({ chatRoomId: room.id, memberIds })}>
            {invite.isPending ? '초대하는 중…' : `${memberIds.length}명 초대`}
          </Button>
        </>
      }
    >
      <MemberPicker selected={memberIds} onChange={setMemberIds} lockedIds={room.members.map((m) => m.id)} />
    </Modal>
  );
}
