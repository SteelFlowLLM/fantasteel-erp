// 철강맨 부르기 (이슈 #494)의 원(오브): 상태별 모양과 목소리 크기에 따른 크기.
import { describe, expect, it } from 'vitest';
import { ORB_MAX_SCALE, orbTargetScale, setWakeLiveLevel, smoothOrbScale, wakeLiveLevel, wakeOrbModeOf, type WakeOrbInput } from '@/lib/wakeOrb';

const base: WakeOrbInput = { status: 'listening', audioBlocked: false, hearing: false, transcribing: false, called: false, answering: false };
const mode = (patch: Partial<WakeOrbInput>) => wakeOrbModeOf({ ...base, ...patch });

describe('wakeOrbModeOf', () => {
  it('듣는 중 → 말소리 → 받아쓰기 → "네?" → 답하는 중 순으로 앞선다', () => {
    expect(mode({})).toBe('idle');
    expect(mode({ hearing: true })).toBe('speaking');
    expect(mode({ hearing: true, transcribing: true })).toBe('transcribing');
    expect(mode({ transcribing: true, called: true })).toBe('called');
    expect(mode({ called: true, answering: true })).toBe('answering');
  });

  it('마이크를 열지 못했거나 쉬거나 소리 듣기가 막혔으면 회색', () => {
    expect(mode({ status: 'error', hearing: true })).toBe('muted');
    expect(mode({ status: 'paused' })).toBe('muted');
    expect(mode({ status: 'starting' })).toBe('muted');
    expect(mode({ audioBlocked: true, answering: true })).toBe('muted');
  });
});

describe('원 크기', () => {
  it('조용하면 1, 말 시작 기준이면 조금 크게, 기준의 3배 이상이면 가장 크게', () => {
    expect(orbTargetScale(0, 0.015)).toBe(1);
    expect(orbTargetScale(0.01, 0)).toBe(1);
    const atThreshold = orbTargetScale(0.015, 0.015);
    expect(atThreshold).toBeGreaterThan(1.2);
    expect(atThreshold).toBeLessThan(1.5);
    expect(orbTargetScale(0.045, 0.015)).toBeCloseTo(ORB_MAX_SCALE, 5);
    expect(orbTargetScale(1, 0.015)).toBeCloseTo(ORB_MAX_SCALE, 5);
    // 기준 아래 작은 소리도 조금 움직인다 (마이크가 듣고 있음을 보이게)
    expect(orbTargetScale(0.003, 0.015)).toBeGreaterThan(1.1);
  });

  it('커질 때는 빨리, 작아질 때는 천천히 따라간다', () => {
    const up = smoothOrbScale(1, 1.6) - 1;
    const down = 1.6 - smoothOrbScale(1.6, 1);
    expect(up).toBeGreaterThan(down);
  });

  it('마이크 쪽이 넣은 값을 원이 그대로 읽는다', () => {
    setWakeLiveLevel(0.02, 0.015);
    expect(wakeLiveLevel).toEqual({ rms: 0.02, threshold: 0.015 });
    setWakeLiveLevel(0, 0);
  });
});
