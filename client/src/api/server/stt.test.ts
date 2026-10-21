// 음성 인식 연결 설정 어댑터: 요청 경로·본문, 파일 시험의 multipart 필드.
import type { SttConnectionView, SttSettingsView, SttTranscribeTestView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { sttApi } from '@/api/stt';
import { ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

afterEach(() => stopFakeServer());

const settings: SttSettingsView = { baseUrl: 'http://127.0.0.1:8000/v1', model: null, hasApiKey: false };

describe('음성 인식 연결 설정 (api/stt.ts)', () => {
  it('설정 조회·저장·연결 확인은 /stt 경로로 보낸다', async () => {
    const connection: SttConnectionView = { connected: true, baseUrl: settings.baseUrl, latencyMs: 120, error: null, models: [] };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => {
      if (c.path === '/stt/settings') return ok(settings);
      if (c.path === '/stt/connection-test') return ok(connection);
      return undefined;
    });
    await sttApi.getSettings();
    await sttApi.updateSettings({ baseUrl: settings.baseUrl, model: 'whisper-1', apiKey: 'sk-test' });
    const result = await sttApi.testConnection({ baseUrl: settings.baseUrl });
    expect(result.latencyMs).toBe(120);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /stt/settings', 'PUT /stt/settings', 'POST /stt/connection-test']);
    expect(calls[1].body).toEqual({ baseUrl: settings.baseUrl, model: 'whisper-1', apiKey: 'sk-test' });
  });

  it('파일로 시험: file 필드에 오디오를 담아 multipart로 보낸다', async () => {
    const view: SttTranscribeTestView = { ok: true, text: '안녕하세요', segmentCount: 1, durationSec: 2.5, latencyMs: 800, error: null };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path === '/stt/transcribe-test' ? ok(view) : undefined));
    const result = await sttApi.testTranscribe(new File(['abc'], '회의.m4a', { type: 'audio/mp4' }));
    expect(result.text).toBe('안녕하세요');
    const form = calls[0].body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('회의.m4a');
    expect(file.size).toBe(3);
  });

  it('같은 Mac의 음성 서버 상태·켜기·끄기는 /stt/local-server 경로로 보낸다', async () => {
    const view = { supported: true, installed: true, running: true, healthy: true, pid: 1, logPath: null, message: null };
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c: ServerCall) => (c.path.startsWith('/stt/local-server') ? ok(view) : undefined));
    await sttApi.getLocalServer();
    await sttApi.startLocalServer();
    await sttApi.stopLocalServer();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /stt/local-server', 'POST /stt/local-server/start', 'POST /stt/local-server/stop']);
  });
});
