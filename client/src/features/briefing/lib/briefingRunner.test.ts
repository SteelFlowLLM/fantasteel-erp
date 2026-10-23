import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingCancelled, createBriefingRunner, typingPause, waitForSources } from '@/features/briefing/lib/briefingRunner';

describe('브리핑 재생 실행기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('시간이 지나면 기다림이 끝난다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    const done = vi.fn();
    void runner.wait(id, 500).then(done);
    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it('새로 시작하면 앞 재생의 기다림은 멈춤으로 끝난다', async () => {
    const runner = createBriefingRunner();
    const first = runner.start();
    const waiting = runner.wait(first, 1000);
    const second = runner.start();
    await expect(waiting).rejects.toBeInstanceOf(BriefingCancelled);
    expect(runner.isCurrent(first)).toBe(false);
    expect(runner.isCurrent(second)).toBe(true);
    await expect(runner.wait(first, 10)).rejects.toBeInstanceOf(BriefingCancelled);
  });

  it('건너뛰면 연출은 바로 끝나지만 자료 기다림은 남는다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    const effect = vi.fn();
    const data = vi.fn();
    void runner.wait(id, 5000).then(effect);
    void runner.pause(id, 300).then(data);
    runner.skip();
    await vi.advanceTimersByTimeAsync(0);
    expect(effect).toHaveBeenCalled();
    expect(data).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(data).toHaveBeenCalled();
    // 건너뛰는 동안 새 연출 기다림도 바로 끝난다
    await expect(runner.wait(id, 9999)).resolves.toBeUndefined();
    runner.finish(id);
    expect(runner.isSkipping()).toBe(false);
  });

  it('글자 쉼: 문장 끝 > 쉼표 > 보통', () => {
    expect(typingPause('.')).toBeGreaterThan(typingPause(','));
    expect(typingPause(',')).toBeGreaterThan(typingPause('가'));
  });
});

describe('자료 기다리기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hooks = () => ({ onStart: vi.fn(), onSettle: vi.fn() });

  it('모두 읽으면 실패 목록이 비어 있다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    const failed = await waitForSources(runner, id, ['a', 'b'], () => 'done', hooks());
    expect(failed).toEqual([]);
  });

  it('조회가 실패한 자료는 실패로 모은다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    const h = hooks();
    const failed = await waitForSources(runner, id, ['a', 'b'], (key) => (key === 'b' ? 'error' : 'done'), h);
    expect(failed).toEqual(['b']);
    expect(h.onSettle).toHaveBeenCalledWith('b', true);
    expect(h.onSettle).toHaveBeenCalledWith('a', false);
  });

  it('마감은 자료마다가 아니라 전체 하나다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    const done = vi.fn();
    void waitForSources(runner, id, ['a', 'b', 'c'], () => 'loading', hooks(), 1000).then(done);
    await vi.advanceTimersByTimeAsync(1300);
    expect(done).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('마감 안에 도착하면 실패가 아니다', async () => {
    const runner = createBriefingRunner();
    const id = runner.start();
    let state: 'loading' | 'done' = 'loading';
    const done = vi.fn();
    void waitForSources(runner, id, ['a'], () => state, hooks(), 1000).then(done);
    await vi.advanceTimersByTimeAsync(300);
    state = 'done';
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toHaveBeenCalledWith([]);
  });
});
