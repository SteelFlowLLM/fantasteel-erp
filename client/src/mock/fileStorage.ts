// 메시지 첨부 파일의 가짜 저장소 (실제로는 Supabase Storage, 컨벤션 3장 · REQ-MSG-003).
// DB의 message.file_path는 이 저장소의 경로이고, 내용(data URL)은 DB 밖에 따로 둔다.
// 그래야 가짜 DB(한 덩어리 JSON)를 저장할 때마다 파일 내용까지 다시 쓰지 않는다.
// 브라우저: localStorage 'fantasteel.mock-files.v1' (경로 → data URL). 서버 렌더링·테스트: 메모리.
// 시드 첨부의 내용은 코드에 있어 지워지지 않는다 (seedCollaboration.ts의 SEED_FILES).

const FILE_STORAGE_KEY = 'fantasteel.mock-files.v1';

/** 첨부 1개의 최대 크기 (가정값: 브라우저 저장 공간이 작아서 512KB, seed-assumptions.md) */
export const MOCK_FILE_MAX_BYTES = 512 * 1024;

interface FileMap {
  [path: string]: string;
}

let memory: FileMap = {};

function readMap(): FileMap {
  if (typeof window === 'undefined') return memory;
  try {
    const raw = window.localStorage.getItem(FILE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as FileMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: FileMap): void {
  if (typeof window === 'undefined') {
    memory = map;
    return;
  }
  window.localStorage.setItem(FILE_STORAGE_KEY, JSON.stringify(map));
}

export class MockFileStorageFullError extends Error {
  constructor() {
    super('브라우저 저장 공간이 모자라 파일을 저장하지 못했어요. 시드로 초기화하면 공간이 비워져요');
    this.name = 'MockFileStorageFullError';
  }
}

/** 파일 내용을 넣는다. 저장 공간이 모자라면 MockFileStorageFullError */
export function putMockFile(path: string, dataUrl: string): void {
  const map = readMap();
  map[path] = dataUrl;
  try {
    writeMap(map);
  } catch {
    throw new MockFileStorageFullError();
  }
}

export function getMockFile(path: string, seedFiles: Readonly<Record<string, string>> = {}): string | null {
  return readMap()[path] ?? seedFiles[path] ?? null;
}

export function removeMockFile(path: string): void {
  const map = readMap();
  if (!(path in map)) return;
  delete map[path];
  writeMap(map);
}

/** 시드로 초기화할 때 올린 파일을 모두 지운다 */
export function clearMockFiles(): void {
  if (typeof window === 'undefined') {
    memory = {};
    return;
  }
  try {
    window.localStorage.removeItem(FILE_STORAGE_KEY);
  } catch {
    // 지울 수 없으면 그대로 둔다 (다음 업로드가 덮어쓴다)
  }
}
