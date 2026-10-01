import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRoomDetailView, MessageView } from '@/api/messenger';
import type { SessionUser } from '@/api/session';
import { clearRegisteredMessageActions, messageActionsFor, registerMessageAction } from '@/features/messenger/messageActions';

const message = { id: 1, isMine: true, content: '철광석 100t 요청' } as MessageView;
const room = { id: 1, chatRoomType: 'WORK' } as ChatRoomDetailView;
const me = { employeeId: 1, permissions: {} } as SessionUser;
const Noop = () => null;

describe('메시지 메뉴 등록부 (Message → ERP 확장 자리)', () => {
  afterEach(() => clearRegisteredMessageActions());

  it('등록이 없으면 빈 목록이다 (메뉴 버튼을 숨긴다)', () => {
    expect(messageActionsFor(message, room, me)).toEqual([]);
  });

  it('조건에 맞는 동작만 order 순으로, 같은 key는 바꾼다', () => {
    registerMessageAction({ key: 'b', order: 20, Component: Noop });
    registerMessageAction({ key: 'a', order: 10, Component: Noop });
    registerMessageAction({ key: 'hidden', isAvailable: () => false, Component: Noop });
    registerMessageAction({ key: 'b', order: 5, Component: Noop });
    expect(messageActionsFor(message, room, me).map((entry) => entry.key)).toEqual(['b', 'a']);
  });
});
