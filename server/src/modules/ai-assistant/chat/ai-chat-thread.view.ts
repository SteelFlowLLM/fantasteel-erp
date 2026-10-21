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
  type AiReasoningLevel,
  type AiWebSource,
} from '@fantasteel/shared';

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

/** 답의 생각 정도 안내: 질문에 생각 정도를 보냈을 때만 남긴다 (화면의 '생각 정도를 바꾸지 못했어요' 안내용) */
export function answerMeta(reasoning: AiReasoningLevel | undefined, reply: Pick<AiAssistantReplyView, 'reasoningApplied'>): Record<string, string | boolean> | null {
  return reasoning ? { reasoning, reasoningApplied: reply.reasoningApplied } : null;
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
  };
}

// 이 서버가 저장한 JSON이라 모양을 믿되, 비었거나 배열이 아니면 빈 것으로 본다
function savedCardsOf(value: unknown): AiChatSavedCard[] {
  return Array.isArray(value) ? (value as AiChatSavedCard[]) : [];
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function reasoningOf(value: unknown): AiReasoningLevel | undefined {
  return AI_REASONING_LEVELS.find((level) => level === value);
}
