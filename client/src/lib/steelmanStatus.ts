// 철강맨AI 패널의 상황별 철강맨 모션 (이슈 #414). 그림은 노션 디자인 페이지의 "AI 어시스턴트 상황별 시안"
// (docs/character/steelman-pixel/assistant/gif_transparent → public/steelman-ai)이고, 상황마다 시안 A/B/C 중 하나를 고른다.
// 같은 답·같은 단계에서는 같은 시안이 나오게 열쇠(seed)로 고른다 (다시 그려질 때마다 바뀌면 깜빡거린다).
import type { AiChatEntry, AiChatLive, AiTimelineStep } from '@/stores/useAiChatStore';

export type SteelmanStatus =
  | 'thinking'
  | 'searching'
  | 'reading'
  | 'listening'
  | 'found'
  | 'no_result'
  | 'writing'
  | 'done'
  | 'draft_review'
  | 'slow'
  | 'unknown'
  | 'no_permission'
  | 'error'
  | 'greet';

/** 상황마다 쓸 수 있는 시안. 어색한 시안은 여기서 빼면 그 상황에서 나오지 않는다 */
const VARIANTS: Record<SteelmanStatus, { file: string; variants: readonly string[] }> = {
  thinking: { file: '01_thinking', variants: ['A', 'B', 'C'] },
  searching: { file: '02_searching', variants: ['A', 'B', 'C'] },
  reading: { file: '03_reading', variants: ['A', 'B', 'C'] },
  listening: { file: '04_listening', variants: ['A', 'B', 'C'] },
  found: { file: '05_found', variants: ['A', 'B', 'C'] },
  no_result: { file: '06_no_result', variants: ['A', 'B', 'C'] },
  writing: { file: '07_writing', variants: ['A', 'B'] },
  done: { file: '08_done', variants: ['A', 'B', 'C'] },
  draft_review: { file: '09_draft_review', variants: ['A', 'B', 'C'] },
  slow: { file: '10_slow', variants: ['A', 'B', 'C'] },
  unknown: { file: '11_unknown', variants: ['A', 'B', 'C'] },
  no_permission: { file: '12_no_permission', variants: ['A', 'B', 'C'] },
  error: { file: '13_error', variants: ['A', 'B', 'C'] },
  greet: { file: '15_greet', variants: ['A', 'B', 'C'] },
};

/** 글자 열쇠를 0 이상 정수로 (FNV-1a). 같은 열쇠면 늘 같은 값이다 */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 상황과 열쇠로 그림 주소. 열쇠가 같으면 같은 시안이다 */
export function steelmanSpriteSrc(status: SteelmanStatus, seedKey: string): string {
  const { file, variants } = VARIANTS[status];
  return `/steelman-ai/${file}_${variants[hashKey(`${status}:${seedKey}`) % variants.length]}.gif`;
}

/** 이만큼 오래 걸리는 도구는 '시간 초과' 모습으로 (가정값) */
export const SLOW_TOOL_MS = 10_000;
/** 도구가 끝난 뒤 '찾았다'·'결과 0건'을 이만큼 보인다 */
export const TOOL_RESULT_FLASH_MS = 1_500;
/** 답이 끝난 뒤 '답 완료'·'초안 확인 부탁'·'확인할 수 없음'·'오류'를 이만큼 보이고 가만히 있는 얼굴로 돌아간다 */
export const AFTER_ANSWER_MS = 4_000;

/** 용어 사전·매뉴얼·지난 대화·문서 본문을 읽는 도구는 '문서 찾는 중', 나머지(ERP 조회·웹 검색·브라우저 등)는 '조회 중' */
const READING_TOOLS: ReadonlySet<string> = new Set(['read_knowledge', 'search_chat_history', 'search_room_messages', 'read_web_page', 'notion_read_page', 'drive_read_file']);

/** 도구 결과 미리보기로 본 결과 종류. 권한 밖·0건은 서버가 돌려주는 문구로 알아본다 */
function toolOutcome(preview: string): 'denied' | 'empty' | 'ok' {
  if (/권한이 없|조회할 수 있는 역할|볼 수 없어요/.test(preview)) return 'denied';
  if (/"결과"\s*:\s*\[\s*\]|"rows"\s*:\s*\[\s*\]|없어요|찾지 못했|0건/.test(preview)) return 'empty';
  return 'ok';
}

/** 도구 한 번이 언제 시작했는지는 진행 이벤트에 없어서 화면이 받은 시각을 쓴다 */
export interface ToolTimes {
  startedAt?: number;
  endedAt?: number;
}

/**
 * 답을 기다리는 동안의 모습. 마지막 단계를 본다: 생각 중 → '생각 중', 도구가 도는 중 → '조회 중'·'문서 찾는 중'(10초 넘으면 '시간 초과'),
 * 도구가 막 끝났으면 '찾았다'·'결과 0건'·'권한 밖', 답 글이 나오는 중 → '답 쓰는 중'. 아무것도 안 왔으면 '생각 중'.
 */
export function liveSteelmanStatus(live: AiChatLive, now: number, times: (step: Extract<AiTimelineStep, { kind: 'tool' }>) => ToolTimes = () => ({})): SteelmanStatus {
  const last = live.steps.at(-1);
  if (live.answer.trim() && (!last || last.kind !== 'tool' || last.result !== null)) return 'writing';
  if (!last) return 'thinking';
  if (last.kind !== 'tool') return 'thinking';
  const { startedAt, endedAt } = times(last);
  if (last.result === null) {
    if (startedAt !== undefined && now - startedAt >= SLOW_TOOL_MS) return 'slow';
    return READING_TOOLS.has(last.name) ? 'reading' : 'searching';
  }
  const outcome = toolOutcome(last.result.resultPreview);
  if (outcome === 'denied') return 'no_permission';
  if (endedAt === undefined || now - endedAt < TOOL_RESULT_FLASH_MS) return outcome === 'empty' ? 'no_result' : 'found';
  return 'thinking';
}

/** 답이 끝난 직후의 모습: 실패 → '오류', 실행 카드가 있으면 '초안 확인 부탁', 근거가 없다고 답했으면 '확인할 수 없음', 아니면 '답 완료' */
export function finishedSteelmanStatus(entry: AiChatEntry): SteelmanStatus | null {
  if (entry.role === 'failure') return 'error';
  if (entry.role !== 'assistant') return null;
  if (entry.cards?.length) return 'draft_review';
  if (/확인할 수 없|찾지 못했|알 수 없어요/.test(entry.content)) return 'unknown';
  return 'done';
}
