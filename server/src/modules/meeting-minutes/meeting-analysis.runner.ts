import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MEETING_MINUTES_STATUS, ROLE_LABEL, type MeetingAnalysis, type MeetingCandidate, type MeetingReviewResult, type MeetingTraceChange, type MeetingTraceStage, type MeetingTraceStep, type Role } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { LlmClient, LlmJsonParseError, LlmRequestError, type LlmJsonReply } from '../llm/llm.client';
import { llmEndpointOf, LlmSettingsStore } from '../llm/llm-settings.store';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserMessage, buildReviewUserMessage, REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT, segmentPromptText, type ReviewCandidateLine } from './meeting-analysis.prompt';
import { collectSalesOrderNos, validateAnalysis, type AnalysisContext } from './meeting-analysis.validator';
import { MeetingCandidateContextService } from './meeting-candidate.context';
import { MeetingJobLease } from './meeting-job.lease';
import { mergeReview, REVIEW_BAD_SHAPE, reviewItemsOf } from './meeting-review';
import { readSegments } from './meeting-minutes.json';
import { MeetingMinutesRepository } from './meeting-minutes.repository';

export const ANALYSIS_INTERRUPTED_REASON = '분석하던 서버가 멈춰 분석이 중단됐어요. 다시 정리해 주세요';
const ANALYSIS_ERROR_REASON = 'AI 정리 중 오류가 났어요. 다시 정리해 주세요';
const NO_MODEL_REASON = '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요';
const BAD_SHAPE_REASON = 'AI 응답 형식이 올바르지 않아요';
/** 로컬 모델이 긴 전사를 읽고 쓰는 시간을 넉넉히 준다 */
const ANALYSIS_TIMEOUT_MS = 5 * 60_000;
const ANALYSIS_MAX_TOKENS = 8000;
const REVIEW_ERROR_REASON = 'AI 2차 검토 중 오류가 났어요';
/** 실행 기록에 남기는 원문·생각 글의 단계당 상한. 회의록 한 행의 JSON이 지나치게 커지지 않게 한다 */
export const TRACE_TEXT_MAX = 20_000;

export interface AnalysisJob {
  meetingMinutesId: number;
}

/**
 * 회의 전사를 백그라운드로 AI 분석한다 (REQ-VOC-003, BP-VOC-01). 작업은 한 번에 하나씩 돈다(로컬 LLM 하나를 겹쳐 부르지 않는다).
 * 모델은 후보를 제안만 하고 DB에 쓰지 않는다: 결과는 서버 검증(validateAnalysis)을 통과한 값만 analysis_result에 담긴다.
 * 서버가 꺼지면 진행 중이던 분석은 사라지므로, 맡은 서버의 표시가 끊긴 ANALYZING 행을 켤 때와 주기적으로 실패로 돌린다 (MeetingJobLease).
 */
@Injectable()
export class MeetingAnalysisRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MeetingAnalysisRunner.name);
  private tail: Promise<void> = Promise.resolve();
  private readonly lease: MeetingJobLease;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly llmClient: LlmClient,
    private readonly llmSettings: LlmSettingsStore,
    private readonly contexts: MeetingCandidateContextService,
  ) {
    this.lease = new MeetingJobLease(prisma, repository, MEETING_MINUTES_STATUS.ANALYZING, ANALYSIS_INTERRUPTED_REASON, this.logger, '분석');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();
    this.lease.start();
  }

  onModuleDestroy(): void {
    this.lease.stop();
  }

  /** 맡은 서버가 멈춘 분석 행을 실패로 (테스트에서 시각을 넘겨 부른다) */
  recoverInterrupted(now?: Date): Promise<number> {
    return this.lease.recoverStale(now);
  }

  /** 줄 세우고 돌려준다. 돌려주는 약속은 이 작업이 끝나면 풀리고 절대 거절되지 않는다 */
  enqueue(job: AnalysisJob): Promise<void> {
    this.lease.hold(job.meetingMinutesId);
    const run = this.tail.then(() => this.run(job));
    this.tail = run;
    return run;
  }

  /** 줄 선 작업이 모두 끝날 때까지 (테스트용) */
  drain(): Promise<void> {
    return this.tail;
  }

  private async run(job: AnalysisJob): Promise<void> {
    try {
      await this.analyzeAndFinish(job);
    } finally {
      this.lease.release(job.meetingMinutesId);
    }
  }

  private async analyzeAndFinish(job: AnalysisJob): Promise<void> {
    try {
      const analysis = await this.analyze(job.meetingMinutesId);
      await this.finish(job.meetingMinutesId, {
        meetingMinutesStatus: MEETING_MINUTES_STATUS.REVIEW,
        summary: analysis.summary,
        analysisResult: analysis as unknown as Prisma.InputJsonObject,
        failureReason: null,
      });
    } catch (error) {
      // 전사·모델 응답 내용은 로그에 남기지 않는다
      this.logger.error(`회의록 ${job.meetingMinutesId} 분석 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof LlmRequestError ? error.message : ANALYSIS_ERROR_REASON;
      await this.finish(job.meetingMinutesId, { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, failureReason: reason }).catch((e: unknown) =>
        this.logger.error(`회의록 ${job.meetingMinutesId} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`),
      );
    }
  }

  private async analyze(id: number): Promise<MeetingAnalysis> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row || row.transcript === null) throw new LlmRequestError('분석할 회의 기록이 없어요');
    const settings = await this.llmSettings.read();
    if (!settings.model) throw new LlmRequestError(NO_MODEL_REASON, undefined, 'NO_MODEL');

    const transcriptSegments = readSegments(row.transcriptSegments);
    const segments = transcriptSegments.map((s) => s.text);
    const meetingDate = row.meetingDate.toISOString().slice(0, 10);
    const attendees = row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.employeeName,
      departmentName: a.employee.department.departmentName,
      roleLabel: ROLE_LABEL[a.employee.role.roleCode as Role] ?? a.employee.role.roleCode,
    }));
    const endpoint = llmEndpointOf(settings);
    const promptInput = { meetingDate, attendees, segments: transcriptSegments.map(segmentPromptText) };
    const options = { timeoutMs: ANALYSIS_TIMEOUT_MS, maxTokens: ANALYSIS_MAX_TOKENS, profile: LLM_PROFILE.MEETING_ANALYSIS };
    const started = Date.now();
    const reply = await this.llmClient.chatJsonWithText(
      endpoint,
      settings.model,
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildAnalysisUserMessage(promptInput) },
      ],
      ANALYSIS_JSON_SCHEMA,
      options,
    );
    const firstMs = Date.now() - started;
    const raw = reply.value;

    const rawMaterials = await this.repository.findRawMaterials(this.prisma);
    const ctx: Omit<AnalysisContext, 'salesOrders'> = {
      meetingDate,
      segments,
      attendees,
      rawMaterials: rawMaterials.map((i) => ({ itemId: i.id, itemName: i.itemName, itemCode: i.itemCode })),
    };
    const validated = validateAnalysis(raw, { ...ctx, salesOrders: await this.salesOrdersIn(raw) });
    if (!validated) throw new LlmRequestError(BAD_SHAPE_REASON);

    // 2차 검토는 덤이다: 실패해도 1차 결과를 그대로 낸다
    const reviewed = await this.review(endpoint, settings.model, promptInput, validated.candidates, ctx);
    const candidates = await this.withContext(reviewed.candidates);
    const steps = [traceStep('ANALYSIS', settings.model, firstMs, reply, null, validated.changes), reviewed.step];
    return {
      summary: validated.summary,
      decisions: validated.decisions,
      candidates,
      review: reviewed.review,
      trace: { steps, totalMs: Date.now() - started },
      model: settings.model,
      analyzedAt: new Date().toISOString(),
    };
  }

  private async salesOrdersIn(raw: unknown): Promise<Map<string, number>> {
    const orderNos = collectSalesOrderNos(raw);
    const orders = orderNos.length > 0 ? await this.repository.findSalesOrdersByNo(this.prisma, orderNos) : [];
    return new Map(orders.map((o) => [o.salesOrderNo, o.id]));
  }

  /** 두 번째 LLM 호출: 1차 후보와 전사를 다시 맞춰 빠진 것·의심스러운 것을 찾는다. 어떤 실패도 던지지 않고 review.ok=false로 남긴다 */
  private async review(
    endpoint: { baseUrl: string; apiKey: string | null },
    model: string,
    promptInput: Parameters<typeof buildAnalysisUserMessage>[0],
    first: MeetingCandidate[],
    ctx: Omit<AnalysisContext, 'salesOrders'>,
  ): Promise<{ candidates: MeetingCandidate[]; review: MeetingReviewResult; step: MeetingTraceStep }> {
    const started = Date.now();
    try {
      const reply = await this.llmClient.chatJsonWithText(
        endpoint,
        model,
        [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildReviewUserMessage({ ...promptInput, candidates: first.map(reviewLine) }) },
        ],
        REVIEW_JSON_SCHEMA,
        { timeoutMs: ANALYSIS_TIMEOUT_MS, maxTokens: ANALYSIS_MAX_TOKENS, profile: LLM_PROFILE.MEETING_REVIEW },
      );
      const durationMs = Date.now() - started;
      const merged = mergeReview(first, reply.value, { ...ctx, salesOrders: await this.salesOrdersIn(reviewItemsOf(reply.value)) });
      const error = merged.review.ok ? null : REVIEW_BAD_SHAPE;
      return { candidates: merged.candidates, review: merged.review, step: traceStep('REVIEW', model, durationMs, reply, error, merged.changes) };
    } catch (error) {
      this.logger.warn(`2차 검토 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof LlmRequestError ? error.message : REVIEW_ERROR_REASON;
      // JSON으로 읽지 못한 답도 무엇을 냈는지 볼 수 있게 원문을 남긴다
      const reply = error instanceof LlmJsonParseError ? { rawText: error.rawText, thinking: error.thinking } : null;
      return { candidates: first, review: { ok: false, error: reason }, step: traceStep('REVIEW', model, Date.now() - started, reply, reason, []) };
    }
  }

  /** ERP 현황은 덤이다: 읽기에 실패해도 후보는 현황 없이 낸다 */
  private async withContext(candidates: MeetingCandidate[]): Promise<MeetingCandidate[]> {
    try {
      return await this.contexts.applyAll(this.prisma, candidates);
    } catch (error) {
      this.logger.warn(`후보 현황 계산 실패: ${error instanceof Error ? error.name : 'unknown'}`);
      return candidates;
    }
  }

  private async finish(id: number, data: Prisma.MeetingMinutesUncheckedUpdateManyInput): Promise<void> {
    const { count } = await this.repository.finishAnalysis(this.prisma, id, data);
    if (count === 0) this.logger.warn(`회의록 ${id}는 더 이상 분석 중이 아니라 결과를 버렸어요`);
  }
}

function clip(value: string | null): { text: string | null; cut: boolean } {
  if (value === null || value === '') return { text: null, cut: false };
  return value.length > TRACE_TEXT_MAX ? { text: value.slice(0, TRACE_TEXT_MAX), cut: true } : { text: value, cut: false };
}

/** 한 단계의 실행 기록. 원문·생각 글은 길면 잘라 둔다 */
function traceStep(
  stage: MeetingTraceStage,
  model: string,
  durationMs: number,
  reply: Pick<LlmJsonReply, 'rawText' | 'thinking'> | null,
  error: string | null,
  changes: MeetingTraceChange[],
): MeetingTraceStep {
  const raw = clip(reply?.rawText ?? null);
  const thinking = clip(reply?.thinking ?? null);
  return { stage, model, durationMs, ok: error === null, error, rawAnswer: raw.text, thinking: thinking.text, truncated: raw.cut || thinking.cut, changes };
}

const reviewLine = (c: MeetingCandidate): ReviewCandidateLine => ({
  key: c.key,
  kind: c.kind,
  title: c.title,
  assigneeName: c.assigneeName,
  when: c.dueDate ?? c.startAt ?? c.purchase?.desiredReceiptDate ?? null,
  evidence: c.evidence.map((i) => i + 1),
});
