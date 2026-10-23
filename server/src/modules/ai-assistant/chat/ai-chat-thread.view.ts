// 저장한 대화(이슈 #399)의 제목·응답 모양·카드 상태. DB 없이 시험한다
import {
  AI_AGENT_NOTE_MAX_CHARS,
  AI_AGENT_NOTES_MAX,
  AI_CHAT_TITLE_MAX,
  AI_REASONING_LEVELS,
  type AiActionCard,
  type AiActionCardExecuteResult,
  type AiAssistantReplyView,
  type AiAssistantSource,
  type AiAssistantTurn,
  type AiChatMessageView,
  type AiChatSavedCard,
  type AiChatThreadSummaryView,
  type AiChatTraceStep,
  type AiReasoningLevel,
  type AiWebSource,
} from '@fantasteel/shared';
import { savedTraceArguments } from '../tools/trace-arguments';

/** ai_chat_message.role (CHECK ai_chat_message_role_check). 공통 코드가 아니다 */
export const AI_CHAT_ROLE = { USER: 'USER', ASSISTANT: 'ASSISTANT' } as const;

/** 질문을 저장할 때 함께 남기는 옵션. 사진은 수만 남긴다 */
export interface AiChatQuestionInput {
  question: string;
  reasoning?: AiReasoningLevel;
  webSearch?: boolean;
  browser?: boolean;
  imageCount?: number;
  /** 입력칸 @로 붙인 Drive 파일 이름 (이슈 #398). 파일 글은 저장하지 않고 이름만 남긴다 */
  driveFiles?: string[];
  /** 답하는 중에 덧붙인 말 (이슈 #430). 질문 줄의 meta에 남긴다 */
  notes?: string[];
}

interface ThreadRow {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: number;
  seq: number;
  role: string;
  content: string;
  sources: unknown;
  webSources: unknown;
  actionCards: unknown;
  meta: unknown;
  createdAt: Date;
}

/** 첫 질문 앞 AI_CHAT_TITLE_MAX자. 줄바꿈·연속 공백은 공백 하나로, 넘치면 … (글자 단위라 이모지를 반으로 자르지 않는다) */
export function chatThreadTitle(question: string): string {
  const chars = Array.from(question.replace(/\s+/g, ' ').trim());
  return chars.length > AI_CHAT_TITLE_MAX ? `${chars.slice(0, AI_CHAT_TITLE_MAX).join('')}…` : chars.join('');
}

export const toChatThreadSummary = (row: ThreadRow): AiChatThreadSummaryView => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * 지난 대화로 모델에 보내는 줄 (오래된 것부터). @로 붙인 Drive 파일은 글을 다시 넣지 않고 이름만 한 줄 덧붙인다 (이슈 #398):
 * 이어 묻는 질문이 "그 파일"을 알아듣게 하되, 파일 글(감싼 외부 글)을 차례마다 다시 싣지 않는다. 다시 보려면 Drive 도구로 읽는다
 */
export const chatHistoryTurns = (rows: readonly (Pick<MessageRow, 'role' | 'content'> & { meta?: unknown })[]): AiAssistantTurn[] =>
  rows.map((row) => {
    if (row.role === AI_CHAT_ROLE.ASSISTANT) return { role: 'assistant', content: row.content };
    const meta = objectOf(row.meta);
    const files = stringListOf(meta.driveFiles);
    const notes = stringListOf(meta.notes);
    return {
      role: 'user',
      content: [row.content, files.length ? `(이 질문에 붙인 Drive 파일: ${files.join(', ')})` : null, notes.length ? `(답하는 중에 덧붙인 말: ${notes.join(' / ')})` : null].filter(Boolean).join('\n'),
    };
  });

/** meta의 글 목록 (Drive 파일 이름·덧붙인 말) */
function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
}

export function questionMeta(input: AiChatQuestionInput): Record<string, string | number | boolean | string[]> | null {
  const meta = {
    ...(input.driveFiles?.length ? { driveFiles: input.driveFiles.slice(0, 3).map((name) => name.slice(0, 200)) } : {}),
    ...(input.notes?.length ? { notes: input.notes.slice(0, AI_AGENT_NOTES_MAX).map((note) => note.slice(0, AI_AGENT_NOTE_MAX_CHARS)) } : {}),
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    ...(input.webSearch ? { webSearch: true } : {}),
    ...(input.browser ? { browser: true } : {}),
    ...(input.imageCount ? { imageCount: input.imageCount } : {}),
  };
  return Object.keys(meta).length ? meta : null;
}

/** 저장하는 도구 동작 기록의 상한 (이슈 #433). 동작이 많은 브라우저 답도 한 줄이 수십 KB를 넘지 않게 */
export const TRACE_STEPS_MAX = 60;
const TRACE_ARGUMENTS_MAX = 200;
const TRACE_TEXT_MAX = 200;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 도구가 실패했을 때 결과의 {"오류":"…"} 속 이유. 실패가 아니면 null */
function failureReason(resultPreview: string): string | null {
  const found = /^\{"오류":"((?:[^"\\]|\\.)*)/.exec(resultPreview);
  if (!found) return null;
  try {
    return String(JSON.parse(`"${found[1]}"`));
  } catch {
    return found[1];
  }
}

/** 답을 만들며 부른 도구를 저장할 만큼만 줄인다. 결과 글(페이지 글·조회 데이터)은 빼고 조회 대상·본 주소·실패 이유만 남긴다 */
export function traceStepsOf(toolCalls: AiAssistantReplyView['toolCalls']): AiChatTraceStep[] {
  return toolCalls.slice(0, TRACE_STEPS_MAX).map((call) => {
    const error = failureReason(call.resultPreview);
    return {
      name: call.name,
      arguments: savedTraceArguments(call.arguments, TRACE_ARGUMENTS_MAX),
      durationMs: call.durationMs,
      ...(call.label ? { label: clip(call.label, TRACE_TEXT_MAX) } : {}),
      ...(call.url ? { url: clip(call.url, TRACE_TEXT_MAX) } : {}),
      ...(error ? { error: clip(error, TRACE_TEXT_MAX) } : {}),
    };
  });
}

/**
 * 답의 meta: 질문에 보낸 생각 정도 안내(화면의 '생각 정도를 바꾸지 못했어요'), 생각 글, 도구 동작 기록 (이슈 #433).
 * 다시 연 대화에서도 '생각 과정 보기'가 나오게 한다. 이 중 하나도 없으면 null
 */
export function answerMeta(reasoning: AiReasoningLevel | undefined, reply: Pick<AiAssistantReplyView, 'reasoningApplied' | 'thinking' | 'toolCalls'>): Record<string, unknown> | null {
  const trace = traceStepsOf(reply.toolCalls);
  const meta = {
    ...(reasoning ? { reasoning, reasoningApplied: reply.reasoningApplied } : {}),
    ...(reply.thinking ? { thinking: reply.thinking } : {}),
    ...(trace.length ? { trace } : {}),
  };
  return Object.keys(meta).length ? meta : null;
}

export const readyCards = (cards: readonly AiActionCard[]): AiChatSavedCard[] => cards.map((card) => ({ card, status: 'ready' }));

/** 카드 하나를 실행됨으로 바꾼 목록. 그 카드가 없거나 이미 실행됐으면 null (고치지 않는다) */
export function cardsWithDone(cards: unknown, key: string, registered: AiActionCardExecuteResult['registered']): AiChatSavedCard[] | null {
  const list = savedCardsOf(cards);
  const index = list.findIndex((item) => item.card.key === key);
  if (index < 0 || list[index].status === 'done') return null;
  return list.map((item, i) => (i === index ? { ...item, status: 'done', result: registered } : item));
}

export function toChatMessageView(row: MessageRow): AiChatMessageView {
  const meta = objectOf(row.meta);
  const reasoning = reasoningOf(meta.reasoning);
  if (row.role === AI_CHAT_ROLE.USER) {
    return {
      id: row.id,
      seq: row.seq,
      role: 'user',
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      ...(reasoning ? { reasoning } : {}),
      ...(meta.webSearch === true ? { webSearch: true } : {}),
      ...(meta.browser === true ? { browser: true } : {}),
      ...(typeof meta.imageCount === 'number' && meta.imageCount > 0 ? { imageCount: meta.imageCount } : {}),
      ...(stringListOf(meta.driveFiles).length ? { driveFiles: stringListOf(meta.driveFiles) } : {}),
      ...(stringListOf(meta.notes).length ? { notes: stringListOf(meta.notes) } : {}),
    };
  }
  const webSources = Array.isArray(row.webSources) ? (row.webSources as AiWebSource[]) : null;
  const trace = savedTraceOf(meta.trace);
  return {
    id: row.id,
    seq: row.seq,
    role: 'assistant',
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    sources: Array.isArray(row.sources) ? (row.sources as AiAssistantSource[]) : [],
    ...(webSources ? { webSources } : {}),
    actionCards: savedCardsOf(row.actionCards),
    ...(reasoning ? { reasoning, reasoningApplied: meta.reasoningApplied === true } : {}),
    ...(typeof meta.thinking === 'string' && meta.thinking ? { thinking: meta.thinking } : {}),
    ...(trace.length ? { trace } : {}),
  };
}

// 이 서버가 저장한 JSON이라 모양을 믿되, 비었거나 배열이 아니면 빈 것으로 본다
function savedCardsOf(value: unknown): AiChatSavedCard[] {
  return Array.isArray(value) ? (value as AiChatSavedCard[]) : [];
}

// 이 서버가 저장한 JSON이라 모양을 믿되, 깨진 줄은 건너뛴다
function savedTraceOf(value: unknown): AiChatTraceStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AiChatTraceStep[] => {
    const step = objectOf(item);
    if (typeof step.name !== 'string' || typeof step.arguments !== 'string' || typeof step.durationMs !== 'number') return [];
    return [
      {
        name: step.name,
        arguments: step.arguments,
        durationMs: step.durationMs,
        ...(typeof step.label === 'string' ? { label: step.label } : {}),
        ...(typeof step.url === 'string' ? { url: step.url } : {}),
        ...(typeof step.error === 'string' ? { error: step.error } : {}),
      },
    ];
  });
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function reasoningOf(value: unknown): AiReasoningLevel | undefined {
  return AI_REASONING_LEVELS.find((level) => level === value);
}
