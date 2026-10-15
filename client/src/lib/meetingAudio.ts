// 회의 음성 입력 도우미: 녹음 형식 고르기, 시간 표시, 올릴 파일 확인.
import { MEETING_AUDIO_MAX_BYTES } from '@fantasteel/shared';
import { fmtBytes } from '@/lib/format';

/** 앞에 있을수록 먼저 쓴다. Safari는 webm을 못 녹음해 mp4로 내려간다 */
const RECORDER_MIME_ORDER = ['audio/webm;codecs=opus', 'audio/mp4'] as const;

/** 브라우저가 녹음할 수 있는 첫 형식. 없으면 undefined(브라우저 기본값) */
export function pickRecorderMimeType(isSupported: (mimeType: string) => boolean): string | undefined {
  return RECORDER_MIME_ORDER.find((mimeType) => isSupported(mimeType));
}

/** 경과 초 → mm:ss (한 시간이 넘으면 h:mm:ss) */
export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/** 녹음 Blob을 서버가 알아보는 파일 이름으로 */
export function recordingFileName(mimeType: string): string {
  return mimeType.includes('mp4') ? '회의-녹음.m4a' : '회의-녹음.webm';
}

/** 서버가 받는 형식(audio/* 또는 video/webm)이고 크기가 맞는지. 문제가 있으면 한국어 문구 */
export function audioFileProblem(file: { type: string; size: number }): string | null {
  const accepted = file.type.startsWith('audio/') || file.type === 'video/webm';
  if (!accepted) return '오디오 파일만 올릴 수 있어요';
  if (file.size === 0) return '음성이 비어 있어요';
  if (file.size > MEETING_AUDIO_MAX_BYTES) return `음성 파일은 ${fmtBytes(MEETING_AUDIO_MAX_BYTES)}까지 올릴 수 있어요 (지금 ${fmtBytes(file.size)})`;
  return null;
}

/** getUserMedia 실패를 한국어 안내로 */
export function microphoneErrorMessage(error: unknown, secureContext: boolean): string {
  if (!secureContext) return '마이크는 https 또는 localhost에서만 쓸 수 있어요';
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '마이크 사용이 막혀 있어요. 브라우저 주소창에서 마이크를 허용해 주세요';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '사용할 수 있는 마이크를 찾지 못했어요';
  if (name === 'NotReadableError') return '마이크를 다른 프로그램이 쓰고 있어요';
  return '마이크를 켜지 못했어요';
}
