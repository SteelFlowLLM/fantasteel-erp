import { Injectable, Logger } from '@nestjs/common';
import {
  AI_RESEARCH_LIMITS,
  AI_RESEARCH_STATUS,
  type AiResearchCapabilities,
  type AiResearchNotionExportResult,
  type AiResearchPlan,
  type AiResearchPlanSuggestion,
  type AiResearchReportVersionView,
  type AiResearchRunSummaryView,
  type AiResearchRunView,
  type AiResearchSeed,
  type AiResearchStatus,
  type AuthUser,
  type PageResult,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AiResearchRun, Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { MCP_REQUEST_TIMEOUT_MS } from '../integration/mcp/mcp.client';
import { NotionPageService } from '../integration/notion/notion-page.service';
import { LlmClient, LlmRequestError } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import type { AiResearchPlanDto, CreateAiResearchRunDto, ListAiResearchRunsQuery, SuggestAiResearchPlanDto } from './dto/ai-research.dto';
import { AiResearchRepository, retryOnSeqConflict } from './ai-research.repository';
import { askResearchJson } from './ai-research.llm';
import { buildPlanReviseMessages, PLAN_JSON_SCHEMA } from './ai-research.prompt';
import { canExtend, checkResearchQuery, defaultBudget, EMPTY_STATE, extendedBudget, normalizeSeed, queryKey, readBudget, readPlan, revisionStart, seedSources, storedPlan, storedSeed, storedSources, storedState } from './ai-research.rules';
import { AiResearchRunner, DEFAULT_RUNNER_CONFIG } from './ai-research.runner';
import { researchLimits } from './ai-research.config';
import { buildResearchNotionMarkdown, researchNotionTitle } from './ai-research.notion';
import { hasVersionRoom, toRunSummary, toRunView, toVersionView } from './ai-research.view';

/** 계획이 세워진 뒤의 상태 (제목을 바꿀 수 있다). 그 사이 일꾼이 상태를 넘겨도(QUEUED → RUNNING) 막지 않는다 */
const PLANNED_STATUSES: AiResearchStatus[] = Object.values(AI_RESEARCH_STATUS).filter((status) => status !== AI_RESEARCH_STATUS.PLANNING);

/** 다시 조사할 수 있는(끝난) 상태 */
const FINISHED_STATUSES: AiResearchStatus[] = [AI_RESEARCH_STATUS.COMPLETED, AI_RESEARCH_STATUS.FAILED, AI_RESEARCH_STATUS.CANCELLED];

/** Notion 내보내기를 잡은 표시가 이만큼 지나면 다른 요청이 다시 잡을 수 있다 (회의록 내보내기와 같다) */
const NOTION_EXPORT_STALE_MS = MCP_REQUEST_TIMEOUT_MS * 5;

/**
 * 심층 조사 API (이슈 #378, 문서에 없는 기능). 로그인한 사원은 누구나 쓰고, 자기 조사만 보고 바꾼다(남의 조사는 없는 것처럼 RES-001).
 * 조사는 일꾼(AiResearchRunner)이 백그라운드로 하고, 화면은 GET runs/:id?afterSeq=로 진행을 받아 간다.
 * ERP 데이터는 쓰지 않는다: 질문과 검색어만 회사 밖(검색 엔진)으로 나가고, 검색어는 웹 검색과 같은 회사 안 정보 막기를 거친다.
 */
@Injectable()
export class AiResearchService {
  private readonly logger = new Logger(AiResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiResearchRepository,
    private readonly llmSettings: LlmSettingsStore,
    private readonly llmClient: LlmClient,
    private readonly runner: AiResearchRunner,
    private readonly notion: NotionPageService,
  ) {}

  async capabilities(): Promise<AiResearchCapabilities> {
    return { available: Boolean((await this.llmSettings.read()).model) };
  }

  async create(user: AuthUser, dto: CreateAiResearchRunDto): Promise<AiResearchRunView> {
    if (!(await this.llmSettings.read()).model) throw new AppException('RES-005');
    const seed = normalizeSeed(dto.seed);
    const run = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveSlot(tx, user);
      return this.repository.create(tx, { employeeId: user.employeeId, question: dto.question, budget: { ...defaultBudget(dto.budget ?? undefined) }, ...seedColumns(seed) });
    });
    this.runner.wake();
    return toRunView(run, [], 0);
  }

  /**
   * 다시 조사: 끝난(완료·실패·취소) 내 조사의 질문·계획·예산을 새 조사로 복사한다. 원래 조사는 그대로 둔다.
   * 계획이 있으면 계획 세우기를 건너뛰고 계획 확인 대기(판 1)로 만들어 고친 뒤 시작하게 하고, 계획 전에 끝났으면 계획부터 다시 세운다.
   */
  async rerun(user: AuthUser, id: number): Promise<AiResearchRunView> {
    if (!(await this.llmSettings.read()).model) throw new AppException('RES-005');
    const created = await this.prisma.$transaction(async (tx) => {
      const source = await this.owned(tx, user, id);
      if (!FINISHED_STATUSES.includes(source.status as AiResearchStatus)) throw new AppException('RES-002', '끝난(완료·실패·취소) 조사만 다시 조사할 수 있어요');
      await this.lockActiveSlot(tx, user);
      const budget = { ...readBudget(source.budget) };
      const plan = storedPlan(source.plan);
      // 먼저 알아본 것도 함께 옮긴다 (출처는 그것만 다시 넣고, 원래 조사가 모은 출처는 새로 찾는다)
      const seed = seedColumns(storedSeed(source.seed));
      if (!plan) return this.repository.create(tx, { employeeId: user.employeeId, question: source.question, budget, ...seed });
      const run = await this.repository.createPlanned(tx, {
        employeeId: user.employeeId,
        question: source.question,
        budget,
        plan: plan as unknown as Prisma.InputJsonObject,
        researchState: { ...EMPTY_STATE } as unknown as Prisma.InputJsonObject,
        ...seed,
      });
      await this.repository.appendEvents(tx, run.id, [{ type: 'plan.ready', payload: { title: plan.title, stepCount: plan.steps.length, revision: run.planRevision, fallback: false, copiedFrom: source.id } }]);
      return run;
    });
    if (created.status === AI_RESEARCH_STATUS.PLANNING) this.runner.wake();
    return this.get(user, created.id);
  }

  async list(user: AuthUser, query: ListAiResearchRunsQuery): Promise<PageResult<AiResearchRunSummaryView>> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const [rows, total] = await Promise.all([this.repository.list(this.prisma, user.employeeId, size, (page - 1) * size), this.repository.countByEmployee(this.prisma, user.employeeId)]);
    return { items: rows.map(toRunSummary), page, size, total };
  }

  async get(user: AuthUser, id: number, afterSeq = 0): Promise<AiResearchRunView> {
    return this.view(this.prisma, await this.owned(this.prisma, user, id), afterSeq);
  }

  /** 계획 고치기: 계획 확인 대기일 때만, 화면이 본 판(revision)이 지금 판과 같을 때만 (다르면 RES-003) */
  async updatePlan(user: AuthUser, id: number, revision: number, dto: AiResearchPlanDto): Promise<AiResearchRunView> {
    const plan = checkedPlan(dto);
    return this.prisma.$transaction(async (tx) => {
      const run = await this.owned(tx, user, id);
      const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: [AI_RESEARCH_STATUS.AWAITING_APPROVAL], planRevision: revision }, {
        plan: plan as unknown as Prisma.InputJsonObject,
        planRevision: { increment: 1 },
      });
      if (count === 0) throw conflictFor(run, revision);
      return this.view(tx, await this.owned(tx, user, id));
    });
  }

  /**
   * 계획을 말로 고치기 (이슈 #416): 화면의 지금 계획(저장하지 않은 고침 포함)과 부탁을 모델에 보내 고친 계획 전체를 받는다. 저장하지 않는다.
   * 받은 계획은 모델이 세운 계획과 같이 다듬는다(검색어 확인을 통과한 단계만·같은 검색어 하나·6단계까지). 저장·시작은 PUT plan·start가 다시 확인한다.
   * 일꾼을 거치지 않고 이 요청에서 바로 부른다(사원이 기다리는 짧은 JSON 하나). 일꾼이 다른 조사를 하고 있으면 LLM 요청이 겹칠 수 있다.
   */
  async suggestPlan(user: AuthUser, id: number, dto: SuggestAiResearchPlanDto): Promise<AiResearchPlanSuggestion> {
    const settings = await this.llmSettings.read();
    if (!settings.model) throw new AppException('RES-005');
    const run = await this.owned(this.prisma, user, id);
    if (run.status !== AI_RESEARCH_STATUS.AWAITING_APPROVAL) throw new AppException('RES-002', '계획 확인 대기 중인 조사만 계획을 고칠 수 있어요');
    const messages = buildPlanReviseMessages({ question: run.question, plan: dto.plan, instruction: dto.instruction, seed: storedSeed(run.seed) });
    let value: Record<string, unknown> | null;
    try {
      value = await askResearchJson(this.llmClient, { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model }, messages, PLAN_JSON_SCHEMA, (v) => Array.isArray(v.steps), {
        timeoutMs: DEFAULT_RUNNER_CONFIG.jsonTimeoutMs,
      });
    } catch (error) {
      if (!(error instanceof LlmRequestError)) throw error;
      this.logger.warn(`조사 ${id} 계획 말로 고치기 LLM 실패: ${error.message.slice(0, 160)}`);
      throw new AppException('RES-008', `AI 응답을 받지 못했어요(${error.message.slice(0, 160)}). 잠시 뒤 다시 해 주세요`);
    }
    // 모델이 제목을 비우면 지금 제목을 둔다
    const read = readPlan(value, dto.plan.title.trim() || run.question);
    if (!read) throw new AppException('RES-008');
    return { plan: read.plan, dropped: read.dropped };
  }

  /**
   * 제목 바꾸기: 계획이 있으면 어느 상태에서나 계획의 제목만 바꾼다(단계·검색어는 그대로). 본 판이 지금 판과 같을 때만, 판 +1.
   * 일꾼은 계획을 세운 뒤로 plan을 다시 쓰지 않아 조사 중에 바꿔도 겹치지 않는다. 이미 Notion으로 내보낸 페이지 제목은 그대로다.
   */
  async rename(user: AuthUser, id: number, revision: number, title: string): Promise<AiResearchRunView> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.owned(tx, user, id);
      const plan = storedPlan(run.plan);
      if (!plan || run.status === AI_RESEARCH_STATUS.PLANNING) throw new AppException('RES-002', '계획을 다 세운 뒤에 제목을 바꿀 수 있어요');
      const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: PLANNED_STATUSES, planRevision: revision }, {
        plan: { ...plan, title } as unknown as Prisma.InputJsonObject,
        planRevision: { increment: 1 },
      });
      if (count === 0) throw run.planRevision !== revision ? new AppException('RES-003') : new AppException('RES-002');
      return this.view(tx, await this.owned(tx, user, id));
    });
  }

  /** 계획 승인: 본 판이 지금 판과 같을 때만 QUEUED */
  async start(user: AuthUser, id: number, revision: number): Promise<AiResearchRunView> {
    const view = await this.prisma.$transaction(async (tx) => {
      const run = await this.owned(tx, user, id);
      const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: [AI_RESEARCH_STATUS.AWAITING_APPROVAL], planRevision: revision }, { status: AI_RESEARCH_STATUS.QUEUED });
      if (count === 0) throw conflictFor(run, revision);
      return this.view(tx, await this.owned(tx, user, id));
    });
    this.runner.wake();
    return view;
  }

  /** 더 조사하기: 단계를 다 써서 끝났고 모르는 것이 남았을 때 +4단계(모두 min(30, 기본 단계 × 2)까지), 저장된 메모·출처에서 이어서 하고 점검·보고서를 다시 쓴다 */
  async extend(user: AuthUser, id: number): Promise<AiResearchRunView> {
    const view = await this.prisma.$transaction(async (tx) => {
      const run = await this.owned(tx, user, id);
      const budget = readBudget(run.budget);
      if (!canExtend({ status: run.status as AiResearchStatus, stepsUsed: run.stepsUsed, budget, state: run.researchState === null ? null : storedState(run.researchState) }))
        throw new AppException('RES-002', `단계를 다 써서 끝났고 아직 모르는 것이 남은 조사만 더 조사할 수 있어요 (모두 ${researchLimits().maxTotalSteps}단계까지)`);
      // 판이 생긴 뒤의 더 조사하기도 판을 하나 남긴다 (이슈 #418)
      const versions = await this.repository.lastVersion(tx, id);
      if (versions > 0 && !hasVersionRoom(versions)) throw new AppException('RES-002', `보고서 판은 ${AI_RESEARCH_LIMITS.maxReportVersions}개까지 남길 수 있어요. 다시 조사로 새 조사를 만들어 주세요`);
      // 그 사이 다른 요청이 먼저 늘렸으면 updatedAt이 달라 0건이다
      const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: [AI_RESEARCH_STATUS.COMPLETED], updatedAt: run.updatedAt }, {
        status: AI_RESEARCH_STATUS.QUEUED,
        budget: { ...extendedBudget(budget) },
        finishedAt: null,
      });
      if (count === 0) throw new AppException('RES-002');
      return this.view(tx, await this.owned(tx, user, id));
    });
    this.runner.wake();
    return view;
  }

  /**
   * 보고서를 말로 고치기 (이슈 #418): 완료한 내 조사만. 처음이면 지금 보고서를 1판으로 남기고, 부탁을 메모(research_state.revision)에 넣어 다시 줄에 세운다(더 조사하기와 같은 일꾼).
   * 더 검색하면 +4단계(모두 30단계까지)와 부탁을 맨 앞 '모르는 것'으로, 아니면 모은 것으로 다시 쓴다. 고친 보고서는 일꾼이 다음 판으로 남긴다.
   * 진행 중 3개 상한에 함께 센다(RES-006). 판은 1판 포함 10개까지(RES-002).
   */
  async revise(user: AuthUser, id: number, instruction: string, search: boolean): Promise<AiResearchRunView> {
    if (!(await this.llmSettings.read()).model) throw new AppException('RES-005');
    const view = await retryOnSeqConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const run = await this.owned(tx, user, id);
        if (run.status !== AI_RESEARCH_STATUS.COMPLETED || !run.report) throw new AppException('RES-002', '완료한 조사의 보고서만 고칠 수 있어요');
        await this.lockActiveSlot(tx, user);
        let last = await this.repository.lastVersion(tx, id);
        if (!hasVersionRoom(last)) throw new AppException('RES-002', `보고서 판은 ${AI_RESEARCH_LIMITS.maxReportVersions}개까지 남길 수 있어요. 다시 조사로 새 조사를 만들어 주세요`);
        if (last === 0) {
          await this.repository.createVersion(tx, { runId: id, version: 1, instruction: null, search: false, report: run.report, charts: (run.charts ?? []) as Prisma.InputJsonValue });
          last = 1;
        }
        const version = last + 1;
        const started = revisionStart({ stepsUsed: run.stepsUsed, budget: readBudget(run.budget), state: storedState(run.researchState), sourceCount: storedSources(run.sources).length }, { version, instruction, search });
        // 그 사이 다른 요청(고치기·더 조사하기)이 먼저 줄에 세웠으면 updatedAt이 달라 0건이다
        const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: [AI_RESEARCH_STATUS.COMPLETED], updatedAt: run.updatedAt }, {
          status: AI_RESEARCH_STATUS.QUEUED,
          budget: { ...started.budget },
          researchState: started.state as unknown as Prisma.InputJsonObject,
          finishedAt: null,
        });
        if (count === 0) throw new AppException('RES-002');
        await this.repository.appendEvents(tx, id, [
          { type: 'revision.requested', payload: { version, instruction: started.state.revision?.instruction.slice(0, 200) ?? '', search, addedSteps: started.addedSteps } },
        ]);
        return this.view(tx, await this.owned(tx, user, id));
      }),
    );
    this.runner.wake();
    return view;
  }

  /** 보고서 판 하나 (내 조사만). 없는 판은 RES-001 */
  async getVersion(user: AuthUser, id: number, version: number): Promise<AiResearchReportVersionView> {
    await this.owned(this.prisma, user, id);
    const row = await this.repository.findVersion(this.prisma, id, version);
    if (!row) throw new AppException('RES-001', '보고서 판을 찾을 수 없어요');
    return toVersionView(row);
  }

  /** 취소: 끝나지 않은 조사만 */
  async cancel(user: AuthUser, id: number): Promise<AiResearchRunView> {
    const view = await retryOnSeqConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.owned(tx, user, id);
        const active = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.AWAITING_APPROVAL, AI_RESEARCH_STATUS.QUEUED, AI_RESEARCH_STATUS.RUNNING];
        const { count } = await this.repository.updateOwned(tx, { id, employeeId: user.employeeId, status: active }, { status: AI_RESEARCH_STATUS.CANCELLED, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null });
        if (count === 0) throw new AppException('RES-002', '이미 끝난 조사예요');
        await this.repository.appendEvents(tx, id, [{ type: 'cancelled', payload: {} }]);
        return this.view(tx, await this.owned(tx, user, id));
      }),
    );
    // 이 서버가 하고 있으면 하던 LLM 요청·페이지 읽기를 바로 끊는다 (다른 서버는 표시를 늘리지 못할 때 끊는다)
    this.runner.interrupt(id);
    return view;
  }

  /**
   * 완료한 조사의 보고서를 회사 Notion의 상위 페이지(회의록 내보내기와 같은 곳) 아래 새 페이지로 내보낸다. 내 조사만, 한 번만.
   * 회의록 내보내기와 같이 도구를 부르기 바로 전에 잡고(notion_exported_at), 결과를 알 수 없으면(INT-009) 잡기를 남겨 중복 페이지를 막는다.
   */
  async exportToNotion(user: AuthUser, id: number): Promise<AiResearchNotionExportResult> {
    const run = await this.owned(this.prisma, user, id);
    if (run.status !== AI_RESEARCH_STATUS.COMPLETED || !run.report) throw new AppException('RES-002', '완료한 조사만 Notion으로 내보낼 수 있어요');
    if (run.notionPageUrl) throw new AppException('RES-007');
    await this.notion.assertReady();

    const claim: { at: Date | null } = { at: null };
    const takeClaim = async () => {
      const at = new Date();
      const { count } = await this.repository.claimNotionExport(this.prisma, id, user.employeeId, at, new Date(at.getTime() - NOTION_EXPORT_STALE_MS));
      if (count === 0) {
        const current = await this.repository.findById(this.prisma, id);
        if (current?.notionPageUrl) throw new AppException('RES-007');
        throw new AppException('RES-002', '지금 다른 곳에서 이 조사를 Notion으로 내보내는 중이거나, 직전 내보내기 결과를 확인하지 못했어요. Notion을 확인하고 잠시 뒤 다시 해 주세요');
      }
      claim.at = at;
    };
    const view = toRunView(run, [], 0);
    let notionPageUrl: string;
    try {
      notionPageUrl = await this.notion.createPage({ title: researchNotionTitle(view), content: buildResearchNotionMarkdown(view) }, takeClaim);
    } catch (error) {
      const uncertain = error instanceof AppException && error.code === 'INT-009';
      if (claim.at && !uncertain) await this.repository.releaseNotionExport(this.prisma, id, claim.at);
      throw error;
    }
    const { count } = claim.at ? await this.repository.finishNotionExport(this.prisma, id, claim.at, notionPageUrl, new Date()) : { count: 0 };
    if (count === 0) {
      this.logger.error(`조사 ${id}: Notion 페이지(${notionPageUrl})를 만들었지만 잡기를 잃어 주소를 저장하지 못했어요`);
      throw new AppException('COM-001', `Notion 페이지(${notionPageUrl})는 만들었지만 조사에 주소를 남기지 못했어요. 새로 불러와 중복 페이지가 없는지 Notion에서 확인해 주세요`);
    }
    return { notionPageUrl, run: await this.get(user, id) };
  }

  /** 사원별 잠금 안에서 진행 중 조사 수를 센다. 상한이면 RES-006 (트랜잭션 안에서 부른다) */
  private async lockActiveSlot(tx: Tx, user: AuthUser): Promise<void> {
    await this.repository.lockEmployee(tx, user.employeeId);
    if ((await this.repository.countActive(tx, user.employeeId)) >= AI_RESEARCH_LIMITS.activeRunsPerEmployee) throw new AppException('RES-006');
  }

  private async owned(tx: Tx, user: AuthUser, id: number): Promise<AiResearchRun> {
    const run = await this.repository.findById(tx, id);
    if (!run || run.employeeId !== user.employeeId) throw new AppException('RES-001');
    return run;
  }

  private async view(tx: Tx, run: AiResearchRun, afterSeq = 0): Promise<AiResearchRunView> {
    const [events, lastSeq, versions] = await Promise.all([this.repository.eventsAfter(tx, run.id, afterSeq), this.repository.lastSeq(tx, run.id), this.repository.listVersions(tx, run.id)]);
    return toRunView(run, events, lastSeq, versions);
  }
}

/** 사용자가 고친 계획: 검색어마다 회사 안 정보 막기, 같은 검색어 두 번 금지 */
function checkedPlan(dto: AiResearchPlanDto): AiResearchPlan {
  const seen = new Set<string>();
  const steps = dto.steps.map((step, i) => {
    const checked = checkResearchQuery(step.query);
    if (!checked.ok) throw new AppException('RES-004', `${i + 1}단계: ${checked.reason}. 일반적인 낱말로 바꿔 주세요`);
    if (seen.has(queryKey(checked.query))) throw new AppException('COM-004', `${i + 1}단계 검색어가 앞 단계와 같아요`);
    seen.add(queryKey(checked.query));
    return { title: step.title, query: checked.query };
  });
  return { title: dto.title, steps };
}

function conflictFor(run: AiResearchRun, revision: number): AppException {
  if (run.status !== AI_RESEARCH_STATUS.AWAITING_APPROVAL) return new AppException('RES-002', '계획 확인 대기 중인 조사만 계획을 고치거나 시작할 수 있어요');
  if (run.planRevision !== revision) return new AppException('RES-003');
  return new AppException('RES-002');
}

/** seed와 그 출처를 저장할 열로 (없으면 빈 객체: 열 기본값을 쓴다) */
function seedColumns(seed: AiResearchSeed | null): { seed?: Prisma.InputJsonObject; sources?: Prisma.InputJsonArray } {
  if (!seed) return {};
  return { seed: seed as unknown as Prisma.InputJsonObject, sources: seedSources(seed) as unknown as Prisma.InputJsonArray };
}
