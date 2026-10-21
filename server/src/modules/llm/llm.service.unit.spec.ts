// LlmService (이슈 #465): 사진·생각 정도 지원 저장, 연결 확인 결과의 서버 종류, Unsloth 모델 없음 안내를 가짜 저장소·클라이언트로 확인한다.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSettingsStore } from './browser-settings.store';
import { LlmClient, LlmModelNotLoadedError, LlmRequestError, unslothNotLoadedMessage } from './llm.client';
import { LlmSettingsStore, type LlmSettings } from './llm-settings.store';
import { LlmService } from './llm.service';

const saved: LlmSettings = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'a/think', apiKey: 'k', visionSupport: null, reasoningSupport: null, contextLength: null };

function setup(settings: LlmSettings = saved) {
  const store = { read: jest.fn(async () => settings), write: jest.fn(async () => undefined) };
  const client = { listModels: jest.fn(), serverSummary: jest.fn(), chat: jest.fn(), forgetServerInfo: jest.fn() };
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
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'k', visionSupport: null, reasoningSupport: true, contextLength: 32768 }));
  });

  it('연결 확인 결과에 서버 종류와 auto-switch를 싣고, 실패하면 둘 다 null', async () => {
    const { client, service } = setup();
    client.listModels.mockResolvedValueOnce([]);
    client.serverSummary.mockResolvedValueOnce({ kind: 'unsloth', autoSwitch: false });
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: true, serverKind: 'unsloth', autoSwitch: false });
    // 키를 보내지 않으면 저장된 키로 확인한다
    expect(client.listModels).toHaveBeenCalledWith({ baseUrl: saved.baseUrl, apiKey: 'k' });

    client.listModels.mockRejectedValueOnce(new LlmRequestError('x', undefined, 'NO_MODEL'));
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: false, serverKind: null, autoSwitch: null, error: 'x' });
  });

  it('응답 확인: 관리자 설정을 함께 넘기고, Unsloth 모델 없음은 안내 문구로 돌려준다', async () => {
    const { client, service } = setup({ ...saved, reasoningSupport: true });
    client.chat.mockRejectedValueOnce(new LlmModelNotLoadedError(unslothNotLoadedMessage('a/think', ['b/plain'])));
    const result = await service.testChat();
    expect(result).toMatchObject({ ok: false, model: 'a/think' });
    expect(result.error).toContain('Settings > API > Model auto-switch');
    expect(client.chat.mock.calls[0][0]).toEqual({ baseUrl: saved.baseUrl, apiKey: 'k', visionSupport: null, reasoningSupport: true, contextLength: null });
  });
});

describe('LlmService 주소가 바뀌면 저장된 키를 보내지 않는다', () => {
  it('출처가 같으면 저장된 키, 다르면 키 없이 확인하고 실패하면 다시 넣으라고 알린다', async () => {
    const { client, service } = setup();
    client.listModels.mockResolvedValue([]);
    client.serverSummary.mockResolvedValue({ kind: 'openai', autoSwitch: null });
    await service.testConnection({ baseUrl: 'http://127.0.0.1:8888/v1/' });
    expect(client.listModels).toHaveBeenLastCalledWith({ baseUrl: 'http://127.0.0.1:8888/v1', apiKey: 'k' });
    await service.testConnection({ baseUrl: 'https://llm.example.com/v1' });
    expect(client.listModels).toHaveBeenLastCalledWith({ baseUrl: 'https://llm.example.com/v1', apiKey: null });

    client.listModels.mockRejectedValueOnce(new LlmRequestError('API 키가 맞지 않거나 권한이 없어요'));
    const failed = await service.testConnection({ baseUrl: 'https://llm.example.com/v1' });
    expect(failed.error).toBe('API 키가 맞지 않거나 권한이 없어요. 주소가 바뀌어 저장된 API 키를 보내지 않았어요. 새 주소의 API 키를 다시 넣어 주세요');
  });

  it('저장할 때 출처가 바뀌고 키를 보내지 않으면 키를 지우고, 기억해 둔 서버 정보를 버린다', async () => {
    const { store, client, service } = setup();
    await service.updateSettings({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm' });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }));
    await service.updateSettings({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: 'new' });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'new' }));
    expect(client.forgetServerInfo).toHaveBeenCalledTimes(2);
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
    await expect(new LlmSettingsStore().read()).resolves.toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: null, visionSupport: null, reasoningSupport: null, contextLength: null });
  });
});
