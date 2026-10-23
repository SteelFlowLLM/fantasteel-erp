// 사람이 고른 시각 글 → 시각: 시간대가 없으면 서울 시각 (일정 #487, 작업 실적 #496). DB 없이 확인한다.
import { seoulDateTimeOf } from './seoul-date';

describe('seoulDateTimeOf (#487, #496)', () => {
  it('시간대가 있으면 그대로, 없으면 서울 시각(+09:00)으로', () => {
    expect(seoulDateTimeOf('2026-11-03T14:00:00Z').toISOString()).toBe('2026-11-03T14:00:00.000Z');
    expect(seoulDateTimeOf('2026-11-03T14:00:00+09:00').toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(seoulDateTimeOf('2026-11-03T14:00:00.000-0500').toISOString()).toBe('2026-11-03T19:00:00.000Z');
    expect(seoulDateTimeOf('2026-11-03T14:00:00').toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(seoulDateTimeOf('2026-11-03T00:30').toISOString()).toBe('2026-11-02T15:30:00.000Z');
    expect(seoulDateTimeOf('2026-11-03').toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });

  it('날짜와 시각 사이 공백은 T로 보고, 읽을 수 없는 글은 Invalid Date', () => {
    expect(seoulDateTimeOf('2026-11-03 14:00').toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(seoulDateTimeOf(' 2026-11-03 14:00:00Z ').toISOString()).toBe('2026-11-03T14:00:00.000Z');
    expect(Number.isNaN(seoulDateTimeOf('2026-W45').getTime())).toBe(true);
  });
});
