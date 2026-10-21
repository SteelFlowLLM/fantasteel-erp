import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS, type AiResearchChart, type AiResearchPlan, type AiResearchStatus } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AssistantWebToolbox, type WebToolSession } from '../ai-assistant/web/assistant-web-toolbox';
import { cutText, stripInvisible, urlKey } from '../ai-assistant/web/web-text';
import { LlmClient, LlmRequestError, type ChatMessage, type LlmJsonSchema } from '../llm/llm.client';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { llmEndpointOf, LlmSettingsStore } from '../llm/llm-settings.store';
import { checkCharts } from './ai-research.charts';
import { modelBudget, researchLimits, type ModelBudget } from './ai-research.config';
import { erpSourcesFrom, ResearchErpLookup } from './ai-research.erp';
import { askResearchJson, withNoThinkHint } from './ai-research.llm';
import { notifyResearchFinished } from './ai-research.notify';
import { seoulToday } from '../../common/time/seoul-date';
import {
  AUDIT_JSON_SCHEMA,
  buildAuditMessages,
  buildChartMessages,
  buildPlanMessages,
  buildReportMessages,
  buildTurnMessages,
  CHART_JSON_SCHEMA,
  PLAN_JSON_SCHEMA,
  REPORT_CONTINUE_PROMPT,
  TURN_JSON_SCHEMA,
  type PromptLimits,
} from './ai-research.prompt';
import { fallbackReportBody, finalizeReport, reportBodyForRevision } from './ai-research.report';
import { AiResearchRepository, retryOnSeqConflict, type NewResearchEvent } from './ai-research.repository';
import {
  decideAction,
  EMPTY_STATE,
  erpPartnerNames,
  fallbackAudit,
  fallbackPlan,
  isErpSource,
  isRecord,
  queryKey,
  readAudit,
  readBudget,
  readPlan,
  readState,
  readTurn,
  revisionNeedsStep,
  SNIPPET_MAX,
  SOURCE_TITLE_MAX,
  storedAudit,
  storedPlan,
  storedSeed,
  storedSources,
  storedState,
  type PendingAction,
  type StepNote,
  type StepNoteResult,
  type StoredAudit,
  type StoredRevision,
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
  /** 오늘 (Asia/Seoul). 모든 프롬프트 첫 줄에 넣는다 */
  today: string;
  /** 모델 문맥 길이로 정한 프롬프트 글자 수·보고서 출력 토큰 (조사를 맡을 때 한 번 정한다) */
  limits: PromptLimits;
  model: ModelBudget;
}

/** 조사하며 바뀌는 값 (실패해도 그때까지의 값으로 보고서를 쓰려고 밖에 둔다) */
interface Work {
  state: StoredState;
  sources: StoredSource[];
  stepsUsed: number;
  /** 연달아 출처를 하나도 못 얻은 검색 수 (이어서 할 때는 0에서 다시 센다) */
  emptySearchStreak: number;
  /** ERP 조회 결과에 나온 거래처 이름 (이슈 #435). 검색어로 내보내지 않는다 */
  partners: string[];
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
    private readonly notifications: NotificationService,
    private readonly erpLookup: ResearchErpLookup,
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
    const ctx: RunContext = {
      id,
      started: this.config.now(),
      abort: new AbortController(),
      today: seoulToday(),
      limits: researchLimits(),
      model: modelBudget(null),
    };
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
      await this.save(ctx, status, { status: AI_RESEARCH_STATUS.FAILED, failureReason: reason, finishedAt: new Date(this.config.now()), ...released }, [{ type: 'failed', payload: { reason } }], (tx) => this.notifyFinished(tx, ctx.id, AI_RESEARCH_STATUS.FAILED)).catch((e: unknown) => {
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
    // 우리 ERP 자료가 필요해 보이면 먼저 조회해서, 그 자료를 보고 웹에서 무엇을 찾을지 정한다 (이슈 #435)
    const sources = storedSources(run.sources);
    const erp = await this.gatherErp(ctx, endpoint, run.employeeId, run.question, sources);
    const partners = erpPartnerNames(sources);
    const value = await this.askJson(ctx, endpoint, buildPlanMessages(run.question, ctx.today, storedSeed(run.seed), sources.filter(isErpSource)), PLAN_JSON_SCHEMA, (v) => Array.isArray(v.steps));
    let plan: AiResearchPlan | null = readPlan(value, run.question, partners)?.plan ?? null;
    const fallback = plan === null;
    plan ??= fallbackPlan(run.question, partners);
    if (!plan) throw new ResearchFailure(NO_PLAN_REASON);
    const revision = run.planRevision + 1;
    await this.save(
      ctx,
      AI_RESEARCH_STATUS.PLANNING,
      {
        status: AI_RESEARCH_STATUS.AWAITING_APPROVAL,
        plan: plan as unknown as Prisma.InputJsonObject,
        planRevision: revision,
        researchState: json({ ...EMPTY_STATE, erpChecked: true }),
        ...(erp.length ? { sources: json(sources) } : {}),
        ...released,
      },
      [...erp, { type: 'plan.ready', payload: { title: plan.title, stepCount: plan.steps.length, revision, fallback } }],
    );
  }

  /**
   * 우리 ERP 자료 모으기 (이슈 #435): 조사를 만든 사원의 권한으로 철강맨AI 조회 도구를 불러, 성공한 조회를 'ERP 조회' 출처로 sources 뒤에 더한다(번호는 이어서).
   * 필요 없어 보이면 아무것도 더하지 않는다. AI 응답이 끊기면 모은 만큼으로 조사를 계속하고, 조사가 취소됐으면 멈춘다. 더한 출처마다 source.added 이벤트를 돌려준다.
   */
  private async gatherErp(ctx: RunContext, endpoint: Endpoint, employeeId: number, question: string, sources: StoredSource[], focus?: string): Promise<NewResearchEvent[]> {
    try {
      const found = await this.erpLookup.lookup({
        employeeId,
        question,
        endpoint,
        known: sources.flatMap((s) => (s.erp ? [{ tool: s.erp.tool, arguments: s.erp.arguments }] : [])),
        focus,
        signal: ctx.abort.signal,
      });
      const added = erpSourcesFrom(found.findings, sources.reduce((max, s) => Math.max(max, s.id), 0) + 1);
      sources.push(...added);
      return added.map((s): NewResearchEvent => ({ type: 'source.added', payload: { sourceId: s.id, title: s.title, url: s.url } }));
    } catch (error) {
      if (ctx.abort.signal.aborted) throw new LeaseLostError();
      // ERP 자료는 덤이다: 모으지 못해도 웹 조사는 계속한다
      this.logger.warn(`조사 ${ctx.id} ERP 자료 모으기 실패: ${error instanceof Error ? error.name : 'unknown'}`);
      return [];
    }
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
    await this.sizeForModel(ctx, endpoint);
    const budget = readBudget(run.budget);
    const work: Work = { state: storedState(run.researchState), sources: storedSources(run.sources), stepsUsed: run.stepsUsed, emptySearchStreak: 0, partners: [] };
    // 읽기는 이 조사가 모은 출처만 (검색 결과로 받은 주소). 이어서 할 때는 저장된 출처를 다시 알려 준다
    const session = this.webTools.session(run.employeeId, { offerTools: false, maxSearches: Number.MAX_SAFE_INTEGER, maxReads: Number.MAX_SAFE_INTEGER });
    // 계획을 복사한 다시 조사처럼 ERP 자료를 아직 살펴보지 않았거나, 더 검색하는 고치기의 부탁이 아직 살펴보지 않은 것이면 한 번 살펴본다 (이슈 #435)
    const askRevision = work.state.revision?.search === true && work.state.revision.erpChecked !== true ? work.state.revision : null;
    // 검색 없는 고치기는 모은 것으로 다시 쓸 뿐이라 조회하지 않는다
    if ((!work.state.erpChecked && work.state.revision?.search !== false) || askRevision) {
      const events = await this.gatherErp(ctx, endpoint, run.employeeId, run.question, work.sources, askRevision?.instruction);
      work.state = { ...work.state, erpChecked: true, ...(work.state.revision ? { revision: { ...work.state.revision, erpChecked: true as const } } : {}) };
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(work.state), ...(events.length ? { sources: json(work.sources) } : {}) }, events);
    }
    work.partners = erpPartnerNames(work.sources);
    for (const source of work.sources) {
      if (source.erp) session.observeErpResult(source.readText ?? '');
      else session.rememberVisited(source.url, source.title);
    }
    // 그만둔 사원의 조사는 이미 모은 ERP 자료도 근거로 쓰지 않는다 (거래처 이름 막기는 위에서 끝났다)
    if (work.sources.some(isErpSource) && !(await this.erpLookup.isActive(run.employeeId))) {
      work.sources = work.sources.filter((s) => !isErpSource(s));
      await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { sources: json(work.sources) }, []);
    }

    const notes: string[] = [];
    let llmDown = false;
    let exhausted = false;
    let searchDown = false;
    // 보고서 고치기(이슈 #418): 앞 보고서를 부탁대로 고쳐 쓴다. 더 검색하지 않으면 반복을 건너뛰고 모은 것으로 다시 쓴다
    const revision = work.state.revision ?? null;
    const previousReport = revision && run.report ? reportBodyForRevision(run.report) : null;
    const replacement = previousReport ? '앞 판 내용을 그대로 두었어요' : '조사 메모로 대신 정리했어요';
    if (!revision || revision.search)
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
        const messages = buildReportMessages({
          question: run.question,
          plan,
          state,
          sources,
          audit,
          limits: ctx.limits,
          today: ctx.today,
          revision: revision && previousReport ? { instruction: revision.instruction, previousReport } : null,
        });
        const maxTokens = ctx.model.reportMaxTokens;
        const ask = (msgs: ChatMessage[]) =>
          this.llmClient.chatText(endpoint, endpoint.model, msgs, { timeoutMs: this.config.reportTimeoutMs, maxTokens, profile: LLM_PROFILE.RESEARCH_REPORT, signal: ctx.abort.signal });
        let reply = await ask(messages);
        // 생각만 하다 예산을 다 쓴 답은 한 번만 더 생각 없이 부탁한다
        if (reply.text.trim().length < NEAR_EMPTY_CHARS) {
          await this.assertMine(ctx);
          reply = await ask(withNoThinkHint(messages));
        }
        body = reply.text.trim();
        truncated = reply.truncated;
        // 길이 한도에 걸렸으면 한 번만 끊긴 곳부터 이어 쓰게 하고 붙인다. 이어 쓰기가 실패하면 끊긴 보고서를 쓴다(맨 위 알림)
        if (truncated && body.length >= NEAR_EMPTY_CHARS) {
          await this.assertMine(ctx);
          try {
            const more = await ask(continuationMessages(messages, body));
            const merged = mergeContinuation(body, more.text);
            if (merged.length > body.length) {
              body = merged;
              truncated = more.truncated;
            }
          } catch (error) {
            if (!(error instanceof LlmRequestError) || ctx.abort.signal.aborted) throw error;
            this.logger.warn(`조사 ${ctx.id} 보고서 이어 쓰기 실패: ${cutText(error.message, 160)}`);
          }
        }
        if (body.length < NEAR_EMPTY_CHARS) body = '';
        if (!body) notes.push(`AI가 빈 보고서를 내 ${replacement}.`);
      } catch (error) {
        if (!(error instanceof LlmRequestError) || ctx.abort.signal.aborted) throw error;
        notes.push(`AI가 보고서를 쓰지 못해 ${replacement}(${cutText(error.message, 160)}).`);
      }
    else notes.push(`보고서는 ${replacement}.`);
    if (!body) {
      // 조사 메모·앞 판은 끊긴 글이 아니므로 '길이 한도' 알림을 겹쳐 달지 않는다
      truncated = false;
      body = previousReport ?? fallbackReportBody(run.question, audit, state);
    }
    const incompleteReason = notes.length ? notes.join(' ') : null;
    const { report, citedIds } = finalizeReport(body, sources, truncated, incompleteReason);
    // 차트는 덤이다: LLM이 끊겼으면 부르지 않고, 실패하면 차트 없이 끝낸다
    const charted = llmDown ? null : await this.charts(ctx, endpoint, run.question, plan, state, sources);
    const charts = charted?.charts ?? [];
    // 고치기를 마쳤으니 부탁을 메모에서 지운다 (판으로 남는다)
    const finished: StoredState = { ...state };
    delete finished.revision;
    await this.save(
      ctx,
      AI_RESEARCH_STATUS.RUNNING,
      {
        status: AI_RESEARCH_STATUS.COMPLETED,
        report,
        audit: json({ ...audit, reportTruncated: truncated, incompleteReason }),
        charts: json(charts),
        researchState: json(finished),
        finishedAt: new Date(this.config.now()),
        failureReason: null,
        ...released,
      },
      [
        { type: 'report.ready', payload: { chars: report.length, truncated, citedCount: citedIds.length, incomplete: incompleteReason !== null } },
        ...(charted ? [{ type: 'charts.ready' as const, payload: { count: charted.charts.length, droppedPoints: charted.droppedPoints } }] : []),
      ],
      async (tx) => {
        await this.notifyFinished(tx, ctx.id, AI_RESEARCH_STATUS.COMPLETED);
        await this.saveVersion(tx, ctx.id, revision, report, charts);
      },
    );
  }

  /**
   * 보고서 판 남기기 (이슈 #418, COMPLETED로 저장하는 같은 트랜잭션): 고치기였으면 그 부탁으로 다음 판을 넣고 revision.ready를 남긴다.
   * 판이 생긴 뒤에 더 조사하기로 다시 쓴 보고서도 부탁 없는 판으로 남긴다(상한을 넘으면 남기지 않는다. 서비스가 미리 막는다). 고친 적이 없으면 아무것도 하지 않는다.
   */
  private async saveVersion(tx: Tx, id: number, revision: StoredRevision | null, report: string, charts: AiResearchChart[]): Promise<void> {
    const last = await this.repository.lastVersion(tx, id);
    if (!revision && (last === 0 || last >= AI_RESEARCH_LIMITS.maxReportVersions)) return;
    const version = last + 1;
    await this.repository.createVersion(tx, { runId: id, version, instruction: revision?.instruction ?? null, search: revision?.search ?? false, report, charts: json(charts) });
    if (revision) await this.repository.appendEvents(tx, id, [{ type: 'revision.ready', payload: { version, chars: report.length } }]);
  }

  /** 보고서 뒤 차트 제안 (JSON 한 번). 점마다 출처 글에 그 숫자가 있는지 확인한다. LLM 실패·못 읽음이면 null (차트 없이 끝낸다) */
  private async charts(ctx: RunContext, endpoint: Endpoint, question: string, plan: AiResearchPlan, state: StoredState, sources: StoredSource[]): Promise<{ charts: AiResearchChart[]; droppedPoints: number } | null> {
    if (!sources.length) return null;
    await this.assertMine(ctx);
    try {
      const value = await this.askJson(ctx, endpoint, buildChartMessages({ question, plan, state, sources, limits: ctx.limits, today: ctx.today }), CHART_JSON_SCHEMA, (v) => Array.isArray(v.charts));
      return value ? checkCharts(value, sources) : null;
    } catch (error) {
      if (error instanceof LeaseLostError || ctx.abort.signal.aborted) throw error;
      this.logger.warn(`조사 ${ctx.id} 차트 제안 실패: ${error instanceof Error ? error.name : 'unknown'}`);
      return null;
    }
  }

  /** 끝난 조사(완료·실패)를 만든 사원에게 알린다 (같은 트랜잭션) */
  private async notifyFinished(tx: Tx, id: number, status: typeof AI_RESEARCH_STATUS.COMPLETED | typeof AI_RESEARCH_STATUS.FAILED): Promise<void> {
    const row = await this.repository.findById(tx, id);
    if (row) await notifyResearchFinished(this.notifications, tx, row, status);
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
      const value = await this.askJson(ctx, endpoint, buildTurnMessages({ question, plan, state: work.state, sources: work.sources, stepsUsed: work.stepsUsed, budget, limits: ctx.limits, today: ctx.today }), TURN_JSON_SCHEMA, (v) => typeof v.action === 'string' || isRecord(v.researchState));
      const turn = readTurn(value);
      const nextState = readState(turn.state, work.state);
      if (nextState) work.state = nextState;
      const noFinish = revisionNeedsStep(work.state, work.stepsUsed, budget.maxSteps) ? work.state.revision?.instruction : undefined;
      const decision = decideAction(turn, { plan, searchedQueries: work.state.searchedQueries, sources: work.sources, maxSources: budget.maxSources, noFinish, partnerNames: work.partners });
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
    const { events, note } = pending.kind === 'search' ? await this.search(ctx, session, pending.query, pending.step, work.sources, maxSources) : await this.read(ctx, session, pending.sourceId, pending.step, work.sources);
    if (pending.kind === 'search') {
      const done = events[0];
      work.emptySearchStreak = done?.type === 'search.done' && done.payload.resultCount === 0 ? work.emptySearchStreak + 1 : 0;
    }
    const { pending: _done, ...rest } = work.state;
    const notes = [...(rest.notes ?? []).filter((n) => n.step !== note.step), note].slice(-NOTES_KEPT);
    work.state = pending.kind === 'search' ? { ...rest, notes, searchedQueries: [...rest.searchedQueries.filter((q) => queryKey(q) !== queryKey(pending.query)), pending.query] } : { ...rest, notes };
    await this.save(ctx, AI_RESEARCH_STATUS.RUNNING, { researchState: json(work.state), sources: json(work.sources) }, events);
  }

  /** 검색 → 새 주소를 출처로 (꽉 차면 더 넣지 않음). 1분 한도에 걸리면 쉬었다 다시 한다 */
  private async search(ctx: RunContext, session: WebToolSession, query: string, step: number, sources: StoredSource[], maxSources: number): Promise<{ events: NewResearchEvent[]; note: StepNote }> {
    let outcome = await session.searchWeb(query);
    for (let retry = 0; !outcome.ok && outcome.kind === 'rate' && retry < this.config.rateLimitRetries; retry += 1) {
      await this.config.sleep(this.config.rateLimitWaitMs, ctx.abort.signal);
      await this.assertMine(ctx);
      outcome = await session.searchWeb(query);
    }
    if (!outcome.ok)
      return {
        events: [{ type: 'search.done', payload: { query: outcome.query || query, engine: null, resultCount: 0, added: 0, error: outcome.reason } }],
        note: { step, kind: 'search', query, engine: null, error: outcome.reason, results: [] },
      };
    const known = new Map(sources.map((s) => [urlKey(s.url), s.id]));
    // 출처 수 상한은 웹 출처만 센다 (ERP 조회 출처는 자리를 차지하지 않는다, 이슈 #435)
    let webCount = sources.filter((s) => !isErpSource(s)).length;
    const added: StoredSource[] = [];
    // 출처로 넣지 못한 결과(이미 있는 주소·꽉 참)도 단계 기록에는 남긴다 (검색어와 그 결과를 함께 근거로 보인다)
    const results: StepNoteResult[] = [];
    for (const result of outcome.results) {
      const key = urlKey(result.url);
      const title = cutText(stripInvisible(result.title), SOURCE_TITLE_MAX);
      const snippet = cutText(stripInvisible(result.snippet ?? ''), SNIPPET_MAX);
      if (!key) continue;
      const existing = known.get(key);
      if (existing !== undefined || webCount >= maxSources) {
        results.push({ sourceId: existing ?? null, title, url: result.url, snippet });
        continue;
      }
      const source: StoredSource = { id: sources.reduce((max, s) => Math.max(max, s.id), 0) + 1, title, url: result.url, snippet };
      known.set(key, source.id);
      sources.push(source);
      webCount += 1;
      added.push(source);
      results.push({ sourceId: source.id, title, url: result.url, snippet });
    }
    return {
      events: [
        { type: 'search.done', payload: { query: outcome.query, engine: outcome.engine, resultCount: outcome.results.length, added: added.length, error: null } },
        ...added.map((s): NewResearchEvent => ({ type: 'source.added', payload: { sourceId: s.id, title: s.title, url: s.url } })),
      ],
      note: { step, kind: 'search', query: outcome.query, engine: outcome.engine, error: null, results },
    };
  }

  private async read(ctx: RunContext, session: WebToolSession, sourceId: number, step: number, sources: StoredSource[]): Promise<{ events: NewResearchEvent[]; note: StepNote }> {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return { events: [], note: { step, kind: 'read', sourceId, error: '모르는 출처예요' } };
    const outcome = await session.readKnownPage(source.url, ctx.abort.signal);
    if (!outcome.ok) {
      source.readError = outcome.reason;
      return { events: [{ type: 'page.read', payload: { sourceId, title: source.title, chars: 0, error: outcome.reason } }], note: { step, kind: 'read', sourceId, error: outcome.reason } };
    }
    source.readText = outcome.text;
    return { events: [{ type: 'page.read', payload: { sourceId, title: source.title, chars: outcome.text.length, error: null } }], note: { step, kind: 'read', sourceId, error: null } };
  }

  /** 모델 문맥 길이(LM Studio)로 이 조사의 프롬프트 글자 수·보고서 출력 토큰을 정한다. 모르면 환경 변수 또는 24,000자 */
  private async sizeForModel(ctx: RunContext, endpoint: Endpoint): Promise<void> {
    let contextLength: number | null = null;
    try {
      contextLength = await this.llmClient.modelContextLength(endpoint, endpoint.model);
    } catch {
      contextLength = null;
    }
    ctx.model = modelBudget(contextLength);
    ctx.limits = { ...ctx.limits, promptChars: ctx.model.promptChars };
  }

  private async audit(ctx: RunContext, endpoint: Endpoint, question: string, plan: AiResearchPlan, state: StoredState, sources: StoredSource[]): Promise<StoredAudit> {
    const value = await this.askJson(ctx, endpoint, buildAuditMessages({ question, plan, state, sources, limits: ctx.limits, today: ctx.today }), AUDIT_JSON_SCHEMA, (v) => typeof v.thesis === 'string');
    const audit = readAudit(value, new Set(sources.map((s) => s.id)));
    return audit ? { ...audit, ok: true, reportTruncated: false } : fallbackAudit(state);
  }

  // ───────────────────────────── 공통 ─────────────────────────────

  private async endpoint(): Promise<Endpoint> {
    const settings = await this.llmSettings.read();
    if (!settings.model) throw new ResearchFailure(RESEARCH_NO_MODEL_REASON);
    return { ...llmEndpointOf(settings), model: settings.model };
  }

  /** JSON으로 묻는다 (askResearchJson). 끊겼으면(취소·표시 잃음) 결과를 버리고 멈춘다 */
  private async askJson(ctx: RunContext, endpoint: Endpoint, messages: ChatMessage[], schema: LlmJsonSchema, accept: (v: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
    try {
      return await askResearchJson(this.llmClient, endpoint, messages, schema, accept, { timeoutMs: this.config.jsonTimeoutMs, signal: ctx.abort.signal });
    } catch (error) {
      if (ctx.abort.signal.aborted) throw new LeaseLostError();
      throw error;
    }
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
  private save(ctx: RunContext, status: AiResearchStatus, data: Prisma.AiResearchRunUncheckedUpdateManyInput, events: readonly NewResearchEvent[], after?: (tx: Tx) => Promise<void>): Promise<void> {
    return retryOnSeqConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await this.repository.updateLeased(tx, ctx.id, this.owner, status, data);
        if (count === 0) {
          ctx.abort.abort(new LeaseLostError());
          throw new LeaseLostError();
        }
        await this.repository.appendEvents(tx, ctx.id, events);
        await after?.(tx);
      }),
    );
  }
}

/** 단계 기록은 이만큼까지 남긴다 (단계 상한 30보다 넉넉히) */
const NOTES_KEPT = 60;
const NEAR_EMPTY_CHARS = 5;

/** 끊긴 보고서를 이어 쓰게 하는 메시지: 앞 요청 + 끊긴 답 + 이어 쓰기 부탁 */
export function continuationMessages(messages: ChatMessage[], partial: string): ChatMessage[] {
  return [...messages, { role: 'assistant', content: partial }, { role: 'user', content: REPORT_CONTINUE_PROMPT }];
}

/**
 * 끊긴 보고서 + 이어 쓴 글. 이어 쓴 글이 앞 글의 끝부분(8~400자)을 되풀이하며 시작하면 겹친 만큼 떼고 붙인다.
 * 끊긴 자리가 낱말 중간이면 그대로 잇고, 줄 끝이면 줄을 바꿔 잇는다.
 */
export function mergeContinuation(partial: string, more: string): string {
  const next = more.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').replace(/\s+$/, '');
  if (!next.trim()) return partial;
  const head = partial.replace(/\s+$/, '');
  const trimmedNext = next.replace(/^\s+/, '');
  for (let n = Math.min(400, head.length, trimmedNext.length); n >= 8; n -= 1) {
    if (trimmedNext.startsWith(head.slice(head.length - n))) return `${head}${trimmedNext.slice(n)}`;
  }
  const joiner = /\n\s*$/.test(partial) || /^\s*\n/.test(more) || /^#{1,6}\s/.test(trimmedNext) ? '\n' : /\s$/.test(partial) || /^\s/.test(more) ? ' ' : '';
  return `${head}${joiner}${trimmedNext}`;
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
