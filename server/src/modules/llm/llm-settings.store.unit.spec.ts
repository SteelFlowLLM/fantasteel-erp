// LLM 연결 설정 파일 (#497): 쓰는 중에 읽어도 반쪽 JSON을 읽지 않고, API 키가 든 파일은 0600이다. DB 없이 임시 폴더로 확인한다.
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmSettingsStore, type LlmSettings } from './llm-settings.store';

const settings = (baseUrl: string, apiKey: string | null = 'secret-key', model = 'a/b'): LlmSettings => {
  const apiKeys = apiKey ? [apiKey] : [];
  return { baseUrl, model, apiKeys, apiKeysByOrigin: apiKey ? { [new URL(baseUrl).origin]: apiKeys } : {}, visionSupport: null, reasoningSupport: null, contextLength: null };
};

describe('LlmSettingsStore 쓰기 (#497)', () => {
  let dir: string;
  const before = process.env.STORAGE_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llm-settings-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

  it('쓰고 읽기를 여러 번 겹쳐도 늘 온전한 설정을 읽고, 임시 파일을 남기지 않는다', async () => {
    const store = new LlmSettingsStore();
    const long = 'm'.repeat(200_000);
    await store.write(settings('http://first/v1', 'k', long));
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      jobs.push(store.write(settings(`http://host-${i}/v1`, 'k', long)));
      jobs.push(store.read().then((s) => expect(s.baseUrl).toMatch(/^http:\/\/(first|host-\d+)\/v1$/)));
    }
    await Promise.all(jobs);
    expect(await readdir(join(dir, 'settings'))).toEqual(['llm.json']);
  });

  (process.platform === 'win32' ? it.skip : it)('API 키가 든 파일은 만든 사용자만 읽고 쓴다 (0600)', async () => {
    const store = new LlmSettingsStore();
    await store.write(settings('http://127.0.0.1:1234/v1'));
    expect((await stat(join(dir, 'settings', 'llm.json'))).mode & 0o777).toBe(0o600);
    expect(await store.read()).toMatchObject({ baseUrl: 'http://127.0.0.1:1234/v1', apiKeys: ['secret-key'] });
  });
});

describe('LlmSettingsStore 서버별 API 키', () => {
  let dir: string;
  const before = { storage: process.env.STORAGE_DIR, base: process.env.LLM_BASE_URL, key: process.env.LLM_API_KEY };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llm-settings-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = before.storage;
    process.env.LLM_BASE_URL = before.base;
    process.env.LLM_API_KEY = before.key;
    await rm(dir, { recursive: true, force: true });
  });

  it('지금 주소의 키만 apiKeys로 꺼내고, 주소를 바꿔도 다른 서버의 키는 남는다', async () => {
    const store = new LlmSettingsStore();
    const byOrigin = { 'http://127.0.0.1:8888': ['u1', 'u2'], 'https://api.example.com': ['e1'] };
    await store.write({ ...settings('http://127.0.0.1:8888/v1'), apiKeysByOrigin: byOrigin });
    await expect(store.read()).resolves.toMatchObject({ apiKeys: ['u1', 'u2'], apiKeysByOrigin: byOrigin });
    await store.write({ ...settings('http://127.0.0.1:1234/v1', null), apiKeysByOrigin: byOrigin });
    await expect(store.read()).resolves.toMatchObject({ apiKeys: [], apiKeysByOrigin: byOrigin });
  });

  it('.env의 LLM_API_KEY는 쉼표로 여러 개를 넣고, 그 주소의 키가 된다', async () => {
    process.env.LLM_BASE_URL = 'https://api.example.com/v1';
    process.env.LLM_API_KEY = 'a, b,,a';
    await expect(new LlmSettingsStore().read()).resolves.toMatchObject({ apiKeys: ['a', 'b'], apiKeysByOrigin: { 'https://api.example.com': ['a', 'b'] } });
  });
});
