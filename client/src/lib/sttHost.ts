// 음성 인식 서버 주소가 어느 쪽에 있는지 알려 주는 안내용 분류 (문서에 없는 기능, 이슈 #432).
// 막는 규칙이 아니다: 관리자가 넣는 서버 설정이라 어떤 주소든 저장은 되고, 화면이 종류와 주의점만 보여 준다.
import { STT_API_BASE_URL, STT_API_DEFAULT_MODEL, STT_DEFAULT_BASE_URL, type SttModelOption } from '@fantasteel/shared';

export type SttHostKind = 'self' | 'lan' | 'tailscale' | 'internet' | 'unknown' | 'unspecified' | 'blocked' | 'invalid';

export const STT_HOST_KIND_LABEL: Record<SttHostKind, string> = {
  self: '이 서버 컴퓨터',
  lan: '같은 망의 다른 PC',
  tailscale: 'Tailscale',
  internet: '인터넷',
  unknown: '그 밖의 이름 주소',
  blocked: '쓸 수 없는 주소',
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
  if (/^169\.254\./.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) {
    return { kind: 'blocked', note: '링크 로컬(169.254.x.x) 주소는 음성 서버로 쓸 수 없어요 (클라우드 메타데이터 주소)', warn: true };
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || ip?.[0] === 127) {
    return { kind: 'self', note: 'ERP 서버를 돌리는 컴퓨터에서 켠 음성 서버예요 (사용자 PC가 아니에요)', warn: false };
  }
  if (host.endsWith('.ts.net') || (ip && ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127)) {
    return { kind: 'tailscale', note: 'Tailscale로 연결된 PC예요. ERP 서버 컴퓨터에도 Tailscale이 켜져 있어야 하고, 그 PC 터미널의 API 키를 넣어요', warn: false };
  }
  if (
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    (ip && (ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31))) ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    (!ip && !host.includes('.') && !host.includes(':'))
  ) {
    return { kind: 'lan', note: '같은 망의 PC예요. 그 PC에서 tools/voice-sidecar/start.sh로 켜고, 터미널에 보이는 API 키를 넣어요', warn: false };
  }
  // 점이 있는 이름은 사내 DNS일 수도 인터넷일 수도 있어 단정하지 않는다. 확실한 인터넷은 공인 IP와 api.openai.com뿐이다
  if (!ip && !host.includes(':') && host !== 'api.openai.com' && !host.endsWith('.openai.com')) {
    return {
      kind: 'unknown',
      note: secure
        ? '인터넷 주소라면 회의 음성이 이 서버로 나가요. 사내 이름이면 연결 확인으로 이 서버에서 닿는지 봐요'
        : '인터넷 주소라면 https가 아니어서 회의 음성이 암호화 없이 나가요. 사내 이름이면 무시해도 돼요',
      warn: false,
    };
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

/** 저장된 주소에서 방식을 짐작한다: 인터넷 주소(또는 https로 연결하는 모르는 이름)면 API, 이 컴퓨터·같은 망·Tailscale이면 내 음성 서버 */
export function sttModeOf(baseUrl: string): SttMode {
  const { kind } = classifySttHost(baseUrl);
  return kind === 'internet' || (kind === 'unknown' && baseUrl.trim().toLowerCase().startsWith('https:')) ? 'api' : 'server';
}

/** 방식을 바꿀 때 채우는 주소·모델 (API는 whisper-1이 필요하고 내 음성 서버는 모델을 비워 둬도 된다) */
export function sttModeDefaults(mode: SttMode): { baseUrl: string; model: string } {
  return mode === 'api' ? { baseUrl: STT_API_BASE_URL, model: STT_API_DEFAULT_MODEL } : { baseUrl: STT_DEFAULT_BASE_URL, model: '' };
}

/** 주소 출처(프로토콜+호스트+포트)가 같은가. 저장된 API 키를 새 주소로 보낼지 정할 때 쓴다 */
export function sameOriginUrl(a: string, b: string): boolean {
  try {
    return new URL(a.trim()).origin === new URL(b.trim()).origin;
  } catch {
    return false;
  }
}

/**
 * 연결 확인으로 받은 모델 목록을 고르기 칸 항목으로. 서버가 준 이름이 있으면 그 이름, 없으면 id.
 * 지금 고른 모델이 목록에 없으면 따로 표시해 선택이 사라지지 않게 한다.
 */
export function sttModelChoices(models: SttModelOption[], selected: string): { id: string; label: string; disabled: boolean }[] {
  const choices = models.map((m) => {
    const name = m.label ?? [m.id, m.diarization === true ? '화자 분리' : null].filter(Boolean).join(' · ');
    const unavailable = m.available === false ? ` — 지금 못 씀${m.note ? `: ${m.note}` : ''}` : '';
    return { id: m.id, label: `${name}${unavailable}`, disabled: false };
  });
  if (selected && !models.some((m) => m.id === selected)) choices.unshift({ id: selected, label: `${selected} (이 서버 목록에 없음)`, disabled: false });
  return choices;
}
