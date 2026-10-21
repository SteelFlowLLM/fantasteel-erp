import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchSessionChange } from '@/lib/sessionReset';
import { useMessageComposeStore } from '@/stores/useMessageComposeStore';
import { useOutboxStore } from '@/stores/useOutboxStore';
import { useSessionStore } from '@/stores/useSessionStore';
import type { MessageView } from '@/api/messenger';

const account = (employeeId: number) => ({ employeeId, employeeNo: `no-${employeeId}` });

let queryClient: QueryClient;
let unwatch: () => void;

function seedPreviousUserData(): void {
  queryClient.setQueryData(['approvals', 'inbox'], [{ id: 1, requester: '앞 사원의 결재함' }]);
  useOutboxStore.getState().add({ chatRoomId: 7, content: '앞 사원이 쓴 글' });
  useMessageComposeStore.getState().setReplyTo({ id: 1 } as MessageView);
}

beforeEach(() => {
  queryClient = new QueryClient();
  useSessionStore.setState({ hydrated: true, employeeId: 1, signedOut: false });
  useOutboxStore.setState({ items: [] });
  unwatch = watchSessionChange(queryClient);
});

afterEach(() => {
  unwatch();
  queryClient.clear();
  useOutboxStore.setState({ items: [] });
  useMessageComposeStore.setState({ replyTo: null });
  useSessionStore.setState({ employeeId: null });
});

describe('로그아웃·다른 사원 로그인 때 화면 데이터 비우기 (이슈 #476)', () => {
  it('로그아웃하면 조회 캐시와 보내기 실패 메시지, 고른 메시지를 모두 비운다', () => {
    seedPreviousUserData();
    useSessionStore.getState().signOut();
    expect(queryClient.getQueryData(['approvals', 'inbox'])).toBeUndefined();
    expect(useOutboxStore.getState().items).toEqual([]);
    expect(useMessageComposeStore.getState().replyTo).toBeNull();
  });

  it('로그아웃 없이 다른 사원으로 바뀌어도(다른 탭의 로그인 등) 비운다', () => {
    seedPreviousUserData();
    useSessionStore.getState().signIn(account(2));
    expect(queryClient.getQueryData(['approvals', 'inbox'])).toBeUndefined();
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('같은 사원이 다시 불러올 때는 비우지 않는다', () => {
    seedPreviousUserData();
    useSessionStore.getState().signIn(account(1));
    expect(queryClient.getQueryData(['approvals', 'inbox'])).toBeDefined();
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('처음 불러와 사원이 생길 때(앞 사원 없음)는 건드리지 않는다', () => {
    useSessionStore.setState({ employeeId: null });
    queryClient.setQueryData(['public', 'x'], 1);
    useSessionStore.getState().signIn(account(3));
    expect(queryClient.getQueryData(['public', 'x'])).toBe(1);
  });

  it('로그아웃 → 다른 사원 로그인 뒤 새 사원의 데이터만 남는다', () => {
    seedPreviousUserData();
    useSessionStore.getState().signOut();
    useSessionStore.getState().signIn(account(2));
    queryClient.setQueryData(['approvals', 'inbox'], [{ id: 9 }]);
    expect(queryClient.getQueryData(['approvals', 'inbox'])).toEqual([{ id: 9 }]);
    expect(useOutboxStore.getState().items).toEqual([]);
  });
});
