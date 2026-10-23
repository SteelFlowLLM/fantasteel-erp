// LlmService (이슈 #465): 사진·생각 정도 지원 저장, 연결 확인 결과의 서버 종류, Unsloth 모델 없음 안내를 가짜 저장소·클라이언트로 확인한다.
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSettingsStore } from './browser-settings.store';
import { LlmClient, LlmModelNotLoadedError, LlmRequestError, unslothNotLoadedMessage } from './llm.client';
import { LlmSettingsStore, type LlmSettings } from './llm-settings.store';
import { LlmService } from './llm.service';

const saved: LlmSettings = {
  baseUrl: 'http://127.0.0.1:8888/v1',
  model: 'a/think',
  apiKeys: ['k'],
  apiKeysByOrigin: { 'http://127.0.0.1:8888': ['k'] },
  visionSupport: null,
  reasoningSupport: null,
  contextLength: null,
};
const idOf = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

function setup(settings: LlmSettings = saved) {
  const store = { read: jest.fn(async () => settings), write: jest.fn(async () => undefined) };
  const client = { listModels: jest.fn(), serverSummary: jest.fn(), chat: jest.fn(), forgetServerInfo: jest.fn(), keyUsageOf: jest.fn(() => null) };
  const service = new LlmService(store as unknown as LlmSettingsStore, client as unknown as LlmClient, {} as BrowserSettingsStore);
  return { store, client, service };
}

describe('LlmService 사진·생각 정도 지원 (이슈 #465)', () => {
  it('보내지 않으면 그대로 두고, 보내면 바꾸고, null이면 모름으로 저장한다', async () => {
    const { store, service } = setup({ ...saved, visionSupport: true, reasoningSupport: false });
    await expect(service.updateSettings({ baseUrl: saved.baseUrl, model: 'a/think' })).resolves.toMatchObject({ visionSupport: true, reasoningSupport: false });
    await expect(service.updateSettings({ baseUrl: saved.baseUrl, model: 'a/think', visionSupport: null, reasoningSupport: true, contextLength: 32768 })).resolves.toMatchObject({
      visionSupport: null,
      reasoningSupport: true,
      contextLength: 32768,
    });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKeys: ['k'], visionSupport: null, reasoningSupport: true, contextLength: 32768 }));
  });

  it('연결 확인 결과에 서버 종류와 auto-switch를 싣고, 실패하면 둘 다 null', async () => {
    const { client, service } = setup();
    client.listModels.mockResolvedValueOnce([]);
    client.serverSummary.mockResolvedValueOnce({ kind: 'unsloth', autoSwitch: false });
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: true, serverKind: 'unsloth', autoSwitch: false });
    // 키를 보내지 않으면 저장된 키로 확인한다
    expect(client.listModels).toHaveBeenCalledWith({ baseUrl: saved.baseUrl, apiKey: 'k', apiKeys: ['k'] });

    client.listModels.mockRejectedValueOnce(new LlmRequestError('x', undefined, 'NO_MODEL'));
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: false, serverKind: null, autoSwitch: null, error: 'x' });
  });

  it('응답 확인: 관리자 설정을 함께 넘기고, Unsloth 모델 없음은 안내 문구로 돌려준다', async () => {
    const { client, service } = setup({ ...saved, reasoningSupport: true });
    client.chat.mockRejectedValueOnce(new LlmModelNotLoadedError(unslothNotLoadedMessage('a/think', ['b/plain'])));
    const result = await service.testChat();
    expect(result).toMatchObject({ ok: false, model: 'a/think' });
    expect(result.error).toContain('Settings > API > Model auto-switch');
    expect(client.chat.mock.calls[0][0]).toEqual({ baseUrl: saved.baseUrl, apiKey: 'k', apiKeys: ['k'], visionSupport: null, reasoningSupport: true, contextLength: null });
  });
});

describe('LlmService 서버별 API 키', () => {
  const twoServers: LlmSettings = { ...saved, apiKeysByOrigin: { 'http://127.0.0.1:8888': ['k'], 'https://llm.example.com': ['e1', 'e2'] } };

  it('주소를 바꾸면 그 서버에 저장한 키로 확인하고, 키가 없는 서버로는 다른 서버의 키를 보내지 않는다', async () => {
    const { client, service } = setup(twoServers);
    client.listModels.mockResolvedValue([]);
    client.serverSummary.mockResolvedValue({ kind: 'openai', autoSwitch: null });
    await service.testConnection({ baseUrl: 'https://llm.example.com/v1' });
    expect(client.listModels).toHaveBeenLastCalledWith({ baseUrl: 'https://llm.example.com/v1', apiKey: 'e1', apiKeys: ['e1', 'e2'] });
    await service.testConnection({ baseUrl: 'http://127.0.0.1:1234/v1' });
    expect(client.listModels).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null, apiKeys: [] });
    // 다른 서버의 키 id를 보내도 그 서버로는 가지 않는다
    await service.testConnection({ baseUrl: 'http://127.0.0.1:1234/v1', apiKeys: [{ id: idOf('k') }] });
    expect(client.listModels).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null, apiKeys: [] });
  });

  it('저장: 저장된 키는 id로, 새 키는 값으로 받아 보낸 순서대로 두고, 다른 서버의 키는 그대로 둔다', async () => {
    const { store, client, service } = setup(twoServers);
    const view = await service.updateSettings({ baseUrl: 'https://llm.example.com/v1', model: 'm', apiKeys: [{ value: ' new ' }, { id: idOf('e2') }, { id: 'unknown' }] });
    expect(store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKeys: ['new', 'e2'], apiKeysByOrigin: { 'http://127.0.0.1:8888': ['k'], 'https://llm.example.com': ['new', 'e2'] } }),
    );
    expect(view.hasApiKey).toBe(true);
    expect(view.apiKeysByOrigin['https://llm.example.com']).toEqual([
      { id: idOf('new'), hint: '…new', state: null, usedAt: null },
      { id: idOf('e2'), hint: '…e2', state: null, usedAt: null },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/"e2"|"new"|"k"/);
    expect(client.forgetServerInfo).toHaveBeenCalledTimes(1);
  });

  it('키를 보내지 않으면 그 주소의 키를 그대로, 빈 배열이면 그 주소의 키만 지운다', async () => {
    const { store, service } = setup(twoServers);
    await service.updateSettings({ baseUrl: 'https://llm.example.com/v1', model: 'm' });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKeys: ['e1', 'e2'] }));
    await service.updateSettings({ baseUrl: 'https://llm.example.com/v1', model: 'm', apiKeys: [] });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKeys: [], apiKeysByOrigin: { 'http://127.0.0.1:8888': ['k'] } }));
  });

  it('화면에 키마다 마지막으로 쓴 결과를 보인다', async () => {
    const { client, service } = setup();
    client.keyUsageOf.mockReturnValueOnce({ state: 'limited', at: new Date('2026-10-23T01:00:00Z') } as never);
    const view = await service.getSettings();
    expect(view.apiKeysByOrigin['http://127.0.0.1:8888']).toEqual([{ id: idOf('k'), hint: '…k', state: 'limited', usedAt: '2026-10-23T01:00:00.000Z' }]);
  });
});

describe('LlmSettingsStore 옛 파일', () => {
  let dir: string;
  const previous = process.env.STORAGE_DIR;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llm-settings-'));
    process.env.STORAGE_DIR = dir;
  });
  afterEach(async () => {
    process.env.STORAGE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it('지원 칸이 없는 옛 llm.json은 모름(null)으로 읽는다', async () => {
    await mkdir(join(dir, 'settings'), { recursive: true });
    await writeFile(join(dir, 'settings', 'llm.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: null }));
    await expect(new LlmSettingsStore().read()).resolves.toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKeys: [], apiKeysByOrigin: {}, visionSupport: null, reasoningSupport: null, contextLength: null });
  });

  it('키가 하나뿐이던 옛 llm.json은 그 주소의 키로 읽는다', async () => {
    await mkdir(join(dir, 'settings'), { recursive: true });
    await writeFile(join(dir, 'settings', 'llm.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:8888/v1', model: 'm', apiKey: 'old' }));
    await expect(new LlmSettingsStore().read()).resolves.toMatchObject({ apiKeys: ['old'], apiKeysByOrigin: { 'http://127.0.0.1:8888': ['old'] } });
  });
});
