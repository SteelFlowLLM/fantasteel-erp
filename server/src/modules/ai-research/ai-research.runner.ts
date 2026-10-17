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
  storedPlan,
  storedSources,
  storedState,
  type StoredAudit,
  type StoredSource,
  type StoredState,
} from './ai-research.rules';

export const RESEARCH_NO_MODEL_REASON = '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요';
export const RESEARCH_TIMEOUT_REASON = '조사 시간이 30분을 넘어 멈췄어요. 지금까지 모은 출처로 다시 조사해 주세요';
const RESEARCH_ERROR_REASON = '조사 중 오류가 났어요. 다시 조사해 주세요';
const NO_PLAN_REASON = '계획에 쓸 검색어를 만들지 못했어요. 업무·LOT 번호 같은 회사 안 정보를 빼고 다시 물어봐 주세요';

export interface ResearchRunnerConfig {
  /** QUEUED·PLANNING을 찾는 간격 */
  pollMs: number;
  /** 맡은 표시의 유효 시간. 이만큼 갱신이 없으면 다른 서버(또는 다시 뜬 이 서버)가 이어서 맡는다 */
  leaseMs: number;
  renewMs: number;
  /** 한 번 맡아 조사하는 시간 상한 */
  wallClockMs: number;
  /** 검색 한도(1분)에 걸리면 쉬었다 다시 하는 시간과 횟수 */
  rateLimitWaitMs: number;
  rateLimitRetries: number;
  jsonTimeoutMs: number;
  reportTimeoutMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
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
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 내가 맡은 표시가 사라졌다 (취소됐거나 남이 맡음). 결과를 버리고 멈춘다 */
class LeaseLostError extends Error {}
/** 사용자에게 보일 이유로 실패 */
class ResearchFailure extends Error {}

interface Endpoint {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/**
 * 심층 조사 일꾼 (이슈 #378). 서버 안에 하나만 돌고 한 번에 조사 하나만 한다(로컬 LLM 하나를 겹쳐 부르지 않는다).
 * 2초마다 PLANNING·QUEUED와 맡은 표시가 끊긴 RUNNING을 찾아 조건부 UPDATE로 맡는다(공용 DB에서 여러 서버가 겹쳐 맡지 않게).
 * 맡은 동안 30초마다 표시를 120초 뒤로 늘리고, 단계마다 상태를 저장해 서버가 멈춰도 다른 서버나 다시 뜬 서버가 이어서 한다.
 * 모든 저장은 "내가 맡은 RUNNING 행"일 때만 되므로, 그 사이 취소되면 다음 저장에서 멈춘다.
 */
@Injectable()
export class AiResearchRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AiResearchRunner.name);
  readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  config: ResearchRunnerConfig = { ...DEFAULT_RUNNER_CONFIG };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

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
    const now = new Date(this.config.now());
    const candidates = await this.repository.findClaimable(this.prisma, now, 10);
    // 계획은 짧아 먼저, 멈췄던 조사를 새 조사보다 먼저
    const order: AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.RUNNING, AI_RESEARCH_STATUS.QUEUED];
    const sorted = [...candidates].sort((a, b) => order.indexOf(a.status as AiResearchStatus) - order.indexOf(b.status as AiResearchStatus));
    for (const candidate of sorted) {
      const status = candidate.status as AiResearchStatus;
      const { count } = await this.repository.claim(this.prisma, candidate.id, status, this.owner, now, this.leaseUntil());
      if (count !== 1) continue;
      await this.process(candidate.id, status === AI_RESEARCH_STATUS.PLANNING ? AI_RESEARCH_STATUS.PLANNING : AI_RESEARCH_STATUS.RUNNING);
      return true;
    }
    return false;
  }

  private leaseUntil(): Date {
    return new Date(this.config.now() + this.config.leaseMs);
  }

  private async process(id: number, status: typeof AI_RESEARCH_STATUS.PLANNING | typeof AI_RESEARCH_STATUS.RUNNING): Promise<void> {
    const renew = setInterval(() => {
      this.repository.renewLease(this.prisma, id, this.owner, this.leaseUntil()).catch((e: unknown) => this.logger.warn(`조사 ${id} 표시 갱신 실패: ${e instanceof Error ? e.name : 'unknown'}`));
    }, this.config.renewMs);
    renew.unref();
    try {
      if (status === AI_RESEARCH_STATUS.PLANNING) await this.plan(id);
      else await this.research(id);
    } catch (error) {
      if (error instanceof LeaseLostError) return;
      // 질문·웹 내용은 로그에 남기지 않는다
      this.logger.error(`조사 ${id} 실패: ${error instanceof LlmRequestError || error instanceof ResearchFailure ? error.message : error instanceof Error ? (error.stack ?? error.name) : 'unknown'}`);
      const reason = error instanceof LlmRequestError || error instanceof ResearchFailure ? error.message : RESEARCH_ERROR_REASON;
      await this.save(id, status, { status: AI_RESEARCH_STATUS.FAILED, failureReason: reason, finishedAt: new Date(this.config.now()), ...released }, [{ type: 'failed', payload: { reason } }]).catch((e: unknown) => {
        if (!(e instanceof LeaseLostError)) this.logger.error(`조사 ${id} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`);
      });
    } finally {
      clearInterval(renew);
    }
  }

  // ───────────────────────────── 계획 ─────────────────────────────

  private async plan(id: number): Promise<void> {
    const run = await this.repository.findById(this.prisma, id);
    if (!run) return;
    const endpoint = await this.endpoint();
    const value = await this.askJson(endpoint, buildPlanMessages(run.question), PLAN_JSON_SCHEMA, (v) => Array.isArray(v.steps));
    let plan: AiResearchPlan | null = readPlan(value, run.question)?.plan ?? null;
    const fallback = plan === null;
    plan ??= fallbackPlan(run.question);
    if (!plan) throw new ResearchFailure(NO_PLAN_REASON);
    const revision = run.planRevision + 1;
    await this.save(
      id,
      AI_RESEARCH_STATUS.PLANNING,
      { status: AI_RESEARCH_STATUS.AWAITING_APPROVAL, plan: plan as unknown as Prisma.InputJsonObject, planRevision: revision, researchState: EMPTY_STATE as unknown as Prisma.InputJsonObject, ...released },
      [{ type: 'plan.ready', payload: { title: plan.title, stepCount: plan.steps.length, revision, fallback } }],
    );
  }

  // ───────────────────────────── 조사 ─────────────────────────────

  private async research(id: number): Promise<void> {
    const started = this.config.now();
    const run = await this.repository.findById(this.prisma, id);
    if (!run) return;
    const plan = storedPlan(run.plan);
    if (!plan) throw new ResearchFailure('조사 계획이 없어요');
    const endpoint = await this.endpoint();
    const budget = readBudget(run.budget);
    let state = storedState(run.researchState);
    const sources = storedSources(run.sources);
    let stepsUsed = run.stepsUsed;
    // 읽기는 이 조사가 모은 출처만 (검색 결과로 받은 주소). 이어서 할 때는 저장된 출처를 다시 알려 준다
    const session = this.webTools.session(run.employeeId, { offerTools: false, maxSearches: Number.MAX_SAFE_INTEGER, maxReads: Number.MAX_SAFE_INTEGER });
    for (const source of sources) session.rememberVisited(source.url, source.title);

    let finished = false;
    while (stepsUsed < budget.maxSteps) {
      await this.assertStillRunning(id, started);
      const value = await this.askJson(endpoint, buildTurnMessages({ question: run.question, plan, state, sources, stepsUsed, budget }), TURN_JSON_SCHEMA, (v) => typeof v.action === 'string' || isRecord(v.researchState));
      const turn = readTurn(value);
      const nextState = readState(turn.state, state);
      if (nextState) state = nextState;
      const decision = decideAction(turn, { plan, searchedQueries: state.searchedQueries, sources, maxSources: budget.maxSources });
      const stateEvent: NewResearchEvent[] = nextState ? [{ type: 'state.updated', payload: { summary: cutText(state.summary, 300), gapCount: state.gaps.length, unsupportedCount: state.unsupportedClaims.length } }] : [];
      if (decision.kind === 'finish') {
        await this.save(id, AI_RESEARCH_STATUS.RUNNING, { researchState: json(state) }, stateEvent);
        finished = true;
        break;
      }
      stepsUsed += 1;
      const startedEvent: NewResearchEvent = {
        type: 'step.started',
        payload: { step: stepsUsed, action: decision.kind, query: decision.kind === 'search' ? decision.query : null, sourceId: decision.kind === 'read' ? decision.sourceId : null, fallback: decision.fallback },
      };
      await this.save(id, AI_RESEARCH_STATUS.RUNNING, { stepsUsed, researchState: json(state) }, [...stateEvent, startedEvent]);

      const events = decision.kind === 'search' ? await this.search(id, session, decision.query, sources, budget.maxSources, started) : await this.read(session, decision.sourceId, sources);
      if (decision.kind === 'search') state = { ...state, searchedQueries: [...state.searchedQueries.filter((q) => queryKey(q) !== queryKey(decision.query)), decision.query] };
      await this.save(id, AI_RESEARCH_STATUS.RUNNING, { researchState: json(state), sources: json(sources) }, events);
    }
    if (!finished)
      await this.save(id, AI_RESEARCH_STATUS.RUNNING, {}, [{ type: 'budget.exhausted', payload: { stepsUsed, maxSteps: budget.maxSteps, gapCount: state.gaps.length } }]);

    await this.assertStillRunning(id, started);
    const audit = await this.audit(endpoint, run.question, plan, state, sources);
    await this.save(id, AI_RESEARCH_STATUS.RUNNING, { audit: json(audit) }, [
      { type: 'audit.ready', payload: { claimCount: audit.supportedClaims.length, contradictionCount: audit.contradictions.length, missingCount: audit.missingDimensions.length, ok: audit.ok } },
    ]);

    await this.assertStillRunning(id, started);
    const reply = await this.llmClient.chatText(endpoint, endpoint.model, buildReportMessages({ question: run.question, plan, state, sources, audit }), {
      timeoutMs: this.config.reportTimeoutMs,
      maxTokens: 6000,
      profile: LLM_PROFILE.RESEARCH_REPORT,
    });
    const body = reply.text.trim() || fallbackReportBody(run.question, audit, state);
    const { report, citedIds } = finalizeReport(body, sources, reply.truncated);
    await this.save(
      id,
      AI_RESEARCH_STATUS.RUNNING,
      { status: AI_RESEARCH_STATUS.COMPLETED, report, audit: json({ ...audit, reportTruncated: reply.truncated }), finishedAt: new Date(this.config.now()), failureReason: null, ...released },
      [{ type: 'report.ready', payload: { chars: report.length, truncated: reply.truncated, citedCount: citedIds.length } }],
    );
  }

  /** 검색 → 새 주소를 출처로 (꽉 차면 더 넣지 않음). 1분 한도에 걸리면 쉬었다 다시 한다 */
  private async search(id: number, session: WebToolSession, query: string, sources: StoredSource[], maxSources: number, started: number): Promise<NewResearchEvent[]> {
    let outcome = await session.searchWeb(query);
    for (let retry = 0; !outcome.ok && outcome.kind === 'rate' && retry < this.config.rateLimitRetries; retry += 1) {
      await this.config.sleep(this.config.rateLimitWaitMs);
      await this.assertStillRunning(id, started);
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

  private async read(session: WebToolSession, sourceId: number, sources: StoredSource[]): Promise<NewResearchEvent[]> {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return [];
    const outcome = await session.readKnownPage(source.url);
    if (!outcome.ok) {
      source.readError = outcome.reason;
      return [{ type: 'page.read', payload: { sourceId, title: source.title, chars: 0, error: outcome.reason } }];
    }
    source.readText = outcome.text;
    return [{ type: 'page.read', payload: { sourceId, title: source.title, chars: outcome.text.length, error: null } }];
  }

  private async audit(endpoint: Endpoint, question: string, plan: AiResearchPlan, state: StoredState, sources: StoredSource[]): Promise<StoredAudit> {
    const value = await this.askJson(endpoint, buildAuditMessages({ question, plan, state, sources }), AUDIT_JSON_SCHEMA, (v) => typeof v.thesis === 'string');
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
   * 그래도 없으면 null (부르는 쪽이 대신값을 쓴다). 연결 실패·시간 초과(LlmRequestError)는 던진다.
   */
  private async askJson(endpoint: Endpoint, messages: ChatMessage[], schema: LlmJsonSchema, accept: (v: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
    const options = { timeoutMs: this.config.jsonTimeoutMs, maxTokens: 4000, profile: LLM_PROFILE.RESEARCH_JSON };
    try {
      const reply = await this.llmClient.chatJsonWithText(endpoint, endpoint.model, messages, schema, options);
      if (isRecord(reply.value) && accept(reply.value)) return reply.value;
      return parseLenientJson([reply.rawText, reply.thinking], accept);
    } catch (error) {
      if (error instanceof LlmJsonParseError) return parseLenientJson([error.rawText, error.thinking], accept);
      throw error;
    }
  }

  /** 단계 사이: 취소됐거나 남이 맡았으면 멈추고, 시간 상한을 넘었으면 실패 */
  private async assertStillRunning(id: number, started: number): Promise<void> {
    const row = await this.repository.findById(this.prisma, id);
    if (!row || row.status !== AI_RESEARCH_STATUS.RUNNING || row.leaseOwner !== this.owner) throw new LeaseLostError();
    if (this.config.now() - started > this.config.wallClockMs) throw new ResearchFailure(RESEARCH_TIMEOUT_REASON);
  }

  /** 내가 맡은 행일 때만 저장하고 이벤트를 붙인다 (같은 트랜잭션) */
  private save(id: number, status: AiResearchStatus, data: Prisma.AiResearchRunUncheckedUpdateManyInput, events: readonly NewResearchEvent[]): Promise<void> {
    return retryOnSeqConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await this.repository.updateLeased(tx, id, this.owner, status, { ...data, leaseExpiresAt: data.leaseOwner === null ? null : this.leaseUntil() });
        if (count === 0) throw new LeaseLostError();
        await this.repository.appendEvents(tx, id, events);
      }),
    );
  }
}

const released = { leaseOwner: null, leaseExpiresAt: null } as const;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
