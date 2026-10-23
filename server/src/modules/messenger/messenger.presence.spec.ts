// 접속 상태: 탭을 여러 개 열어도 첫 연결에서만 접속, 마지막 연결이 끊겨야 나감으로 본다.
import { MessengerPresence } from './messenger.presence';

describe('MessengerPresence', () => {
  it('첫 연결에서만 접속, 마지막 연결이 끊길 때만 나감', () => {
    const presence = new MessengerPresence();
    expect(presence.connect(3)).toBe(true);
    expect(presence.connect(3)).toBe(false);
    expect(presence.connect(1)).toBe(true);
    expect(presence.onlineEmployeeIds()).toEqual([1, 3]);

    expect(presence.disconnect(3)).toBe(false);
    expect(presence.onlineEmployeeIds()).toEqual([1, 3]);
    expect(presence.disconnect(3)).toBe(true);
    expect(presence.onlineEmployeeIds()).toEqual([1]);
  });

  it('연결된 적 없는 사원이 끊겨도 나감으로 보지 않는다', () => {
    const presence = new MessengerPresence();
    expect(presence.disconnect(9)).toBe(false);
    expect(presence.onlineEmployeeIds()).toEqual([]);
  });
});
