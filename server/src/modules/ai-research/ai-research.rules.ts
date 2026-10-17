import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS, type AiResearchAudit, type AiResearchBudget, type AiResearchPlan, type AiResearchState, type AiResearchStatus } from '@fantasteel/shared';
import { parseJsonContent } from '../llm/llm.client';
import { cutText, internalReferenceIn, redactQuery, stripInvisible } from '../ai-assistant/web/web-text';

/** DB의 sources jsonb 한 줄. readText는 읽은 페이지 본문 (6,000자까지) */
export interface StoredSource {
  id: number;
  title: string;
  url: string;
  snippet: string;
  readText?: string;
  /** 읽기에 실패한 이유. 있으면 다시 읽지 않는다 */
  readError?: string;
}

/** DB의 research_state jsonb. searchedQueries는 이어서 할 때 같은 검색을 되풀이하지 않으려고 둔다 */
export interface StoredState extends AiResearchState {
  searchedQueries: string[];
  /** 저장했지만 결과를 아직 저장하지 못한 행동. 서버가 멈췄다 이어서 하면 모델에 다시 묻지 않고 이것부터 한다 (단계를 잃거나 같은 검색을 되풀이하지 않게) */
  pending?: PendingAction;
  /** budget.exhausted를 남긴 때의 maxSteps (이어서 할 때 같은 알림을 두 번 남기지 않게) */
  exhaustedAt?: number;
  /** 점검을 저장한 때의 stepsUsed. 같으면 이어서 할 때 점검을 다시 하지 않는다 */
  auditedAt?: number;
}

export type PendingAction = { kind: 'search'; query: string; step: number } | { kind: 'read'; sourceId: number; step: number };

/** DB의 audit jsonb */
export interface StoredAudit extends AiResearchAudit {
  /** 점검 LLM 답을 읽었는지. false면 조사 메모로 만든 대신값 */
  ok: boolean;
  reportTruncated: boolean;
  /** 조사를 다 마치지 못하고 모은 것으로 보고서를 쓴 이유 (시간 상한·LLM 실패). 다 마쳤으면 null */
  incompleteReason?: string | null;
}

const SUMMARY_MAX = 1500;
const LIST_ITEM_MAX = 200;
const LIST_MAX = 8;
export const SNIPPET_MAX = 300;
export const SOURCE_TITLE_MAX = 200;

export const EMPTY_STATE: StoredState = { summary: '', gaps: [], unsupportedClaims: [], searchedQueries: [] };

// ───────────────────────────── 예산 ─────────────────────────────

export function defaultBudget(): AiResearchBudget {
  return { maxSteps: AI_RESEARCH_LIMITS.defaultMaxSteps, maxSources: AI_RESEARCH_LIMITS.defaultMaxSources };
}

/** 단계를 다 써서 끝났고 모르는 것이 남았고 더 늘릴 수 있을 때만 */
export function canExtend(run: { status: AiResearchStatus; stepsUsed: number; budget: AiResearchBudget; state: AiResearchState | null }): boolean {
  return (
    run.status === AI_RESEARCH_STATUS.COMPLETED &&
    run.stepsUsed >= run.budget.maxSteps &&
    (run.state?.gaps.length ?? 0) > 0 &&
    run.budget.maxSteps < AI_RESEARCH_LIMITS.maxTotalSteps
  );
}

/** +4단계, 모두 20단계까지 */
export function extendedBudget(budget: AiResearchBudget): AiResearchBudget {
  return { ...budget, maxSteps: Math.min(budget.maxSteps + AI_RESEARCH_LIMITS.extendSteps, AI_RESEARCH_LIMITS.maxTotalSteps) };
}

export function readBudget(value: unknown): AiResearchBudget {
  const raw = isRecord(value) ? value : {};
  const int = (v: unknown, fallback: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : fallback);
  return {
    maxSteps: int(raw.maxSteps, AI_RESEARCH_LIMITS.defaultMaxSteps, AI_RESEARCH_LIMITS.maxTotalSteps),
    maxSources: int(raw.maxSources, AI_RESEARCH_LIMITS.defaultMaxSources, AI_RESEARCH_LIMITS.defaultMaxSources),
  };
}

// ───────────────────────────── 검색어 ─────────────────────────────

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

/**
 * 회사 밖으로 나가는 검색어 확인 (웹 검색과 같은 규칙): 공백 정리 → 80자로 자름 → 개인정보 빼기 → 업무·LOT 번호가 있으면 막음.
 * 계획의 검색어(모델·사용자)와 모델이 고른 검색어 모두 거친다.
 */
export function checkResearchQuery(raw: string): QueryCheck {
  const tidy = stripInvisible(raw).replace(/\s+/g, ' ').trim();
  if (!tidy) return { ok: false, reason: '검색어가 비었어요' };
  const cut = tidy.length > AI_RESEARCH_LIMITS.queryMax ? cutAtSpace(tidy, AI_RESEARCH_LIMITS.queryMax) : tidy;
  const { query } = redactQuery(cut);
  if (!query) return { ok: false, reason: '개인정보를 빼니 검색어가 비었어요' };
  const internal = internalReferenceIn(query, []);
  if (internal) return { ok: false, reason: `검색어에 회사 안 정보(${internal})가 있어요` };
  return { ok: true, query };
}

function cutAtSpace(text: string, max: number): string {
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return (space >= max / 2 ? head.slice(0, space) : head).trim();
}

export const queryKey = (query: string): string => query.trim().replace(/\s+/g, ' ').toLowerCase();

// ───────────────────────────── 계획 ─────────────────────────────

/** 모델·사용자가 낸 계획을 다듬는다: 검색어 확인을 통과한 단계만, 같은 검색어는 하나, 6단계까지. 단계가 없으면 null */
export function readPlan(value: unknown, question: string): { plan: AiResearchPlan; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.steps)) return null;
  const steps: AiResearchPlan['steps'] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const step of value.steps) {
    if (!isRecord(step) || typeof step.query !== 'string') {
      dropped += 1;
      continue;
    }
    const checked = checkResearchQuery(step.query);
    if (!checked.ok || seen.has(queryKey(checked.query)) || steps.length >= AI_RESEARCH_LIMITS.maxPlanSteps) {
      dropped += 1;
      continue;
    }
    seen.add(queryKey(checked.query));
    const title = typeof step.title === 'string' && step.title.trim() ? step.title : checked.query;
    steps.push({ title: cutText(oneLine(title), AI_RESEARCH_LIMITS.stepTitleMax), query: checked.query });
  }
  if (!steps.length) return null;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title : question;
  return { plan: { title: cutText(oneLine(title), AI_RESEARCH_LIMITS.planTitleMax), steps }, dropped };
}

/** 모델이 계획을 내지 못했을 때: 질문을 그대로 검색어로 (검색어 확인을 통과할 때만) */
export function fallbackPlan(question: string): AiResearchPlan | null {
  const checked = checkResearchQuery(question);
  if (!checked.ok) return null;
  return { title: cutText(oneLine(question), AI_RESEARCH_LIMITS.planTitleMax), steps: [{ title: '질문 그대로 찾아보기', query: checked.query }] };
}

/** DB의 plan jsonb (서버가 쓴 값이라 모양만 확인) */
export function storedPlan(value: unknown): AiResearchPlan | null {
  if (!isRecord(value) || typeof value.title !== 'string' || !Array.isArray(value.steps)) return null;
  const steps = value.steps.filter((s): s is { title: string; query: string } => isRecord(s) && typeof s.title === 'string' && typeof s.query === 'string');
  return { title: value.title, steps: steps.map((s) => ({ title: s.title, query: s.query })) };
}

// ───────────────────────────── 조사 메모·출처 ─────────────────────────────

export function readState(value: unknown, previous: StoredState): StoredState | null {
  if (!isRecord(value) || typeof value.summary !== 'string') return null;
  // 모델이 웹 내용을 보고 쓴 글이라 보이지 않는 글자를 지운다 (다음 프롬프트에 다시 들어간다)
  return {
    ...previous,
    summary: cutText(stripInvisible(value.summary).trim(), SUMMARY_MAX),
    gaps: stringList(value.gaps),
    unsupportedClaims: stringList(value.unsupportedClaims),
  };
}

export function storedState(value: unknown): StoredState {
  if (!isRecord(value)) return { ...EMPTY_STATE, searchedQueries: [] };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
  const pending = readPending(value.pending);
  const exhaustedAt = int(value.exhaustedAt);
  const auditedAt = int(value.auditedAt);
  return {
    summary: typeof value.summary === 'string' ? value.summary : '',
    gaps: strings(value.gaps),
    unsupportedClaims: strings(value.unsupportedClaims),
    searchedQueries: strings(value.searchedQueries),
    ...(pending ? { pending } : {}),
    ...(exhaustedAt !== undefined ? { exhaustedAt } : {}),
    ...(auditedAt !== undefined ? { auditedAt } : {}),
  };
}

function readPending(value: unknown): PendingAction | undefined {
  if (!isRecord(value) || typeof value.step !== 'number') return undefined;
  if (value.kind === 'search' && typeof value.query === 'string') return { kind: 'search', query: value.query, step: value.step };
  if (value.kind === 'read' && typeof value.sourceId === 'number') return { kind: 'read', sourceId: value.sourceId, step: value.step };
  return undefined;
}

export function storedSources(value: unknown): StoredSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is StoredSource => isRecord(s) && typeof s.id === 'number' && typeof s.title === 'string' && typeof s.url === 'string' && typeof s.snippet === 'string')
    .map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      ...(typeof s.readText === 'string' ? { readText: s.readText } : {}),
      ...(typeof s.readError === 'string' ? { readError: s.readError } : {}),
    }));
}

export function storedAudit(value: unknown): StoredAudit | null {
  if (!isRecord(value) || typeof value.thesis !== 'string') return null;
  const audit = readAudit(value, new Set<number>());
  if (!audit) return null;
  // 저장된 값은 이미 거른 값이라 출처 번호를 다시 거르지 않는다
  const claims = Array.isArray(value.supportedClaims)
    ? value.supportedClaims.filter((c): c is { claim: string; sourceIds: number[] } => isRecord(c) && typeof c.claim === 'string' && Array.isArray(c.sourceIds)).map((c) => ({ claim: c.claim, sourceIds: c.sourceIds.filter((n) => typeof n === 'number') }))
    : [];
  return {
    ...audit,
    supportedClaims: claims,
    ok: value.ok !== false,
    reportTruncated: value.reportTruncated === true,
    incompleteReason: typeof value.incompleteReason === 'string' ? value.incompleteReason : null,
  };
}

/** 점검 답 다듬기: 모르는 출처 번호는 빼고, 번호가 하나도 남지 않은 주장은 버린다 */
export function readAudit(value: unknown, knownIds: ReadonlySet<number>): AiResearchAudit | null {
  if (!isRecord(value) || typeof value.thesis !== 'string') return null;
  const supportedClaims: AiResearchAudit['supportedClaims'] = [];
  if (Array.isArray(value.supportedClaims))
    for (const c of value.supportedClaims) {
      if (!isRecord(c) || typeof c.claim !== 'string' || !c.claim.trim() || !Array.isArray(c.sourceIds)) continue;
      const ids = [...new Set(c.sourceIds.map(toInt).filter((n): n is number => n !== null && knownIds.has(n)))];
      if (ids.length) supportedClaims.push({ claim: cutText(stripInvisible(c.claim).trim(), 400), sourceIds: ids });
      if (supportedClaims.length >= 20) break;
    }
  return {
    thesis: cutText(stripInvisible(value.thesis).trim(), 800),
    outline: stringList(value.outline, 12),
    supportedClaims,
    contradictions: stringList(value.contradictions),
    missingDimensions: stringList(value.missingDimensions),
  };
}

/** 점검 LLM이 실패했을 때 조사 메모로 만든 대신값 */
export function fallbackAudit(state: StoredState): StoredAudit {
  return { thesis: state.summary, outline: [], supportedClaims: [], contradictions: [], missingDimensions: state.gaps, ok: false, reportTruncated: false };
}

// ───────────────────────────── 다음 행동 ─────────────────────────────

export interface ResearchTurn {
  action: 'search' | 'read' | 'finish' | null;
  query: string;
  sourceId: number | null;
  state: unknown;
}

/** 모델의 한 차례 답 (모양이 틀려도 읽을 수 있는 만큼). 못 읽으면 action null → 계획의 다음 검색어로 */
export function readTurn(value: unknown): ResearchTurn {
  if (!isRecord(value)) return { action: null, query: '', sourceId: null, state: null };
  const action = typeof value.action === 'string' ? value.action.trim().toLowerCase() : '';
  return {
    action: action === 'search' || action === 'read' || action === 'finish' ? action : null,
    query: typeof value.query === 'string' ? value.query : '',
    sourceId: toInt(value.sourceId),
    state: value.researchState ?? null,
  };
}

export type ResearchDecision =
  | { kind: 'search'; query: string; fallback: boolean }
  | { kind: 'read'; sourceId: number; fallback: boolean }
  | { kind: 'finish'; fallback: boolean };

export interface DecisionContext {
  plan: AiResearchPlan;
  searchedQueries: readonly string[];
  sources: readonly StoredSource[];
  maxSources: number;
}

/**
 * 모델이 고른 행동을 확인한다. 쓸 수 없으면(모르는 행동·막힌 검색어·이미 한 검색·모르는 출처·이미 읽은 출처·출처 없이 끝내기·출처가 꽉 찼는데 검색)
 * 계획에서 아직 하지 않은 다음 검색어로 바꾼다. 그것도 없으면 끝낸다.
 */
export function decideAction(turn: ResearchTurn, ctx: DecisionContext): ResearchDecision {
  const searched = new Set(ctx.searchedQueries.map(queryKey));
  const full = ctx.sources.length >= ctx.maxSources;
  if (turn.action === 'search' && !full) {
    const checked = checkResearchQuery(turn.query);
    if (checked.ok && !searched.has(queryKey(checked.query))) return { kind: 'search', query: checked.query, fallback: false };
  }
  if (turn.action === 'read' && turn.sourceId !== null) {
    const source = ctx.sources.find((s) => s.id === turn.sourceId);
    if (source && source.readText === undefined && source.readError === undefined) return { kind: 'read', sourceId: source.id, fallback: false };
  }
  if (turn.action === 'finish' && ctx.sources.length > 0) return { kind: 'finish', fallback: false };
  return fallbackAction(ctx, searched, full);
}

function fallbackAction(ctx: DecisionContext, searched: ReadonlySet<string>, full: boolean): ResearchDecision {
  if (!full) {
    const next = ctx.plan.steps.find((s) => !searched.has(queryKey(s.query)) && checkResearchQuery(s.query).ok);
    if (next) return { kind: 'search', query: next.query, fallback: true };
  }
  return { kind: 'finish', fallback: true };
}

// ───────────────────────────── 너그러운 JSON 읽기 ─────────────────────────────

const LENIENT_TEXT_MAX = 60_000;
const LENIENT_TRIES_MAX = 300;

/**
 * 모델 답에서 JSON 객체를 찾는다. 먼저 통째로(<think>·```json 울타리 벗김) 읽고, 안 되면 `{`가 나오는 곳마다 짝이 맞는 객체를 읽어 본다.
 * 조건(accept)에 맞는 것 중 마지막 객체를 쓴다(모델이 고쳐 쓴 답이 뒤에 온다). 답 글에 없으면 생각 글에서도 찾는다.
 */
export function parseLenientJson(texts: readonly (string | null | undefined)[], accept: (value: Record<string, unknown>) => boolean = () => true): Record<string, unknown> | null {
  for (const text of texts) {
    if (!text) continue;
    try {
      const whole = parseJsonContent(text);
      if (isRecord(whole) && accept(whole)) return whole;
    } catch {
      // 통째로 읽히지 않으면 아래에서 조각을 찾는다
    }
    const found = objectCandidates(text.slice(0, LENIENT_TEXT_MAX)).filter(accept);
    if (found.length) return found[found.length - 1];
  }
  return null;
}

/** 겹치지 않는 가장 바깥 객체들 (앞에서부터). 따옴표 안의 중괄호는 세지 않는다 */
function objectCandidates(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  let tries = 0;
  while (from < text.length && tries < LENIENT_TRIES_MAX) {
    const start = text.indexOf('{', from);
    if (start < 0) break;
    tries += 1;
    const end = matchingBrace(text, start);
    if (end > start) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1));
        if (isRecord(value)) {
          out.push(value);
          from = end + 1;
          continue;
        }
      } catch {
        // 이 `{`는 객체 시작이 아니다
      }
    }
    from = start + 1;
  }
  return out;
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ───────────────────────────── 작은 도구 ─────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\s*\[?\s*\d{1,4}\s*\]?\s*$/.test(value)) return Number(value.replace(/[^\d]/g, ''));
  return null;
}

function stringList(value: unknown, max = LIST_MAX): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(0, max)
    .map((v) => cutText(stripInvisible(v).trim(), LIST_ITEM_MAX))
    .filter((v) => v !== '');
}

const oneLine = (text: string): string => stripInvisible(text).replace(/\s+/g, ' ').trim();
