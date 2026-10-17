import { Injectable } from '@nestjs/common';
import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS, type AiResearchCapabilities, type AiResearchPlan, type AiResearchRunSummaryView, type AiResearchRunView, type AiResearchStatus, type AuthUser, type PageResult } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AiResearchRun, Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import type { AiResearchPlanDto, CreateAiResearchRunDto, ListAiResearchRunsQuery } from './dto/ai-research.dto';
import { AiResearchRepository, retryOnSeqConflict } from './ai-research.repository';
import { canExtend, checkResearchQuery, defaultBudget, extendedBudget, queryKey, readBudget, storedState } from './ai-research.rules';
import { AiResearchRunner } from './ai-research.runner';
import { toRunSummary, toRunView } from './ai-research.view';

/**
 * 심층 조사 API (이슈 #378, 문서에 없는 기능). 로그인한 사원은 누구나 쓰고, 자기 조사만 보고 바꾼다(남의 조사는 없는 것처럼 RES-001).
 * 조사는 일꾼(AiResearchRunner)이 백그라운드로 하고, 화면은 GET runs/:id?afterSeq=로 진행을 받아 간다.
 * ERP 데이터는 쓰지 않는다: 질문과 검색어만 회사 밖(검색 엔진)으로 나가고, 검색어는 웹 검색과 같은 회사 안 정보 막기를 거친다.
 */
@Injectable()
export class AiResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiResearchRepository,
    private readonly llmSettings: LlmSettingsStore,
    private readonly runner: AiResearchRunner,
  ) {}

  async capabilities(): Promise<AiResearchCapabilities> {
    return { available: Boolean((await this.llmSettings.read()).model) };
  }

  async create(user: AuthUser, dto: CreateAiResearchRunDto): Promise<AiResearchRunView> {
    if (!(await this.llmSettings.read()).model) throw new AppException('RES-005');
    const run = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockEmployee(tx, user.employeeId);
      if ((await this.repository.countActive(tx, user.employeeId)) >= AI_RESEARCH_LIMITS.activeRunsPerEmployee) throw new AppException('RES-006');
      return this.repository.create(tx, { employeeId: user.employeeId, question: dto.question, budget: { ...defaultBudget() } });
    });
    this.runner.wake();
    return toRunView(run, [], 0);
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

  /** 더 조사하기: 단계를 다 써서 끝났고 모르는 것이 남았을 때 +4단계(모두 20단계까지), 저장된 메모·출처에서 이어서 하고 점검·보고서를 다시 쓴다 */
  async extend(user: AuthUser, id: number): Promise<AiResearchRunView> {
    const view = await this.prisma.$transaction(async (tx) => {
      const run = await this.owned(tx, user, id);
      const budget = readBudget(run.budget);
      if (!canExtend({ status: run.status as AiResearchStatus, stepsUsed: run.stepsUsed, budget, state: run.researchState === null ? null : storedState(run.researchState) }))
        throw new AppException('RES-002', '단계를 다 써서 끝났고 아직 모르는 것이 남은 조사만 더 조사할 수 있어요 (모두 20단계까지)');
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

  private async owned(tx: Tx, user: AuthUser, id: number): Promise<AiResearchRun> {
    const run = await this.repository.findById(tx, id);
    if (!run || run.employeeId !== user.employeeId) throw new AppException('RES-001');
    return run;
  }

  private async view(tx: Tx, run: AiResearchRun, afterSeq = 0): Promise<AiResearchRunView> {
    const [events, lastSeq] = await Promise.all([this.repository.eventsAfter(tx, run.id, afterSeq), this.repository.lastSeq(tx, run.id)]);
    return toRunView(run, events, lastSeq);
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
