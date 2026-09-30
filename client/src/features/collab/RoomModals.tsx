// 새 대화 · 멤버 초대 · 그룹 나가기 모달. 멤버는 조직 정보에서 고른다 (REQ-MSG-001, REQ-ORG-004).
import { useState } from 'react';
import { messengerApi, type ChatRoomView } from '@/api/messenger';
import { Field, Modal } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { upsertRoom } from './chatCache';
import { MemberPicker } from './MemberPicker';

export function NewRoomModal({ myEmployeeId, onClose, onCreated }: { myEmployeeId: number; onClose: () => void; onCreated: (room: ChatRoomView) => void }) {
  const [type, setType] = useState<'DIRECT' | 'GROUP'>('DIRECT');
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const create = useAction(messengerApi.createRoom, {
    invalidate: ['chat-rooms'],
    onSuccess: (room) => {
      upsertRoom(room);
      onCreated(room);
    },
  });
  const valid = type === 'DIRECT' ? memberIds.length === 1 : memberIds.length >= 1;
  const changeType = (next: 'DIRECT' | 'GROUP') => {
    setType(next);
    if (next === 'DIRECT') setMemberIds(memberIds.slice(0, 1));
  };
  const submit = () =>
    create.mutate({ chatRoomType: type, memberIds, chatRoomName: type === 'GROUP' && name.trim() ? name.trim() : undefined });
  return (
    <Modal
      title="새 대화"
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="hl-cap" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {type === 'DIRECT' ? '같은 상대와의 1:1 대화가 이미 있으면 그 방이 열려요' : `${memberIds.length}명 선택 · 나는 자동으로 들어가요`}
          </span>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" disabled={!valid || create.isPending} onClick={submit}>{create.isPending ? '만드는 중…' : '대화 시작'}</button>
        </>
      }
    >
      <div className="hl-seg" role="group" aria-label="대화 종류" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={type === 'DIRECT' ? 'is-on' : undefined} aria-pressed={type === 'DIRECT'} onClick={() => changeType('DIRECT')}>1:1 대화</button>
        <button type="button" className={type === 'GROUP' ? 'is-on' : undefined} aria-pressed={type === 'GROUP'} onClick={() => changeType('GROUP')}>그룹 대화</button>
      </div>
      {type === 'GROUP' ? (
        <Field label="방 이름" hint="비워 두면 멤버 이름으로 보여요 (50자까지)">
          <input className="hl-input" value={name} maxLength={50} placeholder="예: 출하 조율" onChange={(e) => setName(e.target.value)} />
        </Field>
      ) : null}
      <div className="hl-col" style={{ gap: 6 }}>
        <span className="hl-field__label">{type === 'DIRECT' ? '대화 상대 (1명)' : '멤버 (1명 이상)'}</span>
        <MemberPicker key={type} value={memberIds} onChange={setMemberIds} single={type === 'DIRECT'} excludeIds={[myEmployeeId]} />
        <span className="hl-field__hint">업무방은 수주 1건에 1개씩 연결되는 방이라 여기서 만들지 않아요</span>
      </div>
    </Modal>
  );
}

export function InviteModal({ room, myEmployeeId, onClose }: { room: ChatRoomView; myEmployeeId: number; onClose: () => void }) {
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const invite = useAction(messengerApi.invite, {
    success: '멤버를 초대했어요',
    invalidate: ['chat-rooms'],
    onSuccess: (next) => {
      upsertRoom(next);
      onClose();
    },
  });
  return (
    <Modal
      title={`멤버 초대 · ${room.displayName}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="hl-cap" style={{ marginRight: 'auto', alignSelf: 'center' }}>새 멤버도 이전 대화를 볼 수 있어요</span>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" disabled={!memberIds.length || invite.isPending} onClick={() => invite.mutate({ id: room.id, memberIds })}>
            {invite.isPending ? '초대하는 중…' : `${memberIds.length}명 초대`}
          </button>
        </>
      }
    >
      <MemberPicker value={memberIds} onChange={setMemberIds} excludeIds={[myEmployeeId]} lockedIds={room.members.map((m) => m.employeeId)} />
    </Modal>
  );
}

export function LeaveModal({ room, onClose, onLeft }: { room: ChatRoomView; onClose: () => void; onLeft: () => void }) {
  const leave = useAction(messengerApi.leave, { success: '대화방에서 나갔어요', onSuccess: onLeft });
  return (
    <Modal
      title="그룹 대화 나가기"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--danger" disabled={leave.isPending} onClick={() => leave.mutate(room.id)}>{leave.isPending ? '나가는 중…' : '나가기'}</button>
        </>
      }
    >
      <p style={{ fontSize: 13, lineHeight: '20px' }}>
        <b>{room.displayName}</b>에서 나가면 이 방의 대화를 더 볼 수 없어요. 다시 들어오려면 멤버에게 초대를 받아야 해요.
      </p>
    </Modal>
  );
}
