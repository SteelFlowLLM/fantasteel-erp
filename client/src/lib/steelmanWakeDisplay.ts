// 철강맨 부르기 (이슈 #494)의 화면 표시: 위쪽 띠의 문구·소리 크기 막대·말 시작 민감도.
// 마이크·소리 처리는 features/shell/SteelmanWake.tsx가 하고, 여기는 상태만 받아 글을 만들어 시험에서 바로 부를 수 있다.

/** 말 시작 민감도. 높을수록 작은 목소리도 말로 잡는다(주변 소리도 더 잡는다) */
export type WakeSensitivity = 'low' | 'normal' | 'high';

export const WAKE_SENSITIVITIES: readonly WakeSensitivity[] = ['low', 'normal', 'high'];

export const WAKE_SENSITIVITY_LABEL: Record<WakeSensitivity, string> = { low: '낮음', normal: '보통', high: '높음' };

/**
 * 말 시작으로 보는 최소 소리 크기(RMS, 가정값). 보통 0.015는 이슈 #457의 값, 높음은 작은 목소리·먼 마이크용, 낮음은 시끄러운 곳용.
 * 배경 소리 크기의 3배를 넘어야 하는 규칙(lib/voiceClip.ts)은 그대로다
 */
export const WAKE_START_RMS: Record<WakeSensitivity, number> = { low: 0.03, normal: 0.015, high: 0.007 };

export function parseWakeSensitivity(value: unknown): WakeSensitivity {
  return WAKE_SENSITIVITIES.includes(value as WakeSensitivity) ? (value as WakeSensitivity) : 'normal';
}

/** 받아쓴 글·물어본 질문을 띠에 잠깐 보이는 시간 (가정값). 화면 메모리에만 두고 지난 뒤 지운다 */
export const WAKE_ACTIVITY_MS = 5_000;
/** 띠에 보이는 들은 말 길이 */
export const WAKE_HEARD_MAX_CHARS = 40;

/** 띠에 잠깐 보이는 일. 받아쓴 글은 서버에 저장하지 않고 이 화면에만 몇 초 둔다 */
export type WakeActivity =
  | { kind: 'heard'; text: string; matched: boolean }
  | { kind: 'asking'; question: string }
  | { kind: 'answered' };

export type WakeBarStatus = 'off' | 'starting' | 'listening' | 'paused' | 'error';

export interface WakeBarInput {
  status: WakeBarStatus;
  /** 브라우저가 소리 처리를 멈춰 두었다 (화면을 한 번 눌러야 풀린다) */
  audioBlocked: boolean;
  hearing: boolean;
  transcribing: boolean;
  called: { reply: string; until: number } | null;
  activity: WakeActivity | null;
  /** 말로 물은 질문의 답을 기다리는 중 */
  answering: boolean;
  /** 철강맨이 답을 소리 내 읽는 중 (이슈 #507). 그동안 마이크는 쉰다 */
  speaking?: boolean;
  /** 명령을 말하는 동안 받은 중간 글 (이슈 #494) */
  partialText?: string | null;
  /** 8초에서 잘린 명령의 나머지를 듣는 중 */
  continuing?: boolean;
  now: number;
}

/** 띠 문구의 성격: 기다림(idle)·진행(busy)·사용자가 할 일(action)·문제(problem) */
export type WakeBarTone = 'idle' | 'busy' | 'action' | 'problem';

const shorten = (text: string): string => (text.length > WAKE_HEARD_MAX_CHARS ? `${text.slice(0, WAKE_HEARD_MAX_CHARS)}…` : text);

/**
 * 지금 띠에 보일 한 줄. 위에 있는 것이 먼저다: 마이크 상태 → 소리 처리 막힘 → 답하는 중 → 말하는 동안의 중간 글 → 잘린 명령 이어 듣기 →
 * "네?"·"이어서" 기다림 → 물어보는 중·답했어요 →
 * 받아쓰는 중 → 들은 말 → 말소리 잡는 중 → 기다림
 */
export function wakeBarLine(input: WakeBarInput): { text: string; tone: WakeBarTone } {
  if (input.status === 'starting') return { text: '마이크를 여는 중…', tone: 'busy' };
  if (input.status === 'paused') return { text: '탭이 숨겨져 잠깐 쉬어요', tone: 'idle' };
  if (input.status === 'error') return { text: '듣지 못하고 있어요', tone: 'problem' };
  if (input.audioBlocked) return { text: '화면을 한 번 눌러 주세요 · 브라우저가 소리 듣기를 멈춰 두었어요', tone: 'action' };
  if (input.speaking) return { text: '철강맨이 읽어 주는 중… 듣기는 잠깐 쉬어요', tone: 'busy' };
  if (input.answering) return { text: '철강맨이 답하는 중…', tone: 'busy' };
  if (input.hearing && input.partialText) return { text: `듣는 중: '${shorten(input.partialText)}'`, tone: 'busy' };
  if (input.continuing) return { text: '계속 듣는 중… 말이 끝나면 물어봐요', tone: 'busy' };
  if (input.called && input.now <= input.called.until) {
    const left = Math.max(0, Math.ceil((input.called.until - input.now) / 1000));
    return { text: `${input.called.reply} 말씀하세요 (${left}초)`, tone: 'action' };
  }
  const activity = input.activity;
  if (activity?.kind === 'asking') return { text: `물어보는 중: '${shorten(activity.question)}'`, tone: 'busy' };
  if (activity?.kind === 'answered') return { text: '답했어요', tone: 'idle' };
  if (input.transcribing) return { text: '받아쓰는 중…', tone: 'busy' };
  if (activity?.kind === 'heard') {
    return activity.matched ? { text: '철강맨을 불렀어요', tone: 'busy' } : { text: `들은 말: '${shorten(activity.text)}' (부르는 말이 아니라 넘겼어요)`, tone: 'idle' };
  }
  if (input.hearing) return { text: '듣는 중 · 말소리를 잡았어요', tone: 'busy' };
  return { text: '듣는 중 · "철강맨, 재고 알려줘"처럼 불러 주세요', tone: 'idle' };
}

/**
 * 소리 크기 막대의 길이(%). 말 시작 기준이 막대 가운데(50%)에 오게 한다: 가운데를 넘으면 말로 잡는다
 */
export function wakeLevelPercent(rms: number, threshold: number): number {
  if (!(threshold > 0) || !(rms > 0)) return 0;
  return Math.min(100, Math.round((rms / threshold) * 50));
}
