// LlmService (이슈 #465): 사진·생각 정도 지원 저장, 연결 확인 결과의 서버 종류, Unsloth 모델 없음 안내를 가짜 저장소·클라이언트로 확인한다.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSettingsStore } from './browser-settings.store';
import { LlmClient, LlmModelNotLoadedError, unslothNotLoadedMessage } from './llm.client';
import { LlmSettingsStore, type LlmSettings } from './llm-settings.store';
import { LlmService } from './llm.service';

const saved: LlmSettings = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'a/think', apiKey: 'k', visionSupport: null, reasoningSupport: null };

function setup(settings: LlmSettings = saved) {
  const store = { read: jest.fn(async () => settings), write: jest.fn(async () => undefined) };
  const client = { listModels: jest.fn(), serverSummary: jest.fn(), chat: jest.fn() };
  const service = new LlmService(store as unknown as LlmSettingsStore, client as unknown as LlmClient, {} as BrowserSettingsStore);
  return { store, client, service };
}

describe('LlmService 사진·생각 정도 지원 (이슈 #465)', () => {
  it('보내지 않으면 그대로 두고, 보내면 바꾸고, null이면 모름으로 저장한다', async () => {
    const { store, service } = setup({ ...saved, visionSupport: true, reasoningSupport: false });
    await expect(service.updateSettings({ baseUrl: saved.baseUrl, model: 'a/think' })).resolves.toMatchObject({ visionSupport: true, reasoningSupport: false });
    await expect(service.updateSettings({ baseUrl: saved.baseUrl, model: 'a/think', visionSupport: null, reasoningSupport: true })).resolves.toMatchObject({
      visionSupport: null,
      reasoningSupport: true,
    });
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'k', visionSupport: null, reasoningSupport: true }));
  });

  it('연결 확인 결과에 서버 종류와 auto-switch를 싣고, 실패하면 둘 다 null', async () => {
    const { client, service } = setup();
    client.listModels.mockResolvedValueOnce([]);
    client.serverSummary.mockResolvedValueOnce({ kind: 'unsloth', autoSwitch: false });
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: true, serverKind: 'unsloth', autoSwitch: false });
    // 키를 보내지 않으면 저장된 키로 확인한다
    expect(client.listModels).toHaveBeenCalledWith({ baseUrl: saved.baseUrl, apiKey: 'k' });

    client.listModels.mockRejectedValueOnce(new LlmModelNotLoadedError('x'));
    await expect(service.testConnection({ baseUrl: saved.baseUrl })).resolves.toMatchObject({ connected: false, serverKind: null, autoSwitch: null, error: 'x' });
  });

  it('응답 확인: 관리자 설정을 함께 넘기고, Unsloth 모델 없음은 안내 문구로 돌려준다', async () => {
    const { client, service } = setup({ ...saved, reasoningSupport: true });
    client.chat.mockRejectedValueOnce(new LlmModelNotLoadedError(unslothNotLoadedMessage('a/think', ['b/plain'])));
    const result = await service.testChat();
    expect(result).toMatchObject({ ok: false, model: 'a/think' });
    expect(result.error).toContain('Settings > API > Model auto-switch');
    expect(client.chat.mock.calls[0][0]).toEqual({ baseUrl: saved.baseUrl, apiKey: 'k', visionSupport: null, reasoningSupport: true });
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
    await expect(new LlmSettingsStore().read()).resolves.toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: null, visionSupport: null, reasoningSupport: null });
  });
});
