import { describe, expect, it } from 'vitest';
import { createEmptyTables } from '@/mock/schema';
import {
  createMemoryStorage,
  insertRow,
  MOCK_DB_VERSION,
  MockDbStore,
  updateRow,
  type MockDbChange,
  type MockDbChannel,
  type MockDbMessage,
  type MockDbStorage,
} from '@/mock/store';

function seedWithOneCustomer() {
  const tables = createEmptyTables();
  tables.customer.push({ id: 1, customerCode: 'CUS-01', customerName: '시드 고객사', createdAt: 'x', updatedAt: 'x' });
  return tables;
}

/** 같은 브라우저의 탭들을 흉내 내는 메모리 채널 */
function createHub() {
  const listeners = new Set<(m: MockDbMessage) => void>();
  return (): MockDbChannel => ({
    post: (message) => {
      for (const listener of listeners) listener(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

const fixedClock = () => new Date('2026-10-01T01:00:00.000Z');

function createStore(storage: MockDbStorage, origin = 'tab-a', channel?: MockDbChannel) {
  return new MockDbStore({ storage, channel, createSeed: seedWithOneCustomer, origin, clock: fixedClock });
}

describe('MockDbStore', () => {
  it('저장된 데이터가 없으면 시드로 만들고 저장한다', () => {
    const storage = createMemoryStorage();
    const store = createStore(storage);
    store.load();
    expect(store.read((t) => t.customer.map((c) => c.customerName))).toEqual(['시드 고객사']);
    expect(storage.value).toContain('"version":' + String(MOCK_DB_VERSION));
  });

  it('버전이 다르거나 깨진 데이터는 버리고 시드로 다시 만든다', () => {
    const storage = createMemoryStorage(JSON.stringify({ version: MOCK_DB_VERSION + 99, revision: 1, savedAt: 'x', tables: {} }));
    const store = createStore(storage);
    store.load();
    expect(store.read((t) => t.customer)).toHaveLength(1);

    const broken = createMemoryStorage('{not json');
    const other = createStore(broken);
    other.load();
    expect(other.read((t) => t.customer)).toHaveLength(1);
  });

  it('변경은 한꺼번에 저장되고, 예외가 나면 아무것도 바뀌지 않는다', () => {
    const storage = createMemoryStorage();
    const store = createStore(storage);
    store.load();
    const changes: MockDbChange[] = [];
    store.subscribe((c) => changes.push(c));

    const row = store.transact((tx) => insertRow(tx, 'customer', { customerCode: 'CUS-02', customerName: '새 고객사' }));
    expect(row.id).toBe(2);
    expect(row.createdAt).toBe('2026-10-01T01:00:00.000Z');
    expect(changes).toEqual([{ source: 'local', revision: 2 }]);

    const before = storage.value;
    expect(() =>
      store.transact((tx) => {
        updateRow(tx, 'customer', 1, { customerName: '바뀐 이름' });
        throw new Error('실패');
      }),
    ).toThrow('실패');
    expect(storage.value).toBe(before);
    expect(store.read((t) => t.customer.find((c) => c.id === 1)?.customerName)).toBe('시드 고객사');
  });

  it('다른 탭의 변경을 받아 반영하고 알린다', () => {
    const storage = createMemoryStorage();
    const hub = createHub();
    const tabA = createStore(storage, 'tab-a', hub());
    const tabB = createStore(storage, 'tab-b', hub());
    tabA.load();
    tabB.load();
    const seen: MockDbChange[] = [];
    tabB.subscribe((c) => seen.push(c));

    tabA.transact((tx) => insertRow(tx, 'customer', { customerCode: 'CUS-02', customerName: 'A 탭' }));
    expect(seen.map((c) => c.source)).toEqual(['external']);
    expect(tabB.read((t) => t.customer.map((c) => c.customerCode))).toEqual(['CUS-01', 'CUS-02']);

    tabA.reset();
    expect(seen.map((c) => c.source)).toEqual(['external', 'reset']);
    expect(tabB.read((t) => t.customer)).toHaveLength(1);
  });

  it('알림을 받기 전에 다른 탭이 저장한 변경도 덮어쓰지 않는다', () => {
    const storage = createMemoryStorage();
    const tabA = createStore(storage, 'tab-a');
    const tabB = createStore(storage, 'tab-b');
    tabA.load();
    tabB.load();
    tabA.transact((tx) => insertRow(tx, 'customer', { customerCode: 'CUS-02', customerName: 'A 탭' }));
    tabB.transact((tx) => insertRow(tx, 'customer', { customerCode: 'CUS-03', customerName: 'B 탭' }));
    expect(tabB.read((t) => t.customer.map((c) => c.customerCode))).toEqual(['CUS-01', 'CUS-02', 'CUS-03']);
  });
});
