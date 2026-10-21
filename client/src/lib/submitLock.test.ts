import { describe, expect, it } from 'vitest';
import { createSubmitLock } from './submitLock';

describe('createSubmitLock', () => {
  it('첫 제출만 들어가고, 풀기 전의 제출은 모두 막는다 (렌더를 기다리지 않는다)', () => {
    const lock = createSubmitLock();
    expect([lock.tryEnter(), lock.tryEnter(), lock.tryEnter()]).toEqual([true, false, false]);
  });

  it('풀면 다시 제출할 수 있다 (실패 뒤 다시 시도)', () => {
    const lock = createSubmitLock();
    expect(lock.tryEnter()).toBe(true);
    lock.release();
    expect(lock.tryEnter()).toBe(true);
    expect(lock.tryEnter()).toBe(false);
  });

  it('잠금은 서로 독립이다 (다른 화면의 제출을 막지 않는다)', () => {
    const [a, b] = [createSubmitLock(), createSubmitLock()];
    expect(a.tryEnter()).toBe(true);
    expect(b.tryEnter()).toBe(true);
  });

  it('두 번 푸는 것은 안전하다', () => {
    const lock = createSubmitLock();
    lock.tryEnter();
    lock.release();
    lock.release();
    expect([lock.tryEnter(), lock.tryEnter()]).toEqual([true, false]);
  });
});
