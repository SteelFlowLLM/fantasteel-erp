// 음성 인식 서버 주소가 어느 쪽에 있는지 알려 주는 안내용 분류 (문서에 없는 기능, 이슈 #432).
// 막는 규칙이 아니다: 관리자가 넣는 서버 설정이라 어떤 주소든 저장은 되고, 화면이 종류와 주의점만 보여 준다.
import { STT_API_BASE_URL, STT_DEFAULT_BASE_URL } from '@fantasteel/shared';

export type SttHostKind = 'self' | 'lan' | 'tailscale' | 'internet' | 'unspecified' | 'invalid';

export const STT_HOST_KIND_LABEL: Record<SttHostKind, string> = {
  self: '이 서버 컴퓨터',
  lan: '같은 망의 다른 PC',
  tailscale: 'Tailscale',
  internet: '인터넷',
  unspecified: '접속할 수 없는 주소',
  invalid: '주소 확인 필요',
};

export interface SttHostInfo {
  kind: SttHostKind;
  /** 입력칸 아래에 보이는 한 줄 설명 */
  note: string;
  /** 경고로 보일 것인지 (음성이 암호화 없이 인터넷으로 나가는 경우 등) */
  warn: boolean;
}

function ipv4Of(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

export function classifySttHost(baseUrl: string): SttHostInfo {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { kind: 'invalid', note: 'http:// 또는 https://로 시작하는 주소를 넣어 주세요', warn: true };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'invalid', note: 'http:// 또는 https://로 시작하는 주소를 넣어 주세요', warn: true };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ip = ipv4Of(host);
  const secure = url.protocol === 'https:';

  if (host === '0.0.0.0' || host === '::') {
    return { kind: 'unspecified', note: '0.0.0.0은 서버를 띄울 때 쓰는 값이에요. 접속 주소에는 그 PC의 실제 주소(192.168.x.x 등)를 넣어요', warn: true };
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || ip?.[0] === 127) {
    return { kind: 'self', note: 'ERP 서버를 돌리는 컴퓨터에서 켠 음성 서버예요 (사용자 PC가 아니에요)', warn: false };
  }
  if (host.endsWith('.ts.net') || (ip && ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127)) {
    return { kind: 'tailscale', note: 'Tailscale로 연결된 PC예요. ERP 서버 컴퓨터에도 Tailscale이 켜져 있어야 해요', warn: false };
  }
  if (
    (ip && (ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 169 && ip[1] === 254))) ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    (!ip && !host.includes('.') && !host.includes(':'))
  ) {
    return { kind: 'lan', note: '같은 망의 PC예요. 그 PC에서 음성 서버를 0.0.0.0으로 띄우고 방화벽에서 포트를 열어야 해요', warn: false };
  }
  return secure
    ? { kind: 'internet', note: '인터넷의 서버예요. 회의 음성이 이 서버로 나가요', warn: false }
    : { kind: 'internet', note: '인터넷의 서버인데 https가 아니에요. 회의 음성이 암호화 없이 나가요. https:// 주소를 쓰거나 Tailscale로 연결해 주세요', warn: true };
}

export type SttMode = 'server' | 'api';

export const STT_MODE_LABEL: Record<SttMode, string> = {
  server: '내 음성 서버 (whisper.cpp · 화자 분리)',
  api: 'OpenAI 방식 음성 API',
};

/** 저장된 주소에서 방식을 짐작한다: 인터넷 주소면 API, 이 컴퓨터·같은 망·Tailscale이면 내 음성 서버 */
export function sttModeOf(baseUrl: string): SttMode {
  return classifySttHost(baseUrl).kind === 'internet' ? 'api' : 'server';
}

/** 방식을 바꿀 때 채우는 주소·모델 (API는 whisper-1이 필요하고 내 음성 서버는 모델을 비워 둬도 된다) */
export function sttModeDefaults(mode: SttMode): { baseUrl: string; model: string } {
  return mode === 'api' ? { baseUrl: STT_API_BASE_URL, model: 'whisper-1' } : { baseUrl: STT_DEFAULT_BASE_URL, model: '' };
}
