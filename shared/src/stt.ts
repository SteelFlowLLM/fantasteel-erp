// 음성 인식(STT) 연결 설정 (문서에 없는 기능, Voice2ERP 1단계). LLM 연결과 같은 구조:
// 지금은 whisper.cpp 로컬 서버, 나중에 API 키를 쓰는 OpenAI 호환 서버. 둘 다 /v1/audio/transcriptions를 쓴다.

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

export interface SttConnectionView {
  connected: boolean;
  baseUrl: string;
  /** 응답까지 걸린 시간(ms). 연결 실패면 null */
  latencyMs: number | null;
  /** 연결 실패 이유 (화면에 그대로 보인다) */
  error: string | null;
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
