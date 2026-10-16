// 연결 대상별 작업 줄: 같은 키는 차례로, 다른 키는 따로, 앞 작업이 실패해도 다음 작업은 돈다.
import { KeyedQueue } from './integration-lock';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined as void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('KeyedQueue', () => {
  it('같은 키의 작업은 앞 작업이 끝난 뒤 시작한다', async () => {
    const queue = new KeyedQueue();
    const order: string[] = [];
    const gate = deferred();
    const first = queue.run('notion', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    const second = queue.run('notion', async () => {
      order.push('second');
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('다른 키는 기다리지 않는다', async () => {
    const queue = new KeyedQueue();
    const gate = deferred();
    const slow = queue.run('notion', () => gate.promise);
    await expect(queue.run('drive', async () => 'done')).resolves.toBe('done');
    gate.resolve();
    await slow;
  });

  it('앞 작업이 실패해도 그 오류는 앞 작업에만 가고 다음 작업은 돈다', async () => {
    const queue = new KeyedQueue();
    const failed = queue.run('notion', async () => {
      throw new Error('boom');
    });
    const next = queue.run('notion', async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
