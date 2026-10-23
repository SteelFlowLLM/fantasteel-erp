import { describe, expect, it } from 'vitest';
import { firstUnreadId, layoutMessages, type GroupableMessage } from '@/features/messenger/lib/messageGroups';

const msg = (id: number, senderId: number, createdAt: string, extra: Partial<GroupableMessage> = {}): GroupableMessage => ({
  id,
  senderId,
  isSystem: false,
  isMine: senderId === 1,
  createdAt,
  ...extra,
});

describe('연속 메시지 묶기', () => {
  it('같은 사람이 5분 안에 이어 쓰면 한 묶음: 첫 메시지에 이름, 마지막 메시지에 시각', () => {
    const layout = layoutMessages(
      [msg(1, 2, '2026-10-06T10:00:00+09:00'), msg(2, 2, '2026-10-06T10:03:00+09:00'), msg(3, 2, '2026-10-06T10:09:00+09:00')],
      null,
    );
    expect(layout.map((l) => [l.isGroupStart, l.isGroupEnd])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it('보낸 사람이 바뀌거나 시스템 메시지면 끊는다', () => {
    const layout = layoutMessages(
      [
        msg(1, 2, '2026-10-06T10:00:00+09:00'),
        msg(2, 3, '2026-10-06T10:01:00+09:00'),
        msg(3, 3, '2026-10-06T10:01:30+09:00', { isSystem: true }),
        msg(4, 3, '2026-10-06T10:02:00+09:00'),
      ],
      null,
    );
    expect(layout.map((l) => l.isGroupStart)).toEqual([true, true, true, true]);
  });

  it('날짜가 바뀌면 날짜 구분선을 넣고 묶음을 끊는다 (Asia/Seoul)', () => {
    const layout = layoutMessages([msg(1, 2, '2026-10-06T23:58:00+09:00'), msg(2, 2, '2026-10-07T00:01:00+09:00')], null);
    expect(layout.map((l) => [l.showDay, l.isGroupStart])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it('새 메시지 구분선 앞뒤는 묶지 않는다', () => {
    const layout = layoutMessages([msg(1, 2, '2026-10-06T10:00:00+09:00'), msg(2, 2, '2026-10-06T10:01:00+09:00')], 2);
    expect(layout.map((l) => [l.showNewDivider, l.isGroupStart, l.isGroupEnd])).toEqual([
      [false, true, true],
      [true, true, true],
    ]);
  });
});

describe('새 메시지 구분선 위치', () => {
  const messages = [msg(10, 2, '2026-10-06T10:00:00+09:00'), msg(11, 1, '2026-10-06T10:01:00+09:00'), msg(12, 3, '2026-10-06T10:02:00+09:00')];

  it('읽음 위치 뒤의 첫 남의 메시지 (내 메시지는 건너뛴다)', () => {
    expect(firstUnreadId(messages, 10)).toBe(12);
  });

  it('읽은 적이 없으면 첫 남의 메시지, 다 읽었으면 없음', () => {
    expect(firstUnreadId(messages, null)).toBe(10);
    expect(firstUnreadId(messages, 12)).toBeNull();
  });
});
