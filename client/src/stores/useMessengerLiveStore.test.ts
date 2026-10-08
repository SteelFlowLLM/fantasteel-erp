// 메신저 실시간 상태: 접속 목록·변경, 입력 중 추가·시간 지나면 사라짐·보내면 지움, 연결이 끊기면 비움, 입력 중 문구.
import { afterEach, describe, expect, it } from 'vitest';
import { TYPING_SHOW_MS } from '@fantasteel/shared';
import { typingText, useMessengerLiveStore } from '@/stores/useMessengerLiveStore';

const live = () => useMessengerLiveStore.getState();

afterEach(() => live().reset());

describe('메신저 실시간 상태 (useMessengerLiveStore)', () => {
  it('접속 목록을 받고 접속·나감을 반영하며, 연결이 끊기면 접속·입력 중을 비운다', () => {
    live().setConnected(true);
    live().setOnline([3, 5]);
    live().setPresence(7, true);
    live().setPresence(3, false);
    expect([...live().online].sort()).toEqual([5, 7]);

    live().addTyping(1, { employeeId: 5, employeeName: '정다은' });
    live().setConnected(false);
    expect(live().online.size).toBe(0);
    expect(live().typing).toEqual({});
  });

  it('입력 중은 같은 사람이면 시간만 늘리고, 시간이 지나면 사라지며, 메시지를 보내면 바로 지운다', () => {
    live().addTyping(1, { employeeId: 5, employeeName: '정다은' }, 1000);
    live().addTyping(1, { employeeId: 5, employeeName: '정다은' }, 2000);
    live().addTyping(1, { employeeId: 13, employeeName: '서민지' }, 2000);
    expect(live().typing[1].map((t) => [t.employeeId, t.until])).toEqual([
      [5, 2000 + TYPING_SHOW_MS],
      [13, 2000 + TYPING_SHOW_MS],
    ]);

    live().clearTyping(1, 13);
    expect(live().typing[1].map((t) => t.employeeId)).toEqual([5]);
    live().pruneTyping(2000 + TYPING_SHOW_MS + 1);
    expect(live().typing[1]).toBeUndefined();
  });

  it('입력 중 문구: 1명·2명·3명 이상', () => {
    const member = (employeeId: number, employeeName: string) => ({ employeeId, employeeName, until: 0 });
    expect(typingText([])).toBeNull();
    expect(typingText([member(5, '정다은')])).toBe('정다은님이 입력 중…');
    expect(typingText([member(5, '정다은'), member(13, '서민지')])).toBe('정다은님, 서민지님이 입력 중…');
    expect(typingText([member(5, '정다은'), member(13, '서민지'), member(12, '오지훈')])).toBe('정다은님 외 2명이 입력 중…');
  });
});
