import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { MEETING_MINUTES_STATUS, ROLE_LABEL, type MeetingAnalysis, type MeetingCandidate, type MeetingReviewResult, type Role } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { LlmClient, LlmRequestError } from '../llm/llm.client';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserMessage, buildReviewUserMessage, REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT, segmentPromptText, type ReviewCandidateLine } from './meeting-analysis.prompt';
import { collectSalesOrderNos, validateAnalysis, type AnalysisContext } from './meeting-analysis.validator';
import { MeetingCandidateContextService } from './meeting-candidate.context';
import { mergeReview, reviewItemsOf } from './meeting-review';
import { readSegments } from './meeting-minutes.json';
import { MeetingMinutesRepository } from './meeting-minutes.repository';

export const ANALYSIS_INTERRUPTED_REASON = '서버가 다시 시작돼 분석이 중단됐어요. 다시 정리해 주세요';
const ANALYSIS_ERROR_REASON = 'AI 정리 중 오류가 났어요. 다시 정리해 주세요';
const NO_MODEL_REASON = '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요';
const BAD_SHAPE_REASON = 'AI 응답 형식이 올바르지 않아요';
/** 로컬 모델이 긴 전사를 읽고 쓰는 시간을 넉넉히 준다 */
const ANALYSIS_TIMEOUT_MS = 5 * 60_000;
const ANALYSIS_MAX_TOKENS = 8000;
const REVIEW_ERROR_REASON = 'AI 2차 검토 중 오류가 났어요';

export interface AnalysisJob {
  meetingMinutesId: number;
}

/**
 * 회의 전사를 백그라운드로 AI 분석한다 (REQ-VOC-003, BP-VOC-01). 작업은 한 번에 하나씩 돈다(로컬 LLM 하나를 겹쳐 부르지 않는다).
 * 모델은 후보를 제안만 하고 DB에 쓰지 않는다: 결과는 서버 검증(validateAnalysis)을 통과한 값만 analysis_result에 담긴다.
 * 서버가 꺼지면 진행 중이던 분석은 사라지므로 시작할 때 남은 ANALYZING 행을 실패로 돌린다.
 */
@Injectable()
export class MeetingAnalysisRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeetingAnalysisRunner.name);
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MeetingMinutesRepository,
    private readonly llmClient: LlmClient,
    private readonly llmSettings: LlmSettingsStore,
    private readonly contexts: MeetingCandidateContextService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();
  }

  async recoverInterrupted(): Promise<number> {
    const { count } = await this.repository.failAllAnalyzing(this.prisma, ANALYSIS_INTERRUPTED_REASON);
    if (count > 0) this.logger.warn(`분석이 중단된 회의록 ${count}건을 실패로 바꿨어요`);
    return count;
  }

  /** 줄 세우고 돌려준다. 돌려주는 약속은 이 작업이 끝나면 풀리고 절대 거절되지 않는다 */
  enqueue(job: AnalysisJob): Promise<void> {
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
    if (!settings.model) throw new LlmRequestError(NO_MODEL_REASON);

    const transcriptSegments = readSegments(row.transcriptSegments);
    const segments = transcriptSegments.map((s) => s.text);
    const meetingDate = row.meetingDate.toISOString().slice(0, 10);
    const attendees = row.attendees.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employee.employeeName,
      departmentName: a.employee.department.departmentName,
      roleLabel: ROLE_LABEL[a.employee.role.roleCode as Role] ?? a.employee.role.roleCode,
    }));
    const endpoint = { baseUrl: settings.baseUrl, apiKey: settings.apiKey };
    const promptInput = { meetingDate, attendees, segments: transcriptSegments.map(segmentPromptText) };
    const options = { timeoutMs: ANALYSIS_TIMEOUT_MS, maxTokens: ANALYSIS_MAX_TOKENS };
    const raw = await this.llmClient.chatJson(
      endpoint,
      settings.model,
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildAnalysisUserMessage(promptInput) },
      ],
      ANALYSIS_JSON_SCHEMA,
      options,
    );

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
    return { ...validated, candidates, review: reviewed.review, model: settings.model, analyzedAt: new Date().toISOString() };
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
  ): Promise<{ candidates: MeetingCandidate[]; review: MeetingReviewResult }> {
    try {
      const raw = await this.llmClient.chatJson(
        endpoint,
        model,
        [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildReviewUserMessage({ ...promptInput, candidates: first.map(reviewLine) }) },
        ],
        REVIEW_JSON_SCHEMA,
        { timeoutMs: ANALYSIS_TIMEOUT_MS, maxTokens: ANALYSIS_MAX_TOKENS },
      );
      return mergeReview(first, raw, { ...ctx, salesOrders: await this.salesOrdersIn(reviewItemsOf(raw)) });
    } catch (error) {
      this.logger.warn(`2차 검토 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      return { candidates: first, review: { ok: false, error: error instanceof LlmRequestError ? error.message : REVIEW_ERROR_REASON } };
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

const reviewLine = (c: MeetingCandidate): ReviewCandidateLine => ({
  key: c.key,
  kind: c.kind,
  title: c.title,
  assigneeName: c.assigneeName,
  when: c.dueDate ?? c.startAt ?? c.purchase?.desiredReceiptDate ?? null,
  evidence: c.evidence.map((i) => i + 1),
});
