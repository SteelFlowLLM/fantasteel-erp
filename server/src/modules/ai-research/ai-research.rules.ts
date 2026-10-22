import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS, type AiResearchAudit, type AiResearchBudget, type AiResearchPlan, type AiResearchSeed, type AiResearchState, type AiResearchStatus } from '@fantasteel/shared';
import { parseJsonContent } from '../llm/llm.client';
import { cutText, internalReferenceIn, partnerNamesIn, redactQuery, stripInvisible, urlKey } from '../ai-assistant/web/web-text';
import { RESEARCH_CAPS, researchLimits, type ResearchLimits } from './ai-research.config';

/** DB의 sources jsonb 한 줄. readText는 읽은 페이지 본문 (6,000자까지) */
export interface StoredSource {
  id: number;
  title: string;
  url: string;
  snippet: string;
  readText?: string;
  /** 읽기에 실패한 이유. 있으면 다시 읽지 않는다 */
  readError?: string;
  /** 웹이 아니라 우리 ERP 조회 도구(이슈 #435)에서 온 출처. url은 `erp:도구이름`이고 readText가 조회 결과다. 웹으로 읽거나 링크로 달지 않는다 */
  erp?: { tool: string; arguments: string };
  /** 웹이 아니라 사내 지식(KS 규격·용어 사전·업무 매뉴얼·업무 프로세스, 이슈 #484)에서 온 출처. url은 `knowledge:종류:id`이고 readText가 문서 본문이다 */
  knowledge?: { kind: 'ks' | 'glossary' | 'manual' | 'process'; id: string };
}

/** 웹이 아니라 ERP 조회에서 온 출처 */
export const isErpSource = (source: Pick<StoredSource, 'erp'>): boolean => source.erp !== undefined;

/** 웹이 아니라 사내 지식에서 온 출처 (이슈 #484) */
export const isKnowledgeSource = (source: Pick<StoredSource, 'knowledge'>): boolean => source.knowledge !== undefined;

/** 웹 출처가 아닌 것(ERP 조회·사내 지식): 읽거나 검색하지 않고, 링크로 달지 않고, 웹 출처 자리에 세지 않는다 */
export const isInternalSource = (source: Pick<StoredSource, 'erp' | 'knowledge'>): boolean => isErpSource(source) || isKnowledgeSource(source);

/** ERP 조회 결과에 나온 거래처 이름 (웹 검색어에 넣지 않는다) */
export function erpPartnerNames(sources: readonly StoredSource[]): string[] {
  return [...new Set(sources.flatMap((s) => (s.erp && s.readText ? partnerNamesIn(s.readText) : [])))];
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
  /** 단계마다의 기록 (검색어와 그 결과, 읽은 출처). 점검·보고서·다음 행동의 근거로 쓴다 (이슈 #384). 옛 조사에는 없다 */
  notes?: StepNote[];
  /** 검색이 연달아 비어 멈춘 때의 stepsUsed. 단계가 남았어도 더 조사하기를 허용한다 (이후 단계가 더해지면 저절로 낡는다) */
  searchDownAt?: number;
  /** 아직 판이 나오지 않은 보고서 고치기 (이슈 #418). 고친 보고서를 저장할 때 판을 남기고 지운다 */
  revision?: StoredRevision;
  /** 우리 ERP 자료가 필요한지 한 번 살펴봤다 (이슈 #435). 없으면 조사를 시작할 때 살펴본다(계획을 복사한 다시 조사) */
  erpChecked?: true;
  /** 질문에 맞는 사내 지식을 한 번 찾아봤다 (이슈 #484). 없으면 조사를 시작할 때 찾는다(계획을 복사한 다시 조사·이 기능 전 조사) */
  knowledgeChecked?: true;
}

/** 보고서 고치기 요청. search가 false면 검색·읽기 없이 모은 것으로 다시 쓴다 */
export interface StoredRevision {
  version: number;
  instruction: string;
  search: boolean;
  /** 요청했을 때의 stepsUsed. 더 검색하는 고치기는 여기서 한 단계도 하지 않고는 끝내지 않는다 */
  fromStep?: number;
  /** 부탁에 맞는 ERP 자료를 살펴봤다 (이슈 #435) */
  erpChecked?: true;
  /** 부탁으로 사내 지식을 찾아봤다 (이슈 #484) */
  knowledgeChecked?: true;
}

/** 검색 결과 한 줄. sourceId는 출처 번호(출처가 꽉 차 넣지 못했으면 null — 근거로 보이되 인용할 수 없다) */
export interface StepNoteResult {
  sourceId: number | null;
  title: string;
  url: string;
  snippet: string;
}

export type StepNote =
  | { step: number; kind: 'search'; query: string; engine: string | null; error: string | null; results: StepNoteResult[] }
  | { step: number; kind: 'read'; sourceId: number; error: string | null };

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

/** 새 조사의 예산: 환경 변수 기본값, 조사별 요청(budget)이 있으면 상한 안에서 그 값 */
export function defaultBudget(requested: Partial<AiResearchBudget> = {}, limits: ResearchLimits = researchLimits()): AiResearchBudget {
  const pick = (v: number | undefined, fallback: number, cap: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, cap) : fallback);
  return { maxSteps: pick(requested.maxSteps, limits.maxSteps, RESEARCH_CAPS.maxSteps), maxSources: pick(requested.maxSources, limits.maxSources, RESEARCH_CAPS.maxSources) };
}

/** 단계를 다 써서(또는 검색이 막혀 멈춰서) 끝났고 모르는 것이 남았고 더 늘릴 수 있을 때만. 검색이 막혀 멈춘 때는 모르는 것 목록이 비어도 된다 */
export function canExtend(
  run: { status: AiResearchStatus; stepsUsed: number; budget: AiResearchBudget; state: (AiResearchState & { searchDownAt?: number }) | null },
  limits: ResearchLimits = researchLimits(),
): boolean {
  if (run.status !== AI_RESEARCH_STATUS.COMPLETED || run.budget.maxSteps >= limits.maxTotalSteps) return false;
  if (run.state?.searchDownAt === run.stepsUsed) return true;
  return run.stepsUsed >= run.budget.maxSteps && (run.state?.gaps.length ?? 0) > 0;
}

/** +4단계, 모두 min(30, 기본 단계 × 2)까지 */
export function extendedBudget(budget: AiResearchBudget, limits: ResearchLimits = researchLimits()): AiResearchBudget {
  return { ...budget, maxSteps: Math.min(budget.maxSteps + AI_RESEARCH_LIMITS.extendSteps, limits.maxTotalSteps) };
}

/** DB의 budget jsonb. 상한(30단계·100개)만 다시 막는다 (만들 때 정한 값을 그대로 쓴다) */
export function readBudget(value: unknown, limits: ResearchLimits = researchLimits()): AiResearchBudget {
  const raw = isRecord(value) ? value : {};
  const int = (v: unknown, fallback: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : fallback);
  return {
    maxSteps: int(raw.maxSteps, limits.maxSteps, RESEARCH_CAPS.maxSteps),
    maxSources: int(raw.maxSources, limits.maxSources, RESEARCH_CAPS.maxSources),
  };
}

// ───────────────────────────── 검색어 ─────────────────────────────

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

/**
 * 회사 밖으로 나가는 검색어 확인 (웹 검색과 같은 규칙): 공백 정리 → 80자로 자름 → 개인정보 빼기 → 업무·LOT 번호가 있으면 막음.
 * 계획의 검색어(모델·사용자)와 모델이 고른 검색어 모두 거친다. partnerNames는 이 조사의 ERP 조회 결과에 나온 거래처 이름(이슈 #435).
 */
export function checkResearchQuery(raw: string, partnerNames: Iterable<string> = []): QueryCheck {
  const tidy = stripInvisible(raw).replace(/\s+/g, ' ').trim();
  if (!tidy) return { ok: false, reason: '검색어가 비었어요' };
  // 모델이 자리 표시('...')만 낸 경우: 글자·숫자가 하나도 없으면 검색어가 아니다
  if (!/[\p{L}\p{N}]/u.test(tidy)) return { ok: false, reason: '검색어에 글자가 없어요' };
  const cut = tidy.length > AI_RESEARCH_LIMITS.queryMax ? cutAtSpace(tidy, AI_RESEARCH_LIMITS.queryMax) : tidy;
  const { query } = redactQuery(cut);
  if (!query) return { ok: false, reason: '개인정보를 빼니 검색어가 비었어요' };
  const internal = internalReferenceIn(query, partnerNames);
  if (internal) return { ok: false, reason: `검색어에 회사 안 정보(${internal})가 있어요` };
  return { ok: true, query };
}

function cutAtSpace(text: string, max: number): string {
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return (space >= max / 2 ? head.slice(0, space) : head).trim();
}

/**
 * 같은 검색인지 보는 열쇠: 글자 모양(NFKC)·대소문자·문장부호·낱말 순서·같은 낱말 되풀이를 무시한다.
 * "고로 탄소 배출" · "탄소 배출, 고로" · "고로 탄소 배출 고로"는 같은 검색이다 (바꿔 말하기만 한 검색을 되풀이하지 않게, 이슈 #384)
 */
export const queryKey = (query: string): string =>
  [...new Set(query.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').trim().split(/\s+/).filter(Boolean))].sort().join(' ');

// ───────────────────────────── 계획 ─────────────────────────────

/** 모델·사용자가 낸 계획을 다듬는다: 검색어 확인을 통과한 단계만, 같은 검색어는 하나, 6단계까지. 단계가 없으면 null */
export function readPlan(value: unknown, question: string, partnerNames: readonly string[] = []): { plan: AiResearchPlan; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.steps)) return null;
  const steps: AiResearchPlan['steps'] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const step of value.steps) {
    if (!isRecord(step) || typeof step.query !== 'string') {
      dropped += 1;
      continue;
    }
    const checked = checkResearchQuery(step.query, partnerNames);
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

/**
 * 모델이 계획을 내지 못했을 때: 질문을 그대로 검색어로 (검색어 확인을 통과할 때만).
 * 조회한 ERP 자료의 거래처 이름 때문에만 막혔으면(질문에 이름을 직접 적은 경우) 이름을 뺀 일반 검색어로 대신한다. 사용자가 계획에서 고칠 수 있다 (이슈 #435)
 */
export function fallbackPlan(question: string, partnerNames: readonly string[] = []): AiResearchPlan | null {
  const exact = checkResearchQuery(question, partnerNames);
  if (exact.ok) return { title: cutText(oneLine(question), AI_RESEARCH_LIMITS.planTitleMax), steps: [{ title: '질문 그대로 찾아보기', query: exact.query }] };
  if (!checkResearchQuery(question).ok) return null;
  const general = withoutPartnerNames(question, partnerNames);
  const checked = general ? checkResearchQuery(general, partnerNames) : null;
  if (!checked?.ok) return null;
  return { title: cutText(oneLine(question), AI_RESEARCH_LIMITS.planTitleMax), steps: [{ title: '거래처 이름을 뺀 일반 검색', query: checked.query }] };
}

/** 글에서 거래처 이름을 뺀다 (이름 안의 공백·대소문자는 무시, 검색어 확인과 같은 기준) */
function withoutPartnerNames(text: string, partnerNames: readonly string[]): string {
  let result = text;
  for (const name of partnerNames) {
    const letters = [...name.replace(/\s+/g, '')];
    if (letters.length < 2) continue;
    const pattern = letters.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    result = result.replace(new RegExp(pattern, 'gi'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
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
  const searchDownAt = int(value.searchDownAt);
  const notes = readNotes(value.notes);
  const revision = readRevision(value.revision);
  return {
    summary: typeof value.summary === 'string' ? value.summary : '',
    gaps: strings(value.gaps),
    unsupportedClaims: strings(value.unsupportedClaims),
    searchedQueries: strings(value.searchedQueries),
    ...(pending ? { pending } : {}),
    ...(exhaustedAt !== undefined ? { exhaustedAt } : {}),
    ...(auditedAt !== undefined ? { auditedAt } : {}),
    ...(searchDownAt !== undefined ? { searchDownAt } : {}),
    ...(notes.length ? { notes } : {}),
    ...(revision ? { revision } : {}),
    ...(value.erpChecked === true ? { erpChecked: true as const } : {}),
    ...(value.knowledgeChecked === true ? { knowledgeChecked: true as const } : {}),
  };
}

function readRevision(value: unknown): StoredRevision | undefined {
  if (!isRecord(value) || typeof value.version !== 'number' || typeof value.instruction !== 'string' || typeof value.search !== 'boolean') return undefined;
  return {
    version: value.version,
    instruction: value.instruction,
    search: value.search,
    ...(typeof value.fromStep === 'number' ? { fromStep: value.fromStep } : {}),
    ...(value.erpChecked === true ? { erpChecked: true as const } : {}),
    ...(value.knowledgeChecked === true ? { knowledgeChecked: true as const } : {}),
  };
}

/** 더 검색하는 고치기에서 아직 한 단계도 하지 않았으면 끝내기를 막는다 (모델이 바로 끝내 부탁한 근거를 찾지 않는 것을 막는다) */
export function revisionNeedsStep(state: StoredState, stepsUsed: number, maxSteps: number): boolean {
  const revision = state.revision;
  return Boolean(revision?.search && revision.fromStep === stepsUsed && stepsUsed < maxSteps);
}

// ───────────────────────────── 보고서 고치기 (이슈 #418) ─────────────────────────────

/** 고치기 부탁을 '모르는 것' 맨 앞에 둘 때의 길이 */
const REVISION_GAP_MAX = 200;

/**
 * 보고서 고치기를 줄에 세울 때의 예산·메모. 더 검색하면 지금 쓴 단계에서 +4단계(모두 30단계까지)로 maxSteps를 맞추고(일찍 끝낸 조사도 4단계만 더 한다),
 * 출처가 꽉 차 검색을 못 하지 않게 maxSources를 모은 출처 + 10개 이상으로(100개까지) 늘리고, 부탁을 '모르는 것' 맨 앞에 둔다.
 * 더 검색하지 않으면 예산·메모는 그대로이고 일꾼이 반복을 건너뛴다.
 */
export function revisionStart(
  run: { stepsUsed: number; budget: AiResearchBudget; state: StoredState; sourceCount: number },
  request: { version: number; instruction: string; search: boolean },
): { budget: AiResearchBudget; state: StoredState; addedSteps: number } {
  const addedSteps = request.search ? Math.max(0, Math.min(run.stepsUsed + AI_RESEARCH_LIMITS.revisionSteps, RESEARCH_CAPS.maxSteps) - run.stepsUsed) : 0;
  const instruction = stripInvisible(request.instruction).trim();
  const revision: StoredRevision = { version: request.version, instruction, search: request.search, fromStep: run.stepsUsed };
  const state = run.state;
  if (!request.search) return { budget: run.budget, state: { ...state, revision }, addedSteps };
  const gap = cutText(instruction.replace(/\s+/g, ' '), REVISION_GAP_MAX);
  return {
    budget: { maxSteps: run.stepsUsed + addedSteps, maxSources: Math.max(run.budget.maxSources, Math.min(run.sourceCount + AI_RESEARCH_LIMITS.revisionSources, RESEARCH_CAPS.maxSources)) },
    state: { ...state, gaps: [gap, ...state.gaps.filter((g) => g !== gap)].slice(0, LIST_MAX), revision },
    addedSteps,
  };
}

function readNotes(value: unknown): StepNote[] {
  if (!Array.isArray(value)) return [];
  const out: StepNote[] = [];
  for (const n of value) {
    if (!isRecord(n) || typeof n.step !== 'number') continue;
    const error = typeof n.error === 'string' ? n.error : null;
    if (n.kind === 'read' && typeof n.sourceId === 'number') out.push({ step: n.step, kind: 'read', sourceId: n.sourceId, error });
    else if (n.kind === 'search' && typeof n.query === 'string' && Array.isArray(n.results))
      out.push({
        step: n.step,
        kind: 'search',
        query: n.query,
        engine: typeof n.engine === 'string' ? n.engine : null,
        error,
        results: n.results
          .filter((r): r is StepNoteResult => isRecord(r) && typeof r.title === 'string' && typeof r.url === 'string' && typeof r.snippet === 'string')
          .map((r) => ({ sourceId: typeof r.sourceId === 'number' ? r.sourceId : null, title: r.title, url: r.url, snippet: r.snippet })),
      });
  }
  return out;
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
      ...(isRecord(s.erp) && typeof s.erp.tool === 'string' && typeof s.erp.arguments === 'string' ? { erp: { tool: s.erp.tool, arguments: s.erp.arguments } } : {}),
      ...(isRecord(s.knowledge) && KNOWLEDGE_KINDS.some((kind) => kind === (s.knowledge as Record<string, unknown>).kind) && typeof s.knowledge.id === 'string'
        ? { knowledge: { kind: s.knowledge.kind as NonNullable<StoredSource['knowledge']>['kind'], id: s.knowledge.id } }
        : {}),
    }));
}

const KNOWLEDGE_KINDS = ['ks', 'glossary', 'manual', 'process'] as const;

/** 먼저 알아본 출처를 조사 출처 목록에 넣을 때의 요약 (검색 결과 요약이 없어서 어디서 왔는지만 적는다) */
export const SEED_SOURCE_SNIPPET = '철강맨AI 간단 답에서 쓴 출처 (아직 읽지 않음)';

/**
 * 철강맨AI에서 넘긴 seed를 저장할 모양으로 다듬는다 (이슈 #408). 간단 답은 글자 수 상한까지, 출처는 http(s)만·같은 주소는 한 번만·상한 개수까지.
 * 간단 답도 출처도 없으면 null (질문만으로 계획을 세운다).
 */
export function normalizeSeed(input: AiResearchSeed | null | undefined): AiResearchSeed | null {
  if (!input) return null;
  // 저장한 값이 다시 조사·카드 실행의 입력 상한을 넘지 않게 말줄임표 없이 자른다
  const answer = stripInvisible(input.answer ?? '').trim().slice(0, AI_RESEARCH_LIMITS.seedAnswerMax);
  const seen = new Set<string>();
  const sources: AiResearchSeed['sources'] = [];
  for (const s of input.sources ?? []) {
    const key = urlKey(s.url ?? '');
    if (!key || seen.has(key) || sources.length >= AI_RESEARCH_LIMITS.seedSourcesMax) continue;
    seen.add(key);
    sources.push({ title: cutText(stripInvisible(s.title ?? '').trim() || key, SOURCE_TITLE_MAX), url: s.url.trim() });
  }
  return answer || sources.length ? { answer, sources } : null;
}

export function storedSeed(value: unknown): AiResearchSeed | null {
  if (!isRecord(value) || typeof value.answer !== 'string' || !Array.isArray(value.sources)) return null;
  const sources = value.sources.filter((s): s is { title: string; url: string } => isRecord(s) && typeof s.title === 'string' && typeof s.url === 'string');
  return { answer: value.answer, sources: sources.map((s) => ({ title: s.title, url: s.url })) };
}

/** seed의 출처를 조사 출처(1번부터)로. 조사가 읽고 인용할 수 있고, 같은 주소는 다시 찾지 않는다 */
export function seedSources(seed: AiResearchSeed | null): StoredSource[] {
  return (seed?.sources ?? []).map((s, i) => ({ id: i + 1, title: s.title, url: s.url, snippet: SEED_SOURCE_SNIPPET }));
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
    designInferences: audit.designInferences ?? [],
    unsupportedPrecision: audit.unsupportedPrecision ?? [],
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
    designInferences: stringList(value.designInferences),
    unsupportedPrecision: stringList(value.unsupportedPrecision),
  };
}

/** 점검 LLM이 실패했을 때 조사 메모로 만든 대신값 */
export function fallbackAudit(state: StoredState): StoredAudit {
  return { thesis: state.summary, outline: [], supportedClaims: [], contradictions: [], missingDimensions: state.gaps, designInferences: [], unsupportedPrecision: [], ok: false, reportTruncated: false };
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
  /** 끝내기를 막는다(더 검색하는 보고서 고치기의 첫 단계, 이슈 #418). 이 글(고치기 부탁)을 마지막 대신 검색어로 쓴다 */
  noFinish?: string;
  /** 이 조사의 ERP 조회 결과에 나온 거래처 이름. 검색어에 있으면 쓰지 않는다 (이슈 #435) */
  partnerNames?: readonly string[];
}

/**
 * 모델이 고른 행동을 확인한다. 쓸 수 없으면(모르는 행동·막힌 검색어·이미 한 검색·모르는 출처·이미 읽은 출처·출처 없이 끝내기·출처가 꽉 찼는데 검색)
 * 계획에서 아직 하지 않은 다음 검색어로 바꾼다. 그것도 없으면 끝낸다.
 */
export function decideAction(turn: ResearchTurn, ctx: DecisionContext): ResearchDecision {
  const searched = new Set(ctx.searchedQueries.map(queryKey));
  // ERP 조회·사내 지식 출처는 웹 출처 자리와 '출처 없이 끝내기'에 세지 않는다 (이슈 #435·#484)
  const webCount = ctx.sources.filter((s) => !isInternalSource(s)).length;
  const full = webCount >= ctx.maxSources;
  if (turn.action === 'search' && !full) {
    const checked = checkResearchQuery(turn.query, ctx.partnerNames);
    if (checked.ok && !searched.has(queryKey(checked.query))) return { kind: 'search', query: checked.query, fallback: false };
  }
  if (turn.action === 'read' && turn.sourceId !== null) {
    const source = ctx.sources.find((s) => s.id === turn.sourceId);
    if (source && source.readText === undefined && source.readError === undefined) return { kind: 'read', sourceId: source.id, fallback: false };
  }
  if (turn.action === 'finish' && webCount > 0 && ctx.noFinish === undefined) return { kind: 'finish', fallback: false };
  if (ctx.noFinish !== undefined && !full) {
    // 끝내기를 막았으면: 모델이 함께 쓴 검색어 → 부탁 글(80자로 자름) → 계획의 남은 검색어 순으로 찾는다
    for (const raw of [turn.query, ctx.noFinish, ...ctx.plan.steps.map((s) => s.query)]) {
      const checked = checkResearchQuery(raw, ctx.partnerNames);
      if (checked.ok && !searched.has(queryKey(checked.query))) return { kind: 'search', query: checked.query, fallback: true };
    }
  }
  return fallbackAction(ctx, searched, full);
}

function fallbackAction(ctx: DecisionContext, searched: ReadonlySet<string>, full: boolean): ResearchDecision {
  if (!full) {
    const next = ctx.plan.steps.find((s) => !searched.has(queryKey(s.query)) && checkResearchQuery(s.query, ctx.partnerNames).ok);
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

/**
 * 🟡 검색어에서 관련성을 볼 때 빼는 낱말: 계획이 붙이는 자료 종류·시점 낱말이라 어느 결과에나 있을 수 있다 (이슈 #530)
 */
const GENERIC_QUERY_WORDS = new Set(['통계', '공식', '발표', '보고서', '규격', '논문', '최근', '최신', '현황', '전망', '비교', '차이', '자료', '한계', '비판', '반론', '위험', '사례', 'vs', 'and', 'or', 'of', 'the']);

const relevanceText = (text: string) => text.normalize('NFKC').toLowerCase();

/**
 * 검색 결과가 검색어와 상관있는지: 검색어의 낱말(자료 종류·시점 낱말·한 글자·연도는 빼고) 중 하나라도 제목·요약에 있으면 상관있다.
 * 볼 낱말이 없으면 판단하지 않고 남긴다. 예: "SS275 SM355A 차이"에 '판타지 토탈 워 SS - 나무위키'는 상관없다 (이슈 #530)
 */
export function relevantToQuery(query: string, title: string, snippet: string): boolean {
  const words = relevanceText(query)
    .split(/[\s,.;:!?()[\]{}"'·/|~\-]+/)
    .filter((w) => w.length >= 2 && !GENERIC_QUERY_WORDS.has(w) && !/^(19|20)\d{2}(년)?$/.test(w));
  if (words.length === 0) return true;
  const haystack = relevanceText(`${title} ${snippet}`);
  const squeezed = haystack.replace(/\s+/g, '');
  return words.some((w) => haystack.includes(w) || squeezed.includes(w));
}
