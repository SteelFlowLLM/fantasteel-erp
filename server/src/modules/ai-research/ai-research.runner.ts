import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AI_RESEARCH_STATUS, type AiResearchPlan, type AiResearchStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantWebToolbox, type WebToolSession } from '../ai-assistant/web/assistant-web-toolbox';
import { cutText, stripInvisible, urlKey } from '../ai-assistant/web/web-text';
import { LlmClient, LlmJsonParseError, LlmRequestError, type ChatMessage, type LlmJsonSchema } from '../llm/llm.client';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { AUDIT_JSON_SCHEMA, buildAuditMessages, buildPlanMessages, buildReportMessages, buildTurnMessages, PLAN_JSON_SCHEMA, TURN_JSON_SCHEMA } from './ai-research.prompt';
import { fallbackReportBody, finalizeReport } from './ai-research.report';
import { AiResearchRepository, retryOnSeqConflict, type NewResearchEvent } from './ai-research.repository';
import {
  decideAction,
  EMPTY_STATE,
  fallbackAudit,
  fallbackPlan,
  isRecord,
  parseLenientJson,
  queryKey,
  readAudit,
  readBudget,
  readPlan,
  readState,
  readTurn,
  SNIPPET_MAX,
  SOURCE_TITLE_MAX,
  storedAudit,
  storedPlan,
  storedSources,
  storedState,
  type PendingAction,
  type StoredAudit,
  type StoredSource,
  type StoredState,
} from './ai-research.rules';

export const RESEARCH_NO_MODEL_REASON = '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요';
/** 보고서 맨 위 알림에 들어가는 이유들 (다 마치지 못하고 모은 것으로 정리했을 때) */
export const INCOMPLETE_TIMEOUT = '조사 시간이 30분을 넘어 멈췄어요.';
/** 검색이 연달아 이만큼 비면 남은 단계를 쓰지 않고 모은 것으로 정리한다 */
export const SEARCH_FAIL_STREAK_MAX = 3;
const SEARCH_UNAVAILABLE = '검색 엔진에서 결과를 받지 못했어요.';
const NAVER_HINT = ' 서버 .env에 네이버 검색 키(NAVER_CLIENT_ID·NAVER_CLIENT_SECRET)를 넣으면 나아져요.';
const RESEARCH_ERROR_REASON = '조사 중 오류가 났어요. 새 조사로 다시 물어봐 주세요';
const NO_PLAN_REASON = '계획에 쓸 검색어를 만들지 못했어요. 업무·LOT 번호 같은 회사 안 정보를 빼고 새 조사로 다시 물어봐 주세요';

export interface ResearchRunnerConfig {
  /** QUEUED·PLANNING을 찾는 간격 */
  pollMs: number;
  /** 맡은 표시의 유효 시간. 이만큼 갱신이 없으면 다른 서버(또는 다시 뜬 이 서버)가 이어서 맡는다 */
  leaseMs: number;
  /** 표시를 늘리는 간격. 늘리지 못하면(취소됐거나 남이 맡음) 하던 일을 끊는다 */
  renewMs: number;
  /** 한 번 맡아 조사하는 시간 상한. 넘으면 모은 것으로 점검·보고서를 쓴다 */
  wallClockMs: number;
  /** 검색 한도(1분)에 걸리면 쉬었다 다시 하는 시간과 횟수 */
  rateLimitWaitMs: number;
  rateLimitRetries: number;
  jsonTimeoutMs: number;
  reportTimeoutMs: number;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_RUNNER_CONFIG: ResearchRunnerConfig = {
  pollMs: 2000,
  leaseMs: 120_000,
  renewMs: 30_000,
  wallClockMs: 30 * 60_000,
  rateLimitWaitMs: 20_000,
  rateLimitRetries: 3,
  jsonTimeoutMs: 3 * 60_000,
  reportTimeoutMs: 5 * 60_000,
  now: Date.now,
  sleep: abortableSleep,
};

/** 내가 맡은 표시가 사라졌다 (취소됐거나 남이 맡음). 결과를 버리고 멈춘다 */
class LeaseLostError extends Error {}
/** 사용자에게 보일 이유로 실패 */
class ResearchFailure extends Error {}
/** 한 번 맡은 시간 상한을 넘었다 → 모은 것으로 보고서 */
class WallClockExceeded extends Error {}

interface Endpoint {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/** 맡은 조사 하나의 실행 정보. signal은 취소·표시 잃음을 알면 끊긴다 (LLM 요청·페이지 읽기·쉬기가 함께 끊긴다) */
interface RunContext {
  id: number;
  started: number;
  abort: AbortController;
}

/** 조사하며 바뀌는 값 (실패해도 그때까지의 값으로 보고서를 쓰려고 밖에 둔다) */
interface Work {
  state: StoredState;
  sources: StoredSource[];
  stepsUsed: number;
  /** 연달아 출처를 하나도 못 얻은 검색 수 (이어서 할 때는 0에서 다시 센다) */
  emptySearchStreak: number;
}

/**
 * 심층 조사 일꾼 (이슈 #378). 서버 안에 하나만 돌고 한 번에 조사 하나만 한다(로컬 LLM 하나를 겹쳐 부르지 않는다).
 * 2초마다 PLANNING·QUEUED와 맡은 표시가 끊긴 RUNNING을 찾아 조건부 UPDATE로 맡는다(공용 DB에서 여러 서버가 겹쳐 맡지 않게, 시각은 DB now()).
 * 맡은 동안 30초마다 표시를 120초 뒤로 늘리고, 단계마다 상태를 저장해 서버가 멈춰도 다른 서버나 다시 뜬 서버가 이어서 한다.
 * 모든 저장은 "내가 맡은 그 상태의 행"일 때만 된다. 취소는 이 서버에서는 바로(interrupt), 다른 서버에서는 표시를 늘리지 못할 때 알고 하던 요청을 끊는다.
 */
@Injectable()
export class AiResearchRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AiResearchRunner.name);
  readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  config: ResearchRunnerConfig = { ...DEFAULT_RUNNER_CONFIG };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private current: RunContext | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiResearchRepository,
    private readonly llmClient: LlmClient,
    private readonly llmSettings: LlmSettingsStore,
    private readonly webTools: AssistantWebToolbox,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.AI_RESEARCH_WORKER === 'off') return;
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
    this.current?.abort.abort(new LeaseLostError());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.pollMs);
    this.timer.unref();
    // 켤 때 바로 한 번: 표시가 끊긴 RUNNING(서버가 멈춘 조사)을 이어서 한다
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 새 조사·시작 뒤 2초를 기다리지 않고 바로 찾는다 */
  wake(): void {
    if (this.timer) void this.tick();
  }

  /** 이 서버가 하고 있는 조사가 취소됐다: 하던 LLM 요청·페이지 읽기를 바로 끊는다 */
  interrupt(id: number): void {
    if (this.current?.id === id) this.current.abort.abort(new LeaseLostError());
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.timer && (await this.processNext())) {
        // 맡을 것이 없을 때까지 차례로
      }
    } catch (error) {
      this.logger.warn(`심층 조사 일꾼 오류: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      this.busy = false;
    }
  }

  /** 하나를 맡아 끝까지(또는 계획까지) 한다. 맡은 것이 없으면 false (시험은 이것을 직접 부른다) */
  async processNext(): Promise<boolean> {
    const candidates = await this.repository.findClaimable(this.prisma, 10);
    // 계획은 짧아 먼저, 멈췄던 조사를 새 조사보다 먼저
    const order: AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.RUNNING, AI_RESEARCH_STATUS.QUEUED];
    const sorted = [...candidates].sort((a, b) => order.indexOf(a.status as AiResearchStatus) - order.indexOf(b.status as AiResearchStatus));
    for (const candidate of sorted) {
      const status = candidate.status as AiResearchStatus;
      if (!(await this.repository.claim(this.prisma, candidate.id, status, this.owner, this.config.leaseMs))) continue;
      await this.process(candidate.id, status === AI_RESEARCH_STATUS.PLANNING ? AI_RESEARCH_STATUS.PLANNING : AI_RESEARCH_STATUS.RUNNING);
      return true;
    }
    return false;
  }

  private async process(id: number, status: typeof AI_RESEARCH_STATUS.PLANNING | typeof AI_RESEARCH_STATUS.RUNNING): Promise<void> {
    const ctx: RunContext = { id, started: this.config.now(), abort: new AbortController() };
    this.current = ctx;
    const renew = setInterval(() => {
      this.repository
        .renewLease(this.prisma, id, this.owner, this.config.leaseMs)
        .then((mine) => {
          // 다른 서버에서 취소했거나 남이 맡았다: 하던 요청을 끊는다
          if (!mine) ctx.abort.abort(new LeaseLostError());
        })
        .catch((e: unknown) => this.logger.warn(`조사 ${id} 표시 갱신 실패: ${e instanceof Error ? e.name : 'unknown'}`));
    }, this.config.renewMs);
    renew.unref();
    try {
      if (status === AI_RESEARCH_STATUS.PLANNING) await this.plan(ctx);
      else await this.research(ctx);
    } catch (error) {
      if (error instanceof LeaseLostError || ctx.abort.signal.aborted) return;
      // 질문·웹 내용은 로그에 남기지 않는다
      this.logger.error(`조사 ${id} 실패: ${error instanceof LlmRequestError || error instanceof ResearchFailure ? error.message : error instanceof Error ? (error.stack ?? error.name) : 'unknown'}`);
      const reason = error instanceof LlmRequestError || error instanceof ResearchFailure ? error.message : RESEARCH_ERROR_REASON;
      await this.save(ctx, status, { status: AI_RESEARCH_STATUS.FAILED, failureReason: reason, finishedAt: new Date(this.config.now()), ...released }, [{ type: 'failed', payload: { reason } }]).catch((e: unknown) => {
        if (!(e instanceof LeaseLostError)) this.logger.error(`조사 ${id} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`);
      });
    } finally {
      clearInterval(renew);
      if (this.current === ctx) this.current = null;
    }
  }

  // ───────────────────────────── 계획 ─────────────────────────────

  private async plan(ctx: RunContext): Promise<void> {
    const run = await this.repository.findById(this.prisma, ctx.id);
    if (!run) return;
    const endpoint = await this.endpoint();
    const value = await this.askJson(ctx, endpoint, buildPlanMessages(run.question), PLAN_JSON_SCHEMA, (v) => Array.isArray(v.steps));
    let plan: AiResearchPlan | null = readPlan(value, run.question)?.plan ?? null;
    const fallback = plan === null;
    plan ??= fallbackPlan(run.question);
    if (!plan) throw new ResearchFailure(NO_PLAN_REASON);
    const revision = run.planRevision + 1;
    await this.save(
      ctx,
      AI_RESEARCH_STATUS.PLANNING,
      { status: AI_RESEARCH_STATUS.AWAITING_APPROVAL, plan: plan as unknown as Prisma.InputJsonObject, planRevision: revision, researchState: json(EMPTY_STATE), ...released },
      [{ type: 'plan.ready', payload: { title: plan.title, stepCount: plan.steps.length, revision, fallback } }],
    );
  }

  // ───────────────────────────── 조사 ─────────────────────────────

  /**
   * 반복 → (단계를 다 썼으면 알림) → 점검 → 보고서. 반복 중 시간 상한·LLM 실패가 나면 그때까지 모은 것으로 점검·보고서를 쓰고,
   * 점검·보고서 LLM이 실패해도 조사 메모로 대신 써서 COMPLETED로 둔다(보고서 맨 위에 알림). 버리지 않는다.
   */
  private async research(ctx: RunContext): Promise<void> {
    const run = await this.repository.findById(this.prisma, ctx.id);
    if (!run) return;
    const plan = storedPlan(run.plan);
    if (!plan) throw new ResearchFailure('조사 계획이 없어요');
    const endpoint = await this.endpoint();
    const budget = readBudget(run.budget);
    const work: Work = { state: storedState(run.researchState), sources: storedSources(run.sources), stepsUsed: run.stepsUsed, emptySearchStreak: 0 };
    // 읽기는 이 조사가 모은 출처만 (검색 결과로 받은 주소). 이어서 할 때는 저장된 출처를 다시 알려 준다
    const session = this.webTools.session(run.employeeId, { offerTools: false, maxSearches: Number.MAX_SAFE_INTEGER, maxReads: Number.MAX_SAFE_INTEGER });
    for (const source of work.sources) session.rememberVisited(source.url, source.title);

    const notes: string[] = [];
    let llmDown = false;
    let exhausted = false;
    let searchDown = false;
    try {
      ({ exhausted, searchDown } = await this.loop(ctx, endpoint, run.question, plan, budget, work, session));
    } catch (error) {
      if (error instanceof LeaseLostError || ctx.abort.signal.aborted) throw error;
      if (error instanceof WallClockExceeded) notes.push(INCOMPLETE_TIMEOUT);
      else if (error instanceof LlmRequestError) {
        notes.push(`AI 응답을 받지 못해 조사를 멈췄어요(${cutText(error.message, 160)}).`);
        llmDown = true;
      } else throw error;
    }
    const { state, sources, stepsUsed } = work;
    if (searchDown) {
      const reason = this.webTools.capabilities().engines.includes('naver') ? SEARCH_UNAVAILABLE : `${SEARCH_UNAVAILABLE}${NAVER_HINT}`;
      notes.push(reason);
      state.searchDownAt = stepsUsed;
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(state) }, [{ type: 'budget.exhausted', payload: { stepsUsed, maxSteps: budget.maxSteps, gapCount: state.gaps.length, reason } }]);
    } else if (exhausted && state.exhaustedAt !== budget.maxSteps) {
      // 이어서 할 때 같은 알림을 두 번 남기지 않는다 (더 조사하기로 maxSteps가 바뀌면 다시 남긴다)
      state.exhaustedAt = budget.maxSteps;
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(state) }, [{ type: 'budget.exhausted', payload: { stepsUsed, maxSteps: budget.maxSteps, gapCount: state.gaps.length } }]);
    }

    await this.assertMine(ctx);
    const saved = storedAudit(run.audit);
    let audit: StoredAudit;
    if (saved && state.auditedAt === stepsUsed) audit = saved;
    else {
      if (llmDown) audit = fallbackAudit(state);
      else
        try {
          audit = await this.audit(ctx, endpoint, run.question, plan, state, sources);
        } catch (error) {
          if (!(error instanceof LlmRequestError) || ctx.abort.signal.aborted) throw error;
          notes.push(`AI가 근거 점검을 하지 못했어요(${cutText(error.message, 160)}).`);
          llmDown = true;
          audit = fallbackAudit(state);
        }
      state.auditedAt = stepsUsed;
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { audit: json(audit), researchState: json(state) }, [
        { type: 'audit.ready', payload: { claimCount: audit.supportedClaims.length, contradictionCount: audit.contradictions.length, missingCount: audit.missingDimensions.length, ok: audit.ok } },
      ]);
    }

    await this.assertMine(ctx);
    let body = '';
    let truncated = false;
    if (!llmDown)
      try {
        const messages = buildReportMessages({ question: run.question, plan, state, sources, audit });
        const ask = (msgs: ChatMessage[], maxTokens: number) =>
          this.llmClient.chatText(endpoint, endpoint.model, msgs, { timeoutMs: this.config.reportTimeoutMs, maxTokens, profile: LLM_PROFILE.RESEARCH_REPORT, signal: ctx.abort.signal });
        let reply = await ask(messages, REPORT_MAX_TOKENS);
        // 생각만 하다 예산을 다 쓴 답은 한 번만 더 크게·생각 없이 부탁한다
        if (reply.text.trim().length < NEAR_EMPTY_CHARS) {
          await this.assertMine(ctx);
          reply = await ask(withNoThinkHint(messages), retryMaxTokens(REPORT_MAX_TOKENS));
        }
        body = reply.text.trim();
        truncated = reply.truncated;
        if (body.length < NEAR_EMPTY_CHARS) body = '';
        if (!body) notes.push('AI가 빈 보고서를 내 조사 메모로 대신 정리했어요.');
      } catch (error) {
        if (!(error instanceof LlmRequestError) || ctx.abort.signal.aborted) throw error;
        notes.push(`AI가 보고서를 쓰지 못해 조사 메모로 대신 정리했어요(${cutText(error.message, 160)}).`);
      }
    else notes.push('보고서는 조사 메모로 대신 정리했어요.');
    if (!body) {
      // 조사 메모는 끊긴 글이 아니므로 '길이 한도' 알림을 겹쳐 달지 않는다
      truncated = false;
      body = fallbackReportBody(run.question, audit, state);
    }
    const incompleteReason = notes.length ? notes.join(' ') : null;
    const { report, citedIds } = finalizeReport(body, sources, truncated, incompleteReason);
    await this.save(
      ctx,
      AI_RESEARCH_STATUS.RUNNING,
      { status: AI_RESEARCH_STATUS.COMPLETED, report, audit: json({ ...audit, reportTruncated: truncated, incompleteReason }), finishedAt: new Date(this.config.now()), failureReason: null, ...released },
      [{ type: 'report.ready', payload: { chars: report.length, truncated, citedCount: citedIds.length, incomplete: incompleteReason !== null } }],
    );
  }

  /**
   * 반복. 단계를 다 써서 끝났으면 exhausted, 검색이 연달아 비어 멈췄으면 searchDown, 모델이 끝냈으면 둘 다 false.
   * 행동은 실행 전에 단계 수와 함께 pending으로 저장하고, 결과와 함께 지운다: 서버가 그 사이 멈추면 이어서 할 때 모델에 다시 묻지 않고 그 행동부터 한다.
   */
  private async loop(ctx: RunContext, endpoint: Endpoint, question: string, plan: AiResearchPlan, budget: ReturnType<typeof readBudget>, work: Work, session: WebToolSession): Promise<{ exhausted: boolean; searchDown: boolean }> {
    for (;;) {
      if (work.state.pending) {
        await this.execute(ctx, session, work, budget.maxSources, work.state.pending);
        if (work.emptySearchStreak >= SEARCH_FAIL_STREAK_MAX) return { exhausted: false, searchDown: true };
        continue;
      }
      if (work.stepsUsed >= budget.maxSteps) return { exhausted: true, searchDown: false };
      await this.assertMine(ctx);
      if (this.config.now() - ctx.started > this.config.wallClockMs) throw new WallClockExceeded();
      const value = await this.askJson(ctx, endpoint, buildTurnMessages({ question, plan, state: work.state, sources: work.sources, stepsUsed: work.stepsUsed, budget }), TURN_JSON_SCHEMA, (v) => typeof v.action === 'string' || isRecord(v.researchState));
      const turn = readTurn(value);
      const nextState = readState(turn.state, work.state);
      if (nextState) work.state = nextState;
      const decision = decideAction(turn, { plan, searchedQueries: work.state.searchedQueries, sources: work.sources, maxSources: budget.maxSources });
      const stateEvent: NewResearchEvent[] = nextState ? [{ type: 'state.updated', payload: { summary: cutText(work.state.summary, 300), gapCount: work.state.gaps.length, unsupportedCount: work.state.unsupportedClaims.length } }] : [];
      if (decision.kind === 'finish') {
        await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(work.state) }, stateEvent);
        return { exhausted: false, searchDown: false };
      }
      const step = work.stepsUsed + 1;
      const pending: PendingAction = decision.kind === 'search' ? { kind: 'search', query: decision.query, step } : { kind: 'read', sourceId: decision.sourceId, step };
      work.stepsUsed = step;
      work.state = { ...work.state, pending };
      const startedEvent: NewResearchEvent = {
        type: 'step.started',
        payload: { step, action: decision.kind, query: decision.kind === 'search' ? decision.query : null, sourceId: decision.kind === 'read' ? decision.sourceId : null, fallback: decision.fallback },
      };
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { stepsUsed: step, researchState: json(work.state) }, [...stateEvent, startedEvent]);
    }
  }

  /** 저장해 둔 행동 하나를 하고, 결과·출처와 함께 pending을 지운다 */
  private async execute(ctx: RunContext, session: WebToolSession, work: Work, maxSources: number, pending: PendingAction): Promise<void> {
    const events = pending.kind === 'search' ? await this.search(ctx, session, pending.query, work.sources, maxSources) : await this.read(ctx, session, pending.sourceId, work.sources);
    if (pending.kind === 'search') {
      const done = events[0];
      work.emptySearchStreak = done?.type === 'search.done' && done.payload.resultCount === 0 ? work.emptySearchStreak + 1 : 0;
    }
    const { pending: _done, ...rest } = work.state;
    work.state = pending.kind === 'search' ? { ...rest, searchedQueries: [...rest.searchedQueries.filter((q) => queryKey(q) !== queryKey(pending.query)), pending.query] } : rest;
    await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(work.state), sources: json(work.sources) }, events);
  }

  /** 검색 → 새 주소를 출처로 (꽉 차면 더 넣지 않음). 1분 한도에 걸리면 쉬었다 다시 한다 */
  private async search(ctx: RunContext, session: WebToolSession, query: string, sources: StoredSource[], maxSources: number): Promise<NewResearchEvent[]> {
    let outcome = await session.searchWeb(query);
    for (let retry = 0; !outcome.ok && outcome.kind === 'rate' && retry < this.config.rateLimitRetries; retry += 1) {
      await this.config.sleep(this.config.rateLimitWaitMs, ctx.abort.signal);
      await this.assertMine(ctx);
      outcome = await session.searchWeb(query);
    }
    if (!outcome.ok) return [{ type: 'search.done', payload: { query: outcome.query || query, engine: null, resultCount: 0, added: 0, error: outcome.reason } }];
    const known = new Set(sources.map((s) => urlKey(s.url)));
    const added: StoredSource[] = [];
    for (const result of outcome.results) {
      const key = urlKey(result.url);
      if (!key || known.has(key) || sources.length >= maxSources) continue;
      known.add(key);
      const source: StoredSource = {
        id: sources.reduce((max, s) => Math.max(max, s.id), 0) + 1,
        title: cutText(stripInvisible(result.title), SOURCE_TITLE_MAX),
        url: result.url,
        snippet: cutText(stripInvisible(result.snippet ?? ''), SNIPPET_MAX),
      };
      sources.push(source);
      added.push(source);
    }
    return [
      { type: 'search.done', payload: { query: outcome.query, engine: outcome.engine, resultCount: outcome.results.length, added: added.length, error: null } },
      ...added.map((s): NewResearchEvent => ({ type: 'source.added', payload: { sourceId: s.id, title: s.title, url: s.url } })),
    ];
  }

  private async read(ctx: RunContext, session: WebToolSession, sourceId: number, sources: StoredSource[]): Promise<NewResearchEvent[]> {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return [];
    const outcome = await session.readKnownPage(source.url, ctx.abort.signal);
    if (!outcome.ok) {
      source.readError = outcome.reason;
      return [{ type: 'page.read', payload: { sourceId, title: source.title, chars: 0, error: outcome.reason } }];
    }
    source.readText = outcome.text;
    return [{ type: 'page.read', payload: { sourceId, title: source.title, chars: outcome.text.length, error: null } }];
  }

  private async audit(ctx: RunContext, endpoint: Endpoint, question: string, plan: AiResearchPlan, state: StoredState, sources: StoredSource[]): Promise<StoredAudit> {
    const value = await this.askJson(ctx, endpoint, buildAuditMessages({ question, plan, state, sources }), AUDIT_JSON_SCHEMA, (v) => typeof v.thesis === 'string');
    const audit = readAudit(value, new Set(sources.map((s) => s.id)));
    return audit ? { ...audit, ok: true, reportTruncated: false } : fallbackAudit(state);
  }

  // ───────────────────────────── 공통 ─────────────────────────────

  private async endpoint(): Promise<Endpoint> {
    const settings = await this.llmSettings.read();
    if (!settings.model) throw new ResearchFailure(RESEARCH_NO_MODEL_REASON);
    return { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model };
  }

  /**
   * JSON 형식을 강제해 묻고 너그럽게 읽는다: 형식대로 왔으면 그 값, 아니면 답 글·생각 글에서 조건에 맞는 마지막 객체.
   * 그래도 없으면 null (부르는 쪽이 대신값을 쓴다). 연결 실패·시간 초과(LlmRequestError)·끊김은 던진다.
   */
  private async askJson(ctx: RunContext, endpoint: Endpoint, messages: ChatMessage[], schema: LlmJsonSchema, accept: (v: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
    const ask = async (msgs: ChatMessage[], maxTokens: number): Promise<{ value: Record<string, unknown> | null; empty: boolean }> => {
      const options = { timeoutMs: this.config.jsonTimeoutMs, maxTokens, profile: LLM_PROFILE.RESEARCH_JSON, signal: ctx.abort.signal };
      try {
        const reply = await this.llmClient.chatJsonWithText(endpoint, endpoint.model, msgs, schema, options);
        if (isRecord(reply.value) && accept(reply.value)) return { value: reply.value, empty: false };
        return { value: parseLenientJson([reply.rawText, reply.thinking], accept), empty: !reply.rawText.trim() };
      } catch (error) {
        if (ctx.abort.signal.aborted) throw new LeaseLostError();
        if (error instanceof LlmJsonParseError) return { value: parseLenientJson([error.rawText, error.thinking], accept), empty: !error.rawText.trim() };
        throw error;
      }
    };
    const first = await ask(messages, JSON_MAX_TOKENS);
    if (first.value || !first.empty) return first.value;
    // content가 빈 답(생각에 예산을 다 씀)이면 한 번만 더 크게·생각 없이 부탁한다
    return (await ask(withNoThinkHint(messages), retryMaxTokens(JSON_MAX_TOKENS))).value;
  }

  /** 단계 사이: 취소됐거나 남이 맡았으면 하던 일을 끊고 멈춘다 */
  private async assertMine(ctx: RunContext): Promise<void> {
    if (ctx.abort.signal.aborted) throw new LeaseLostError();
    const row = await this.repository.findById(this.prisma, ctx.id);
    if (!row || row.status !== AI_RESEARCH_STATUS.RUNNING || row.leaseOwner !== this.owner) {
      ctx.abort.abort(new LeaseLostError());
      throw new LeaseLostError();
    }
  }

  /** 내가 맡은 행일 때만 저장하고 이벤트를 붙인다 (같은 트랜잭션). 맡은 표시 시각은 renewLease(DB now())만 늘린다 */
  private save(ctx: RunContext, status: AiResearchStatus, data: Prisma.AiResearchRunUncheckedUpdateManyInput, events: readonly NewResearchEvent[]): Promise<void> {
    return retryOnSeqConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await this.repository.updateLeased(tx, ctx.id, this.owner, status, data);
        if (count === 0) {
          ctx.abort.abort(new LeaseLostError());
          throw new LeaseLostError();
        }
        await this.repository.appendEvents(tx, ctx.id, events);
      }),
    );
  }
}

const REPORT_MAX_TOKENS = 6000;
const JSON_MAX_TOKENS = 4000;
const RETRY_MAX_TOKENS_CAP = 16000;
const NEAR_EMPTY_CHARS = 5;
const NO_THINK_HINT = '지금은 생각 과정 없이 바로 답만 써요. /no_think';

const retryMaxTokens = (base: number): number => Math.min(base * 2, RETRY_MAX_TOKENS_CAP);

/** 마지막 user 메시지 끝에 '생각하지 말고 바로 답' 지시를 붙인다 (/no_think는 Qwen 외 모델에는 그냥 글) */
export function withNoThinkHint(messages: ChatMessage[]): ChatMessage[] {
  const index = messages.map((m) => m.role).lastIndexOf('user');
  if (index < 0) return [...messages, { role: 'user', content: NO_THINK_HINT }];
  return messages.map((m, i) => (i === index ? { ...m, content: `${m.content}\n\n${NO_THINK_HINT}` } : m));
}

const released = { leaseOwner: null, leaseExpiresAt: null } as const;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** 끊기면 바로 깨는 쉬기 (검색 한도에 걸려 기다릴 때) */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
