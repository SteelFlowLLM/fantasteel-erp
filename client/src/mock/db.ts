// 이 탭의 가짜 DB 인스턴스. 브라우저에서는 localStorage + BroadcastChannel을, 서버 렌더링 중에는 메모리를 쓴다.
import { createSeedTables } from '@/mock/seed';
import { createBrowserChannel, createLocalStorage, createMemoryStorage, MockDbStore } from '@/mock/store';

let instance: MockDbStore | null = null;

const createOrigin = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 이 브라우저의 가짜 데이터를 시드 상태로 되돌린다. 다른 탭에도 알린다. */
export function resetToSeed(): void {
  getMockDb().reset();
}

export function getMockDb(): MockDbStore {
  if (instance) return instance;
  const inBrowser = typeof window !== 'undefined';
  instance = new MockDbStore({
    storage: inBrowser ? createLocalStorage() : createMemoryStorage(),
    channel: inBrowser ? createBrowserChannel() : null,
    createSeed: createSeedTables,
    origin: createOrigin(),
  });
  return instance;
}
