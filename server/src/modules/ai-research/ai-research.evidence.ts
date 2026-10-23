import { cutText, wrapUntrusted } from '../ai-assistant/web/web-text';
import { isErpSource, isInternalSource, isKnowledgeSource, type StepNote, type StoredSource, type StoredState } from './ai-research.rules';

/**
 * 근거 조립 (이슈 #384). 출처 하나하나가 아니라 "단계 기록"(검색어 → 그 결과, 읽은 출처 → 본문)을 근거로 넘긴다:
 * 점검·보고서·차트는 모든 단계 기록을 글자 예산 안에서 똑같이 나누고, 다음 행동은 출처 목록 전체 + 최근 단계 기록을 넣는다.
 * 웹에서 온 글은 단계마다 <untrusted_web_content>로 감싼다.
 */

/** 단계 기록 하나의 상한 (점검·보고서) */
export const NOTE_MAX = 12_000;
/** 다음 행동에 보이는 단계 기록 하나의 상한 */
export const TURN_NOTE_MAX = 6_000;
/** 똑같이 나눈 몫이 이보다 작으면 최근 기록부터 이 몫으로 넣을 수 있는 만큼만 넣는다 */
export const NOTE_MIN = 400;
/** 다음 행동의 출처 목록에서 한 줄의 요약 길이 */
export const CATALOG_SNIPPET_MAX = 160;
const TRUNCATED = '\n(근거가 길어 여기까지만 보여요)';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'web';
  }
};
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 단계 기록. 저장된 기록이 없으면(이슈 #384 전에 만든 조사) 출처로 만든다: 읽은 출처마다 읽기 기록, 나머지 요약은 검색 기록 하나 */
export function notesFor(state: Pick<StoredState, 'notes'>, sources: readonly StoredSource[]): StepNote[] {
  if (state.notes?.length) return state.notes;
  const notes: StepNote[] = [];
  // ERP 조회·사내 지식 출처는 단계 기록이 아니라 따로 넣는다 (erpEvidence·knowledgeEvidence)
  const web = sources.filter((s) => !isInternalSource(s));
  const unread = web.filter((s) => s.readText === undefined);
  if (unread.length) notes.push({ step: 0, kind: 'search', query: '(앞서 모은 검색 결과)', engine: null, error: null, results: unread.map((s) => ({ sourceId: s.id, title: s.title, url: s.url, snippet: s.snippet })) });
  for (const s of web) if (s.readText !== undefined) notes.push({ step: 0, kind: 'read', sourceId: s.id, error: null });
  return notes;
}

/** 단계 기록 → 글 (감싸기 전). 검색어와 그 결과를 한 덩어리로 둔다 */
export function renderNote(note: StepNote, sources: readonly StoredSource[]): string {
  const stepLabel = note.step > 0 ? `${note.step}단계` : '이전';
  if (note.kind === 'search') {
    const head = `### ${stepLabel} · 검색 "${note.query}"${note.engine ? ` (${note.engine})` : ''}`;
    if (note.error) return `${head}\n검색 실패: ${note.error}`;
    if (!note.results.length) return `${head}\n결과 없음`;
    const lines = note.results.map((r) => `- ${r.sourceId === null ? '[번호 없음: 출처가 꽉 차 인용할 수 없어요]' : `[${r.sourceId}]`} ${oneLine(r.title)} — ${r.url}\n  ${oneLine(r.snippet)}`);
    return `${head}\n${lines.join('\n')}\n(검색 요약일 뿐이에요. 자세한 내용은 그 출처를 읽어야 알 수 있어요)`;
  }
  const source = sources.find((s) => s.id === note.sourceId);
  const head = `### ${stepLabel} · 읽기 [${note.sourceId}] ${oneLine(source?.title ?? '')}\n주소: ${source?.url ?? '(모름)'}`;
  if (note.error || source?.readError) return `${head}\n읽지 못함: ${note.error ?? source?.readError}`;
  return `${head}\n본문:\n${source?.readText ?? source?.snippet ?? ''}`;
}

/** ERP 조회 출처 하나 → 글 (감싸기 전). 우리 회사 자료임을 밝혀 웹 자료와 섞이지 않게 한다 */
export function renderErp(source: StoredSource): string {
  const args = oneLine(source.erp?.arguments ?? '');
  return `### 우리 회사 ERP [${source.id}] ${source.title}\n조회 조건: ${args || '없음'}\n(우리 회사 ERP에서 조회한 결과예요. 웹 자료가 아니에요)\n${source.readText ?? ''}`;
}

/** 감싼 길이가 max 안이 되도록 글을 줄여 감싼다. 줄일 수 없으면(max가 너무 작으면) null */
export function wrapWithin(label: string, text: string, max: number): string | null {
  const overhead = wrapUntrusted(label, '').length;
  if (max - overhead < 50) return null;
  let body = text.length > max - overhead ? `${text.slice(0, max - overhead - TRUNCATED.length)}${TRUNCATED}` : text;
  let wrapped = wrapUntrusted(label, body);
  // 태그 막기(&lt;)로 늘어난 만큼 더 줄인다
  for (let i = 0; wrapped.length > max && i < 5; i += 1) {
    body = `${body.slice(0, Math.max(0, body.length - (wrapped.length - max) - TRUNCATED.length - 8))}${TRUNCATED}`;
    wrapped = wrapUntrusted(label, body);
  }
  return wrapped.length <= max ? wrapped : null;
}

const noteLabel = (note: StepNote, index: number): string => `research:step-${note.step > 0 ? note.step : `prior-${index + 1}`}`;

/**
 * 점검·보고서·차트의 근거: 모든 단계 기록을 room 안에서 똑같이 나눈다(하나 NOTE_MAX까지).
 * 몫이 NOTE_MIN보다 작으면 최근 기록부터 NOTE_MIN씩 넣을 수 있는 만큼만. 순서는 단계 순서 그대로.
 */
export function evenEvidence(notes: readonly StepNote[], sources: readonly StoredSource[], room: number): string[] {
  if (!notes.length || room <= 0) return [];
  const separators = notes.length;
  let chosen = notes.map((note, i) => ({ note, i }));
  let share = Math.floor((room - separators) / chosen.length);
  if (share < NOTE_MIN) {
    const fit = Math.max(1, Math.floor(room / (NOTE_MIN + 1)));
    chosen = chosen.slice(-fit);
    share = Math.floor((room - chosen.length) / chosen.length);
  }
  const each = Math.min(share, NOTE_MAX);
  return chosen.map(({ note, i }) => wrapWithin(noteLabel(note, i), renderNote(note, sources), each)).filter((b): b is string => b !== null);
}

/** 사내 지식 출처 하나 → 글 (감싸기 전). 회사가 정한 기준이라 웹 자료보다 먼저 쓰라고 밝힌다 (이슈 #484) */
export function renderKnowledge(source: StoredSource): string {
  return `### 사내 지식 [${source.id}] ${source.title}\n(우리 회사가 정한 기준 문서예요. 웹 자료보다 먼저 쓰고, 웹 자료의 숫자가 이와 다르면 이 값을 따르되 다르다고 밝혀요)\n${source.readText ?? ''}`;
}

/** room 안에서 똑같이 나눈다(하나 NOTE_MAX까지). 몫이 NOTE_MIN보다 작으면 앞의 것부터 NOTE_MIN씩 넣을 수 있는 만큼만 */
function evenBlocks(picked: readonly StoredSource[], room: number, label: string, render: (s: StoredSource) => string): string[] {
  let list = [...picked];
  if (!list.length || room <= 0) return [];
  let share = Math.floor((room - list.length) / list.length);
  if (share < NOTE_MIN) {
    list = list.slice(0, Math.max(1, Math.floor(room / (NOTE_MIN + 1))));
    share = Math.floor((room - list.length) / list.length);
  }
  const each = Math.min(share, NOTE_MAX);
  return list.map((s) => wrapWithin(`research:${label}-${s.id}`, render(s), each)).filter((b): b is string => b !== null);
}

/**
 * ERP 조회 출처의 근거 (이슈 #435): room 안에서 똑같이 나눈다(하나 NOTE_MAX까지). 웹 단계 기록과 따로 두어, 단계가 많아도 우리 회사 자료가 밀려나지 않는다.
 * 몫이 NOTE_MIN보다 작으면 앞의 것부터 NOTE_MIN씩 넣을 수 있는 만큼만.
 */
export function erpEvidence(sources: readonly StoredSource[], room: number): string[] {
  return evenBlocks(sources.filter(isErpSource), room, 'erp', renderErp);
}

/** 사내 지식 출처의 근거 (이슈 #484). ERP와 같은 방식으로 나눈다 */
export function knowledgeEvidence(sources: readonly StoredSource[], room: number): string[] {
  return evenBlocks(sources.filter(isKnowledgeSource), room, 'knowledge', renderKnowledge);
}

/** 🟡 사내 지식·ERP 근거가 room의 이만큼까지 쓰고, 남은 글자는 웹 단계 기록이 쓴다 (사내 지식이 맨 앞) */
const KNOWLEDGE_ROOM_SHARE = 0.3;
const ERP_ROOM_SHARE = 0.4;

/** 사내 지식 → ERP 근거를 앞에 두고 나머지 글자를 웹 단계 기록(rest)에 준다 */
export function withInternalEvidence(sources: readonly StoredSource[], room: number, rest: (room: number) => string[]): string[] {
  const knowledge = knowledgeEvidence(sources, Math.floor(room * KNOWLEDGE_ROOM_SHARE));
  const afterKnowledge = room - knowledge.reduce((sum, block) => sum + block.length + 1, 0);
  const erp = erpEvidence(sources, Math.floor(afterKnowledge * ERP_ROOM_SHARE));
  const used = erp.reduce((sum, block) => sum + block.length + 1, 0);
  return [...knowledge, ...erp, ...rest(afterKnowledge - used)];
}

/** 다음 행동의 근거: 최근 단계 기록부터 room이 찰 때까지(하나 TURN_NOTE_MAX까지, 남은 몫이 NOTE_MIN보다 작으면 멈춤). 순서는 단계 순서 그대로 */
export function recentEvidence(notes: readonly StepNote[], sources: readonly StoredSource[], room: number): string[] {
  const out: string[] = [];
  let left = room;
  for (let i = notes.length - 1; i >= 0 && left >= NOTE_MIN; i -= 1) {
    const block = wrapWithin(noteLabel(notes[i], i), renderNote(notes[i], sources), Math.min(TURN_NOTE_MAX, left - 1));
    if (!block) break;
    out.unshift(block);
    left -= block.length + 1;
  }
  return out;
}

/**
 * 모은 출처 목록. 다음 행동용은 번호·제목·호스트·읽음 여부·짧은 요약, 점검·보고서용은 번호·제목·주소·읽음 여부(요약은 단계 기록에 있다).
 * 한 줄씩 통째로 넣고(주소가 잘리지 않게), 넘치면 요약을 빼고, 그래도 넘치면 뒤쪽 줄을 뺀다(몇 개 뺐는지 알린다).
 */
export function sourceCatalog(sources: readonly StoredSource[], room: number, mode: 'turn' | 'final'): string {
  if (!sources.length) return '[모은 출처] 아직 없음';
  const status = (s: StoredSource) => (s.readText !== undefined ? ' (읽음)' : s.readError !== undefined ? ' (읽기 실패)' : '');
  const where = (s: StoredSource) => (isKnowledgeSource(s) ? '사내 지식' : isErpSource(s) ? '우리 회사 ERP' : mode === 'turn' ? hostOf(s.url) : s.url);
  const line = (s: StoredSource, snippet: boolean) =>
    mode === 'turn'
      ? `[${s.id}] ${cutText(oneLine(s.title), 80)} — ${where(s)}${status(s)}${snippet && s.snippet ? ` · ${cutText(oneLine(s.snippet), CATALOG_SNIPPET_MAX)}` : ''}`
      : `[${s.id}] ${cutText(oneLine(s.title), 100)} — ${where(s)}${status(s)}`;
  const build = (snippet: boolean, count: number) => {
    const lines = sources.slice(0, count).map((s) => line(s, snippet));
    const dropped = sources.length - count;
    const body = `${lines.join('\n')}${dropped > 0 ? `\n(글자 수가 모자라 출처 ${dropped}개는 목록에서 뺐어요)` : ''}`;
    return `[모은 출처] ${sources.length}개\n${wrapUntrusted('research:sources', body)}`;
  };
  for (const snippet of mode === 'turn' ? [true, false] : [false]) {
    const all = build(snippet, sources.length);
    if (all.length <= room) return all;
  }
  let count = sources.length;
  while (count > 1 && build(false, count).length > room) count -= 1;
  return build(false, count);
}
