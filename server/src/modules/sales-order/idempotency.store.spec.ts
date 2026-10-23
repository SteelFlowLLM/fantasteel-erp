import { IdempotencyStore } from './idempotency.store';

describe('요청 키 (저장 두 번 눌러도 한 건)', () => {
  it('같은 키는 처리 중이든 끝났든 첫 결과를 돌려주고 work를 한 번만 부른다', async () => {
    const store = new IdempotencyStore();
    let calls = 0;
    const work = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { salesOrderId: calls };
    };
    const [a, b] = await Promise.all([store.run('1:so', 'k1', work), store.run('1:so', 'k1', work)]);
    const c = await store.run('1:so', 'k1', work);
    expect(calls).toBe(1);
    expect(a).toEqual({ salesOrderId: 1 });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('사원(범위)이나 키가 다르면 따로 처리하고, 키가 없으면 매번 처리한다', async () => {
    const store = new IdempotencyStore();
    let calls = 0;
    const work = async () => ++calls;
    await store.run('1:so', 'k1', work);
    await store.run('2:so', 'k1', work);
    await store.run('1:so', 'k2', work);
    await store.run('1:so', undefined, work);
    await store.run('1:so', undefined, work);
    expect(calls).toBe(5);
  });

  it('실패한 요청은 키를 지워 다시 시도할 수 있다', async () => {
    const store = new IdempotencyStore();
    await expect(store.run('1:so', 'k1', () => Promise.reject(new Error('경합')))).rejects.toThrow('경합');
    await expect(store.run('1:so', 'k1', async () => 'ok')).resolves.toBe('ok');
  });
});
