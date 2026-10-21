// 음성 인식(STT) 연결 설정 (문서에 없는 기능, Voice2ERP 1단계). LLM 연결과 같은 구조:
// whisper.cpp 로컬 서버, API 키로 여는 내 Mac의 화자 분리 사이드카(이슈 #445), OpenAI 호환 음성 API. 모두 /v1/audio/transcriptions를 쓴다.

/** whisper.cpp whisper-server 기본 주소 (README의 실행 예시와 같은 포트) */
export const STT_DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1';

/** OpenAI 방식 음성 API를 고를 때 채우는 값 */
export const STT_API_BASE_URL = 'https://api.openai.com/v1';
export const STT_API_DEFAULT_MODEL = 'whisper-1';

export interface SttSettingsView {
  baseUrl: string;
  /** whisper.cpp는 모델 이름을 무시한다. OpenAI는 whisper-1 같은 이름이 필요하다. 비우면 null */
  model: string | null;
  /** API 키는 돌려주지 않고 있는지만 알린다 */
  hasApiKey: boolean;
}

export interface SttSettingsInput {
  baseUrl: string;
  model: string | null;
  /** 보내지 않으면 그대로 두고, 빈 문자열이면 지운다 */
  apiKey?: string;
}

export interface SttConnectionTestInput {
  baseUrl: string;
  /** 화면에 입력한(저장 전) 모델. 보내지 않으면 저장된 모델을 쓴다. null이면 모델 이름 없이 확인한다 */
  model?: string | null;
  /** 보내지 않으면 저장된 API 키를 쓴다 */
  apiKey?: string;
}

/** 음성 서버가 GET /models로 알려 준 모델. 사이드카는 화면용 이름·화자 분리 여부·준비 상태를 함께 준다 */
export interface SttModelOption {
  id: string;
  /** 화면에 보일 이름 (예: '받아쓰기 + 화자 분리 (whisper + pyannote)'). 서버가 주지 않으면 null */
  label: string | null;
  /** 화자를 나누는 모델인가. 모르면 null */
  diarization: boolean | null;
  /** 지금 바로 쓸 수 있는가 (엔진이 꺼졌거나 모델 파일이 없으면 false). 모르면 null */
  available: boolean | null;
  /** 쓸 수 없는 이유 등 */
  note: string | null;
}

export interface SttConnectionView {
  connected: boolean;
  baseUrl: string;
  /** 응답까지 걸린 시간(ms). 연결 실패면 null */
  latencyMs: number | null;
  /** 연결 실패 이유 (화면에 그대로 보인다) */
  error: string | null;
  /** 음성 서버가 알려 준 모델 목록. /models가 없는 서버(whisper.cpp 단독)나 실패면 빈 배열 */
  models: SttModelOption[];
}

export interface SttTranscribeTestView {
  ok: boolean;
  text: string | null;
  segmentCount: number | null;
  /** 서버가 알려 준 오디오 길이(초). 모르면 null */
  durationSec: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** ERP 서버와 같은 Mac에 등록된 음성 서버(LaunchAgent, tools/voice-sidecar/start.sh --install)의 상태 (이슈 #450) */
export interface SttLocalServerView {
  /** ERP 서버가 macOS라 화면에서 켜고 끌 수 있는가 */
  supported: boolean;
  /** 자동 켜기가 등록되어 있는가 */
  installed: boolean;
  running: boolean;
  /** 127.0.0.1:8001/health가 답하는가 (켜졌어도 모델을 올리는 동안은 false) */
  healthy: boolean;
  pid: number | null;
  logPath: string | null;
  /** 화면에 보일 안내 (등록 방법, 켜는 중 등) */
  message: string | null;
}

/**
 * 철강맨 부르기 (이슈 #457, 문서에 없는 기능): 브라우저가 소리 크기로 잡은 말소리 조각 하나를 글로 바꾼다.
 * 조각은 16kHz·모노 WAV라 8초면 약 256KB다. 사원당 1분 횟수는 계속 켜 둔 마이크가 음성 서버를 독차지하지 않게 하는 가정값이다.
 */
export const STT_WAKE_CLIP_LIMITS = { maxSeconds: 8, maxBytes: 512 * 1024, perMinute: 30 } as const;

/** POST stt/wake-clip. 소리는 저장하지 않고 글만 돌려준다. 음성 서버에 닿지 않으면 text 없이 이유를 준다 */
export interface SttWakeClipView {
  text: string | null;
  error: string | null;
}
