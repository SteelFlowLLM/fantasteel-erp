// 철강맨 부르기 (이슈 #457, 문서에 없는 기능): 받아쓴 글에서 부르는 말을 찾고, 뒤의 말을 명령·질문으로 나누고, 말로 승인을 판정한다.
// 받아쓰기는 whisper라 '철강 맨'·'철강만'처럼 띄어 쓰거나 비슷한 글자로 틀리는 일이 많아 넉넉히 받는다.
// 소리를 잡고 보내는 쪽은 lib/voiceClip.ts, 화면은 features/shell/SteelmanWake.tsx.
import { AI_VOICE_APPROVABLE_KINDS, type AiActionCard } from '@fantasteel/shared';
import { missingOfCard } from '@/lib/aiActionCard';
import type { AiChatCard, AiChatEntry } from '@/stores/useAiChatStore';

/** "철강맨"만 부른 뒤 다음 말을 질문으로 받는 시간 (가정값) */
export const WAKE_FOLLOW_UP_MS = 8_000;
/** 말로 물은 답이 끝난 뒤 부르는 말 없이 다음 질문을 받는 시간 (이어 말하기, 이슈 #494, 가정값) */
export const CONVERSATION_FOLLOW_UP_MS = 10_000;
/** 이어 말하기의 대답 (띠에 "이어서 말씀하세요 (n초)") */
export const FOLLOW_UP_REPLY = '이어서';
/** 8초에서 잘린 명령의 나머지를 기다리는 가장 긴 시간. 보통은 말이 끝나고 조용해지면 바로 묻는다 (가정값) */
export const COMMAND_CONTINUE_MS = 32_000;
/** 잘린 명령 뒤 이만큼 아무 말이 없으면 들은 데까지 묻는다 (가정값) */
export const COMMAND_QUIET_MS = 1_500;

/** 말로 승인에서 카드를 보인 뒤 "실행"을 기다리는 시간 (가정값) */
export const VOICE_APPROVAL_MS = 10_000;
/** "철강맨"만 불렀을 때 번갈아 하는 대답 */
export const WAKE_REPLIES = ['네?', '불렀나요?'] as const;

// 철강맨 / 철강맨아 / 철강맨님 / 철강아 (+ whisper가 흔히 틀리는 철광·철갱, 만·멘·맹, 띄어쓰기). 뒤는 끝·띄어쓰기·문장부호여야 한다:
// "철강맨이 뭐야"처럼 철강맨을 두고 하는 말이나 "철강아연"은 부른 것이 아니다
const WAKE_PATTERN = /^[\s"'“”‘’.,!?~…·-]*(?:철\s*[강광갱]\s*(?:[맨만멘맹]\s*(?:님|아|야|씨)?|[아야]))(?=$|[\s.,!?~…·])[\s.,!?~…·]*/;

export type WakeMatch = { called: false } | { called: true; rest: string };

/** 글이 부르는 말로 시작하면 뒤의 말을 돌려준다 (빈 글이면 "철강맨"만 부른 것) */
export function matchWakeWord(text: string): WakeMatch {
  const found = WAKE_PATTERN.exec(text);
  if (!found) return { called: false };
  return { called: true, rest: text.slice(found[0].length).trim() };
}

export type VoiceCommand =
  | { kind: 'empty' }
  | { kind: 'stop' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'newChat' }
  | { kind: 'screenControl'; on: boolean }
  /** index: 1부터 센 카드 순서. 없으면 가장 최근 카드 */
  | { kind: 'approve'; index: number | null }
  | { kind: 'ask'; question: string };

/** 띄어쓰기·문장부호·끝의 높임말을 떼어 짧은 명령을 비교하기 쉽게 한다 */
export function compactSpeech(text: string): string {
  return text
    .replace(/[\s"'“”‘’.,!?~…·-]/g, '')
    .replace(/(?:해\s*)?(?:주세요|주십시오|줘요|줘|요)$/, '')
    .trim();
}

const STOP_WORDS = new Set(['멈춰', '그만', '그만해', '중지', '스톱', '멈춰라', '답멈춰', '그만둬']);
const PAUSE_WORDS = new Set(['잠깐', '잠깐만', '일시정지', '잠시멈춰', '잠깐멈춰']);
const RESUME_WORDS = new Set(['계속', '계속해', '계속하', '다시해', '이어서해', '진행해']);
const NEW_CHAT_WORDS = new Set(['새대화', '새대화시작', '새대화해', '새로대화', '대화새로시작']);
const ORDINALS: Record<string, number> = { 첫: 1, 일: 1, '1': 1, 두: 2, 둘: 2, 이: 2, '2': 2, 세: 3, 셋: 3, 삼: 3, '3': 3, 네: 4, 넷: 4, 사: 4, '4': 4, 다섯: 5, 오: 5, '5': 5 };

/**
 * 부르는 말 뒤의 말을 명령으로 읽는다. 명령은 말 전체가 그 명령일 때만이다:
 * "멈춰 있는 설비 알려줘"는 멈추기가 아니라 질문이다. 나머지는 모두 질문("아까 그 얘기 이어서"도 질문, 지난 대화 찾기 도구가 있다)
 */
export function parseVoiceCommand(rest: string): VoiceCommand {
  const question = rest.trim();
  const compact = compactSpeech(question);
  if (!compact) return { kind: 'empty' };
  if (STOP_WORDS.has(compact)) return { kind: 'stop' };
  if (PAUSE_WORDS.has(compact)) return { kind: 'pause' };
  if (RESUME_WORDS.has(compact)) return { kind: 'resume' };
  if (NEW_CHAT_WORDS.has(compact)) return { kind: 'newChat' };
  const screen = /^화면조작(켜|켜기|켜줘|시작|꺼|끄기|꺼줘|그만)$/.exec(compact);
  if (screen) return { kind: 'screenControl', on: screen[1].startsWith('켜') || screen[1] === '시작' };
  const approve = /^(?:(이거|이것|그거|그것|이카드|그카드|카드)|(첫|두|둘|세|셋|네|넷|다섯|[1-5]|일|이|삼|사|오)(?:번째|번)(?:카드|거|것)?)?(?:을|를)?실행(?:해|하|시켜)?$/.exec(compact);
  if (approve && (approve[1] || approve[2])) return { kind: 'approve', index: approve[2] ? ORDINALS[approve[2]] : null };
  return { kind: 'ask', question };
}

/**
 * 말로 승인 기다리는 중에 들은 말: 실행 / 취소 / 상관없는 말(= 취소).
 * whisper는 "실행" 한 낱말을 "시행"으로 자주 받아써서 함께 받는다 (10초 창 안에서만 듣는 말이라 잘못 실행될 일이 적다)
 */
export function confirmationOf(text: string): 'yes' | 'no' {
  const wake = matchWakeWord(text);
  const compact = compactSpeech(wake.called ? wake.rest : text);
  return /^(?:(?:응|네|예|그래|좋아)?(?:실행|시행)(?:해|하|시켜)?|응해|응그래해|네해|예해)$/.test(compact) ? 'yes' : 'no';
}

const CONVERSATION_END_WORDS = new Set(['그만', '그만해', '고마워', '고맙습니다', '고마워요', '감사합니다', '됐어', '됐다', '괜찮아', '끝', '끝내', '없어', '아니야', '아니', '아니요', '이제됐어', '수고했어']);

/** 이어 말하기 중 대화를 끝내는 말 ("그만", "고마워", "됐어" 등). 부르는 말이 앞에 있어도 된다 */
export function isConversationEnd(text: string): boolean {
  const wake = matchWakeWord(text);
  return CONVERSATION_END_WORDS.has(compactSpeech(wake.called ? wake.rest : text));
}

// whisper가 조용한 소리·잡음에 지어내는 말 (방송 자막에서 배운 끝인사). "철강맨"만 부른 뒤에는 부르는 말 없이 받으므로 이런 글은 질문으로 받지 않는다
const HALLUCINATIONS = ['감사합니다', '시청해주셔서감사합니다', '시청해주셔서고맙습니다', '구독과좋아요부탁드립니다', '구독과좋아요', '다음영상에서만나요', '고맙습니다', '네', '음', '아'];

export function isLikelyHallucination(text: string): boolean {
  const compact = text.replace(/[\s"'“”‘’.,!?~…·-]/g, '');
  return compact.length === 0 || HALLUCINATIONS.includes(compact) || /^(?:MBC|KBS|SBS|YTN).*뉴스/.test(compact);
}

export type VoiceApprovalPick = { ok: true; entryId: string; messageId?: number; item: AiChatCard } | { ok: false; reason: string };

export const isVoiceApprovable = (card: AiActionCard): boolean => AI_VOICE_APPROVABLE_KINDS.includes(card.kind);

/**
 * 말로 실행할 카드: 지금 대화에서 실행 전 카드가 있는 가장 최근 답의 카드. 순서가 없으면 그 답의 마지막 카드.
 * 되돌리기 어려운 카드·빈 칸이 남은 카드는 고르지 않고 이유를 돌려준다 (화면에서 눌러 실행한다)
 */
export function pickVoiceApprovalCard(entries: readonly AiChatEntry[], index: number | null): VoiceApprovalPick {
  const answer = [...entries].reverse().find((entry): entry is Extract<AiChatEntry, { role: 'assistant' }> => entry.role === 'assistant' && (entry.cards ?? []).some((item) => item.status === 'ready'));
  if (!answer?.cards) return { ok: false, reason: '실행할 카드가 없어요' };
  const ready = answer.cards.filter((item) => item.status === 'ready');
  const item = index === null ? ready.at(-1) : ready[index - 1];
  if (!item) return { ok: false, reason: `${index}번째 카드가 없어요 (실행 전 카드 ${ready.length}장)` };
  if (!isVoiceApprovable(item.card)) return { ok: false, reason: '이 카드는 말로 실행할 수 없어요. 화면에서 눌러 실행해 주세요' };
  const missing = missingOfCard(item.card);
  if (missing.length) return { ok: false, reason: `${missing.join(', ')}을(를) 채워야 실행할 수 있어요` };
  return { ok: true, entryId: answer.id, ...(answer.messageId ? { messageId: answer.messageId } : {}), item };
}

/** 말로 승인 기다리는 중의 상태. 마감이 지나면 들은 말과 상관없이 취소다 */
export interface VoiceApprovalPending {
  entryId: string;
  messageId?: number;
  item: AiChatCard;
  deadline: number;
}

export function resolveVoiceApproval(pending: VoiceApprovalPending, text: string, now: number): 'execute' | 'cancel' | 'expired' {
  return resolveConfirmation(pending.deadline, text, now);
}

/** 두 번 확인(말로 승인·화면 조작 켜기)을 기다리는 중에 들은 말. 마감이 지나면 들은 말과 상관없이 취소다 */
export function resolveConfirmation(deadline: number, text: string, now: number): 'execute' | 'cancel' | 'expired' {
  if (now > deadline) return 'expired';
  return confirmationOf(text) === 'yes' ? 'execute' : 'cancel';
}
