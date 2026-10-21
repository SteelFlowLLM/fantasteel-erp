// 회의 음성 입력 도우미: 녹음 형식 고르기, 시간 표시, 올릴 파일 확인.
import { hasMeetingAudioExtension, MEETING_AUDIO_EXTENSIONS, MEETING_AUDIO_MAX_BYTES } from '@fantasteel/shared';
import { fmtBytes } from '@/lib/format';
import { toSeoulDateString } from '@/lib/seoulDate';

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

/** 파일 선택창에 거는 형식: MIME을 못 알아내는 브라우저를 위해 확장자도 함께 건다 */
export const MEETING_AUDIO_ACCEPT = ['audio/*', 'video/webm', 'video/mp4', ...MEETING_AUDIO_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

/** 서버가 받는 형식이고 크기가 맞는지 (서버 isMeetingAudio와 같은 규칙). 문제가 있으면 한국어 문구 */
export function audioFileProblem(file: { type: string; size: number; name?: string }): string | null {
  const unknownType = file.type === '' || file.type === 'application/octet-stream';
  const accepted = file.type.startsWith('audio/') || file.type === 'video/webm' || file.type === 'video/mp4' || (unknownType && hasMeetingAudioExtension(file.name ?? ''));
  if (!accepted) return '오디오 파일만 올릴 수 있어요';
  if (file.size === 0) return '음성이 비어 있어요';
  if (file.size > MEETING_AUDIO_MAX_BYTES) return `음성 파일은 ${fmtBytes(MEETING_AUDIO_MAX_BYTES)}까지 올릴 수 있어요 (지금 ${fmtBytes(file.size)})`;
  return null;
}

/**
 * 고른 녹음 파일의 회의일 기본값: 파일이 마지막으로 바뀐 날짜(서울 기준, YYYY-MM-DD).
 * 지난 녹음을 올릴 때 회의일이 오늘이면 녹음 속 '내일' 같은 말이 엉뚱한 날짜가 된다. 시각을 알 수 없으면(0·잘못된 값) null
 */
export function meetingDateOfAudio(lastModified: number | string | null | undefined): string | null {
  if (lastModified === null || lastModified === undefined || lastModified === 0 || lastModified === '') return null;
  const at = new Date(lastModified);
  return Number.isNaN(at.getTime()) ? null : toSeoulDateString(at);
}

/**
 * 녹음 파일(또는 Drive 녹음)을 골랐을 때의 회의일. 파일 날짜를 알면 그 날짜로 바꾸되, 사용자가 회의일을 직접 고친 뒤이거나
 * 파일 날짜를 모르면 지금 값을 그대로 둔다 (직접 고른 날짜를 파일 선택이 덮어쓰지 않게)
 */
export function meetingDateAfterPick(current: string, edited: boolean, fileDate: string | null): string {
  return edited || fileDate === null ? current : fileDate;
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

/**
 * 녹음 시작 한 번을 지키는 표 (이슈 #476). 권한 창이 떠 있는 동안 [녹음 시작]을 또 눌러도 마이크·타이머가 하나 더 생기지 않고,
 * 권한 창이 떠 있는 사이 화면을 옮겨(cancel) 나중에 허락해도 그 마이크를 바로 끄도록 부른 쪽이 isCurrent로 확인한다.
 */
export interface RecordStartGuard {
  /** 시작할 수 있으면 이번 시작의 번호, 이미 시작 중·녹음 중이거나 취소됐으면 null */
  begin: () => number | null;
  /** 이번 시작이 아직 유효한지 (그 사이 취소·다른 시작이 없었는지) */
  isCurrent: (token: number) => boolean;
  /** 시작 중·녹음 중 표시를 푼다 (녹음이 끝났거나 시작에 실패했을 때) */
  end: () => void;
  /** 화면을 떠난다: 진행 중이던 시작은 모두 무효가 되고 더는 시작할 수 없다 */
  cancel: () => void;
}

export function createRecordStartGuard(): RecordStartGuard {
  let busy = false;
  let cancelled = false;
  let token = 0;
  return {
    begin: () => {
      if (busy || cancelled) return null;
      busy = true;
      token += 1;
      return token;
    },
    isCurrent: (value) => !cancelled && value === token,
    end: () => {
      busy = false;
    },
    cancel: () => {
      cancelled = true;
      busy = false;
      token += 1;
    },
  };
}
