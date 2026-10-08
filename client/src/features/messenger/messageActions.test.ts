import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRoomDetailView, MessageView } from '@/api/messenger';
import type { SessionUser } from '@/api/session';
import { clearRegisteredMessageActions, messageActionsFor, registerMessageAction } from '@/features/messenger/messageActions';

const message = { id: 1, isMine: true, isSystem: false, isDeleted: false, content: '철광석 100t 요청' } as MessageView;
const room = { id: 1, chatRoomType: 'WORK' } as ChatRoomDetailView;
const me = { employeeId: 1, permissions: {} } as SessionUser;
const Noop = () => null;

describe('메시지 메뉴 등록부 (Message → ERP 확장 자리)', () => {
  afterEach(() => clearRegisteredMessageActions());

  it('기본 동작: 내 메시지는 답장·수정·삭제, 남의 메시지는 답장만, 시스템·삭제된 메시지는 없음 (메뉴 버튼을 숨긴다)', () => {
    expect(messageActionsFor(message, room, me).map((entry) => entry.key)).toEqual(['reply', 'edit', 'delete', 'pin']);
    expect(messageActionsFor({ ...message, isMine: false }, room, me).map((entry) => entry.key)).toEqual(['reply', 'pin']);
    expect(messageActionsFor({ ...message, isSystem: true, isMine: false }, room, me)).toEqual([]);
    expect(messageActionsFor({ ...message, isDeleted: true, content: null }, room, me)).toEqual([]);
  });

  it('조건에 맞는 동작만 sortOrder 순으로, 같은 key는 바꾼다', () => {
    registerMessageAction({ key: 'b', sortOrder: 20, Component: Noop });
    registerMessageAction({ key: 'a', sortOrder: 10, Component: Noop });
    registerMessageAction({ key: 'hidden', isAvailable: () => false, Component: Noop });
    registerMessageAction({ key: 'b', sortOrder: 5, Component: Noop });
    expect(messageActionsFor(message, room, me).map((entry) => entry.key)).toEqual(['reply', 'edit', 'delete', 'pin', 'b', 'a']);
  });
});
