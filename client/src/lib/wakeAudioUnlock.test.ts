// 철강맨 부르기 (이슈 #494): 브라우저가 멈춰 둔 AudioContext를 깨우고, 안 되면 막혔다고 알린 뒤 다음 누르기에서 다시 깨운다.
import { describe, expect, it, vi } from 'vitest';
import { keepAudioRunning, type AudioContextLike } from '@/lib/wakeAudioUnlock';

/** resume을 허락할지 정할 수 있는 가짜 AudioContext. 허락하지 않으면 실제 브라우저처럼 promise가 끝나지 않는다 */
function fakeContext(initial: AudioContextState) {
  let allow = false;
  const context = {
    state: initial,
    onstatechange: null as AudioContextLike['onstatechange'],
    resume: vi.fn(() => {
      if (!allow) return new Promise<void>(() => undefined);
      context.state = 'running';
      context.onstatechange?.call(context as unknown as BaseAudioContext, new Event('statechange'));
      return Promise.resolve();
    }),
  };
  return { context, allowResume: () => (allow = true) };
}

function fakeTarget() {
  const listeners = new Map<string, EventListener>();
  return {
    target: {
      addEventListener: (type: string, listener: EventListener) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
    },
    fire: (type: string) => listeners.get(type)?.(new Event(type)),
    count: () => listeners.size,
  };
}

describe('keepAudioRunning', () => {
  it('누르지 않은 때 만들어 멈춘 채면 막혔다고 알리고, 화면을 누르면 깨워 풀린다', async () => {
    const { context, allowResume } = fakeContext('suspended');
    const { target, fire } = fakeTarget();
    const blocked: boolean[] = [];
    keepAudioRunning(context, (value) => blocked.push(value), target);
    expect(blocked).toEqual([true]);
    expect(context.resume).toHaveBeenCalledTimes(1);

    allowResume();
    fire('pointerdown');
    await vi.waitFor(() => expect(blocked.at(-1)).toBe(false));
    expect(context.state).toBe('running');
  });

  it('바로 깨어나면 막혔다고 알리지 않고, 키 입력으로도 깨운다', async () => {
    const running = fakeContext('running');
    const blocked: boolean[] = [];
    keepAudioRunning(running.context, (value) => blocked.push(value), fakeTarget().target);
    expect(blocked).toEqual([false]);

    const { context, allowResume } = fakeContext('suspended');
    const { target, fire } = fakeTarget();
    const later: boolean[] = [];
    keepAudioRunning(context, (value) => later.push(value), target);
    allowResume();
    fire('keydown');
    await vi.waitFor(() => expect(later.at(-1)).toBe(false));
  });

  it('그만두면 사용자 조작을 더 듣지 않고, 상태가 바뀌어도 알리지 않는다', () => {
    const { context } = fakeContext('suspended');
    const { target, count } = fakeTarget();
    const blocked: boolean[] = [];
    const stop = keepAudioRunning(context, (value) => blocked.push(value), target);
    expect(count()).toBe(2);
    stop();
    expect(count()).toBe(0);
    expect(context.onstatechange).toBeNull();
    expect(blocked).toEqual([true]);
  });
});
