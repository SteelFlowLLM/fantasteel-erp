// 음성 인식(STT) 연결 설정 (문서에 없는 기능, Voice2ERP 1단계). LLM 연결(api/llm.ts)과 같은 구조:
// 브라우저가 Whisper 서버를 직접 부르지 않고 ERP 서버를 거친다.
import type { SteelmanWakeSettingsInput, SteelmanWakeSettingsView, SttConnectionTestInput, SttConnectionView, SttLocalServerView, SttSettingsInput, SttSettingsView, SttTranscribeTestView, SttWakeClipView } from '@fantasteel/shared';
import { serverRequest, serverUpload } from '@/api/http';

export const sttKeys = {
  settings: () => ['stt', 'settings'] as const,
  localServer: () => ['stt', 'local-server'] as const,
  wakeSettings: () => ['stt', 'wake-settings'] as const,
  savedConnection: () => ['stt', 'saved-connection'] as const,
};

export const sttApi = {
  getSettings: (): Promise<SttSettingsView> => serverRequest('GET', '/stt/settings'),
  updateSettings: (input: SttSettingsInput): Promise<SttSettingsView> => serverRequest('PUT', '/stt/settings', { body: input }),
  testConnection: (input: SttConnectionTestInput): Promise<SttConnectionView> => serverRequest('POST', '/stt/connection-test', { body: input }),
  /** 저장된 설정으로 오디오 파일 1개를 글로 바꿔 본다 */
  testTranscribe: (file: File): Promise<SttTranscribeTestView> => {
    const form = new FormData();
    form.append('file', file, file.name);
    return serverUpload('/stt/transcribe-test', form);
  },
  /** 철강맨 부르기 회사 설정 (이슈 #457) */
  getWakeSettings: (): Promise<SteelmanWakeSettingsView> => serverRequest('GET', '/stt/wake-settings'),
  updateWakeSettings: (input: SteelmanWakeSettingsInput): Promise<SteelmanWakeSettingsView> => serverRequest('PUT', '/stt/wake-settings', { body: input }),
  /** 철강맨 부르기 (이슈 #457): 말소리 조각(16kHz WAV) 하나를 글로. 소리는 서버에 남지 않는다 */
  transcribeWakeClip: (wav: Blob): Promise<SttWakeClipView> => {
    const form = new FormData();
    form.append('file', wav, 'wake.wav');
    return serverUpload('/stt/wake-clip', form);
  },
  /** ERP 서버와 같은 Mac의 음성 서버(자동 켜기 등록분) 상태·켜기·끄기 (이슈 #450) */
  getLocalServer: (): Promise<SttLocalServerView> => serverRequest('GET', '/stt/local-server'),
  startLocalServer: (): Promise<SttLocalServerView> => serverRequest('POST', '/stt/local-server/start'),
  stopLocalServer: (): Promise<SttLocalServerView> => serverRequest('POST', '/stt/local-server/stop'),
};
