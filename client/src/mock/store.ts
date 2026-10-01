// 브라우저 안 가짜 DB (SPEC 1장). localStorage에 저장하고, 탭끼리는 BroadcastChannel(없으면 storage 이벤트)로 알린다.
// 저장소·채널은 주입받아서 테스트에서는 메모리로 바꿀 수 있다.
import { TABLE_NAMES, type MockTables, type NewRowValues, type RowOf, type TableName } from '@/mock/schema';

/** 시드나 테이블 모양이 바뀌면 올린다. 저장 키가 바뀌어 옛 데이터는 지우고 시드로 다시 만든다. */
export const MOCK_DB_VERSION = 1;
const MOCK_DB_KEY_PREFIX = 'fantasteel.mock-db';
/** localStorage 키 = BroadcastChannel 이름 (버전 포함, 예: fantasteel.mock-db.v1) */
export const MOCK_DB_STORAGE_KEY = `${MOCK_DB_KEY_PREFIX}.v${MOCK_DB_VERSION}`;

export interface MockDbSnapshot {
  version: number;
  revision: number;
  savedAt: string;
  tables: MockTables;
}

export interface MockDbStorage {
  read(): string | null;
  write(value: string): void;
}

export interface MockDbMessage {
  type: 'changed' | 'reset';
  origin: string;
}

export interface MockDbChannel {
  post(message: MockDbMessage): void;
  subscribe(listener: (message: MockDbMessage) => void): () => void;
}

/** local = 이 탭의 변경, external = 다른 탭의 변경, reset = 시드로 초기화 */
export type MockDbChangeSource = 'local' | 'external' | 'reset';
export interface MockDbChange {
  source: MockDbChangeSource;
  revision: number;
}

/** 한 번의 변경(트랜잭션) 안에서 쓰는 작업 공간. 함수가 끝나면 한꺼번에 저장되고, 예외가 나면 아무것도 저장되지 않는다. */
export interface MockTx {
  readonly tables: MockTables;
  readonly now: Date;
  readonly nowIso: string;
}

export interface MockDbStoreOptions {
  storage: MockDbStorage;
  channel?: MockDbChannel | null;
  createSeed: () => MockTables;
  /** 이 탭의 식별자. 자기 메시지는 무시한다. */
  origin: string;
  clock?: () => Date;
}

export class MockDbStore {
  private snapshot: MockDbSnapshot | null = null;
  private readonly listeners = new Set<(change: MockDbChange) => void>();
  private unsubscribeChannel: (() => void) | null = null;

  constructor(private readonly options: MockDbStoreOptions) {}

  get isLoaded(): boolean {
    return this.snapshot !== null;
  }

  /** 저장된 데이터를 읽는다. 없거나 버전이 다르거나 깨졌으면 시드로 새로 만든다. */
  load(): void {
    if (!this.snapshot) this.snapshot = this.readPersisted() ?? this.persist(this.options.createSeed(), 1);
    if (!this.unsubscribeChannel && this.options.channel) {
      this.unsubscribeChannel = this.options.channel.subscribe((message) => {
        if (message.origin !== this.options.origin) this.syncFromStorage(message.type === 'reset' ? 'reset' : 'external');
      });
    }
  }

  read<T>(reader: (tables: Readonly<MockTables>) => T): T {
    return reader(this.current().tables);
  }

  transact<T>(work: (tx: MockTx) => T): T {
    // 다른 탭이 방금 저장한 내용 위에서 시작해야 그 변경을 덮어쓰지 않는다
    const base = this.readPersisted() ?? this.current();
    const tables = structuredClone(base.tables);
    const now = this.now();
    const result = work({ tables, now, nowIso: now.toISOString() });
    this.snapshot = this.persist(tables, base.revision + 1);
    this.options.channel?.post({ type: 'changed', origin: this.options.origin });
    this.emit({ source: 'local', revision: this.snapshot.revision });
    return result;
  }

  /** 시드로 초기화한다. 이 브라우저의 다른 탭에도 알린다. */
  reset(): void {
    const revision = (this.readPersisted()?.revision ?? this.snapshot?.revision ?? 0) + 1;
    this.snapshot = this.persist(this.options.createSeed(), revision);
    this.options.channel?.post({ type: 'reset', origin: this.options.origin });
    this.emit({ source: 'reset', revision });
  }

  subscribe(listener: (change: MockDbChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 다른 탭의 변경을 반영한다 */
  syncFromStorage(source: Exclude<MockDbChangeSource, 'local'> = 'external'): void {
    const persisted = this.readPersisted();
    if (!persisted) return;
    if (this.snapshot && persisted.revision === this.snapshot.revision && persisted.savedAt === this.snapshot.savedAt) return;
    this.snapshot = persisted;
    this.emit({ source, revision: persisted.revision });
  }

  dispose(): void {
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.listeners.clear();
  }

  private current(): MockDbSnapshot {
    if (!this.snapshot) this.load();
    if (!this.snapshot) throw new Error('가짜 DB를 불러오지 못했어요');
    return this.snapshot;
  }

  private now(): Date {
    return this.options.clock ? this.options.clock() : new Date();
  }

  private emit(change: MockDbChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private persist(tables: MockTables, revision: number): MockDbSnapshot {
    const snapshot: MockDbSnapshot = { version: MOCK_DB_VERSION, revision, savedAt: this.now().toISOString(), tables };
    this.options.storage.write(JSON.stringify(snapshot));
    return snapshot;
  }

  private readPersisted(): MockDbSnapshot | null {
    const raw = this.options.storage.read();
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSnapshot(value: unknown): value is MockDbSnapshot {
  if (!isRecord(value) || value.version !== MOCK_DB_VERSION) return false;
  if (typeof value.revision !== 'number' || typeof value.savedAt !== 'string') return false;
  const tables = value.tables;
  return isRecord(tables) && TABLE_NAMES.every((name) => Array.isArray(tables[name]));
}

// ── 행 다루기 ──────────────────────────────────────────────

/** 새 행을 넣는다. id는 테이블 안 최댓값 + 1, 생성·수정 시각은 트랜잭션 시각. */
export function insertRow<K extends TableName>(tx: MockTx, table: K, values: NewRowValues<K>): RowOf<K> {
  const rows = tx.tables[table] as RowOf<K>[];
  const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const row = { createdAt: tx.nowIso, updatedAt: tx.nowIso, ...values, id } as RowOf<K>;
  rows.push(row);
  return row;
}

/** 행을 고친다. 수정 시각을 트랜잭션 시각으로 바꾼다. 행이 없으면 null. */
export function updateRow<K extends TableName>(
  tx: MockTx,
  table: K,
  id: number,
  patch: Partial<Omit<RowOf<K>, 'id' | 'createdAt' | 'updatedAt'>>,
): RowOf<K> | null {
  const rows = tx.tables[table] as RowOf<K>[];
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const next = { ...rows[index], ...patch, updatedAt: tx.nowIso } as RowOf<K>;
  rows[index] = next;
  return next;
}

export function findRow<K extends TableName>(tables: Readonly<MockTables>, table: K, id: number | null | undefined): RowOf<K> | undefined {
  if (id === null || id === undefined) return undefined;
  return (tables[table] as RowOf<K>[]).find((row) => row.id === id);
}

// ── 브라우저 어댑터 ────────────────────────────────────────

export function createMemoryStorage(initial: string | null = null): MockDbStorage & { value: string | null } {
  const box = {
    value: initial,
    read: () => box.value,
    write: (value: string) => {
      box.value = value;
    },
  };
  return box;
}

/** 다른 버전의 가짜 DB 키를 지운다 */
function removeOtherVersions(currentKey: string): void {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key !== currentKey && key.startsWith(MOCK_DB_KEY_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage를 쓸 수 없으면 지울 것도 없다
  }
}

export function createLocalStorage(key: string = MOCK_DB_STORAGE_KEY): MockDbStorage {
  removeOtherVersions(key);
  return {
    read: () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (value) => {
      window.localStorage.setItem(key, value);
    },
  };
}

/** BroadcastChannel이 있으면 그것을, 없으면 storage 이벤트를 쓴다 */
export function createBrowserChannel(key: string = MOCK_DB_STORAGE_KEY): MockDbChannel {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(key);
    return {
      post: (message) => channel.postMessage(message),
      subscribe: (listener) => {
        const handle = (event: MessageEvent<MockDbMessage>) => listener(event.data);
        channel.addEventListener('message', handle);
        return () => channel.removeEventListener('message', handle);
      },
    };
  }
  return {
    // localStorage에 쓰면 다른 탭에 storage 이벤트가 저절로 간다
    post: () => undefined,
    subscribe: (listener) => {
      const handle = (event: StorageEvent) => {
        if (event.key === key) listener({ type: 'changed', origin: 'storage-event' });
      };
      window.addEventListener('storage', handle);
      return () => window.removeEventListener('storage', handle);
    },
  };
}
