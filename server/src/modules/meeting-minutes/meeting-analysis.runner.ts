import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MEETING_MINUTES_STATUS, ROLE_LABEL, type MeetingAnalysis, type MeetingAnalysisProgress, type MeetingCandidate, type MeetingReviewResult, type MeetingTraceChange, type MeetingTraceStage, type MeetingTraceStep, type Role } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { LlmClient, LlmJsonParseError, LlmRequestError, type LlmJsonReply } from '../llm/llm.client';
import { llmEndpointOf, LlmSettingsStore } from '../llm/llm-settings.store';
import { LLM_PROFILE } from '../llm/llm-profiles';
import { candidateLimit, joinSummaries, lineText, mergeChunkResults, restrictToChunk, splitTranscript, type TranscriptChunk } from './meeting-analysis.chunks';
import {
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
  buildReviewUserMessage,
  buildSummaryMergeMessage,
  REVIEW_JSON_SCHEMA,
  REVIEW_SYSTEM_PROMPT,
  speakerLabelOf,
  SUMMARY_MERGE_JSON_SCHEMA,
  SUMMARY_MERGE_SYSTEM_PROMPT,
  type AnalysisPromptInput,
  type ReviewCandidateLine,
} from './meeting-analysis.prompt';
import { collectSalesOrderNos, isObject, SUMMARY_MAX, text, validateAnalysis, type AnalysisContext, type ValidatedAnalysis } from './meeting-analysis.validator';
import { MeetingCandidateContextService } from './meeting-candidate.context';
import { MeetingJobLease } from './meeting-job.lease';
import { mergeReview, REVIEW_BAD_SHAPE, reviewItemsOf } from './meeting-review';
import { readSegments } from './meeting-minutes.json';
import { MeetingMinutesRepository } from './meeting-minutes.repository';

export const ANALYSIS_INTERRUPTED_REASON = '분석하던 서버가 멈춰 분석이 중단됐어요. 다시 정리해 주세요';
const ANALYSIS_ERROR_REASON = 'AI 정리 중 오류가 났어요. 다시 정리해 주세요';
const NO_MODEL_REASON = '사용할 AI 모델이 정해지지 않았어요. AI 연결 설정에서 모델을 골라 주세요';
const BAD_SHAPE_REASON = 'AI 응답 형식이 올바르지 않아요';
/**
 * 로컬 모델이 긴 전사를 읽고 쓰는 시간을 넉넉히 준다. 🟡 2026-10-21 실측: 2만 자 조각 하나가 LM Studio를 다른 작업과 나눠 쓰면 5분을 넘겨 10분으로 늘렸다
 */
const ANALYSIS_TIMEOUT_MS = 10 * 60_000;
/**
 * 🟡 분석 한 건 전체의 시간 상한(분). 분석은 줄을 서서 하나씩 돌므로 20만 자 전사(호출 약 19번)가 다른 회의 분석을 몇 시간씩 막지 않게 한다.
 * 넘으면 1차 분석 중이면 실패, 2차 검토 중이면 남은 조각 검토를 건너뛰고 그때까지 결과로 마친다. 환경 변수 MEETING_ANALYSIS_MAX_MINUTES(10~600)
 */
const DEFAULT_ANALYSIS_MAX_MINUTES = 120;
/** 상한이 가까워도 호출 한 번에는 이만큼은 준다 */
const MIN_CALL_TIMEOUT_MS = 60_000;

export function analysisMaxMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const text = env.MEETING_ANALYSIS_MAX_MINUTES?.trim();
  if (!text || !/^\d+$/.test(text)) return DEFAULT_ANALYSIS_MAX_MINUTES;
  return Math.min(Math.max(Number(text), 10), 600);
}

/** 분석 한 건의 끝 시각 */
interface Deadline {
  at: number;
  minutes: number;
}

const passed = (deadline: Deadline) => Date.now() >= deadline.at;
/** 호출 한 번의 제한 시간: 평소 값과 남은 시간 중 짧은 쪽 */
const callTimeout = (deadline: Deadline) => Math.max(MIN_CALL_TIMEOUT_MS, Math.min(ANALYSIS_TIMEOUT_MS, deadline.at - Date.now()));
const timeLimitReason = (deadline: Deadline, what: string) => `AI 정리가 ${deadline.minutes}분을 넘어 ${what}`;
const ANALYSIS_MAX_TOKENS = 8000;
const REVIEW_ERROR_REASON = 'AI 2차 검토 중 오류가 났어요';
const SUMMARY_MERGE_ERROR_REASON = '조각 요약을 합치지 못해 차례로 이어 붙였어요';
const SUMMARY_MERGE_MAX_TOKENS = 4000;
/** 실행 기록에 남기는 원문·생각 글의 단계당 상한. 회의록 한 행의 JSON이 지나치게 커지지 않게 한다 */
export const TRACE_TEXT_MAX = 20_000;

export interface AnalysisJob {
  meetingMinutesId: number;
}

/**
 * 회의 전사를 백그라운드로 AI 분석한다 (REQ-VOC-003, BP-VOC-01). 작업은 한 번에 하나씩 돈다(로컬 LLM 하나를 겹쳐 부르지 않는다).
 * 긴 전사는 조각으로 나눠 조각마다 1차 분석 → 합치기 → 조각마다 2차 검토를 하고, 진행 상황(몇 번째 조각)을 analysis_progress에 남긴다.
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
        analysisProgress: Prisma.DbNull,
        failureReason: null,
      });
    } catch (error) {
      // 전사·모델 응답 내용은 로그에 남기지 않는다
      this.logger.error(`회의록 ${job.meetingMinutesId} 분석 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof LlmRequestError ? error.message : ANALYSIS_ERROR_REASON;
      await this.finish(job.meetingMinutesId, { meetingMinutesStatus: MEETING_MINUTES_STATUS.FAILED, analysisProgress: Prisma.DbNull, failureReason: reason }).catch((e: unknown) =>
        this.logger.error(`회의록 ${job.meetingMinutesId} 실패 상태를 저장하지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`),
      );
    }
  }

  private async analyze(id: number): Promise<MeetingAnalysis> {
    const row = await this.repository.findDetail(this.prisma, id);
    if (!row || row.transcript === null) throw new LlmRequestError('분석할 회의 기록이 없어요');
    const settings = await this.llmSettings.read();
    if (!settings.model) throw new LlmRequestError(NO_MODEL_REASON, undefined, 'NO_MODEL');
    const model = settings.model;

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
    // 긴 전사는 조각으로 나눠 조각마다 1차 분석·2차 검토를 한다. 번호는 회의 전체 기준이라 근거가 원문 위치를 그대로 가리킨다
    const chunks = splitTranscript(transcriptSegments.map((segment, index) => ({ number: index + 1, speaker: speakerLabelOf(segment) ?? undefined, text: segment.text })));
    const promptOf = (chunk: TranscriptChunk): AnalysisPromptInput => ({
      meetingDate,
      attendees,
      segments: chunk.lines.map(lineText),
      numbers: chunk.lines.map((line) => line.number),
      part: chunk.total > 1 ? { index: chunk.index, total: chunk.total } : null,
    });
    const started = Date.now();
    const deadline: Deadline = { at: started + analysisMaxMinutes() * 60_000, minutes: analysisMaxMinutes() };

    const rawMaterials = await this.repository.findRawMaterials(this.prisma);
    const ctx: Omit<AnalysisContext, 'salesOrders'> = {
      meetingDate,
      segments,
      attendees,
      rawMaterials: rawMaterials.map((i) => ({ itemId: i.id, itemName: i.itemName, itemCode: i.itemCode })),
    };

    const steps: MeetingTraceStep[] = [];
    const parts: ValidatedAnalysis[] = [];
    for (const chunk of chunks) {
      // 1차 분석이 끝나지 않으면 빠지는 부분이 생기므로 남은 조각을 건너뛰지 않고 실패로 둔다
      if (passed(deadline)) throw new LlmRequestError(timeLimitReason(deadline, `${chunkLabel(chunk)} 분석 전에 멈췄어요. 다시 정리해 주세요`));
      await this.progress(id, { phase: 'ANALYSIS', current: chunk.index, total: chunk.total });
      const chunkStarted = Date.now();
      let reply: LlmJsonReply;
      try {
        reply = await this.llmClient.chatJsonWithText(
          endpoint,
          model,
          [
            { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: buildAnalysisUserMessage(promptOf(chunk)) },
          ],
          ANALYSIS_JSON_SCHEMA,
          { timeoutMs: callTimeout(deadline), maxTokens: ANALYSIS_MAX_TOKENS, profile: LLM_PROFILE.MEETING_ANALYSIS },
        );
      } catch (error) {
        // 한 조각이라도 1차 분석을 못 하면 그 부분의 후보가 통째로 빠지므로 분석 전체를 실패로 둔다
        if (chunk.total > 1 && error instanceof LlmRequestError) throw new LlmRequestError(`${chunkLabel(chunk)} 분석 실패: ${error.message}`, error.status, error.kind);
        throw error;
      }
      // 조각 밖 번호를 근거로 대면 지어낸 것이다
      const raw = chunk.total > 1 ? restrictToChunk(reply.value, chunk.numbers) : reply.value;
      const validated = validateAnalysis(raw, { ...ctx, salesOrders: await this.salesOrdersIn(raw) });
      if (!validated) throw new LlmRequestError(chunk.total > 1 ? `${chunkLabel(chunk)}: ${BAD_SHAPE_REASON}` : BAD_SHAPE_REASON);
      parts.push(validated);
      steps.push(traceStep('ANALYSIS', model, Date.now() - chunkStarted, reply, null, validated.changes, chunkOf(chunk)));
    }

    let first: Pick<ValidatedAnalysis, 'summary' | 'decisions' | 'candidates'>;
    if (parts.length === 1) {
      first = parts[0];
    } else {
      await this.progress(id, { phase: 'MERGE', current: 1, total: 1 });
      const merged = mergeChunkResults(parts, candidateLimit(chunks.length));
      const summary = await this.mergeSummaries(endpoint, model, meetingDate, merged.summaries, merged.changes, deadline);
      steps.push(summary.step);
      first = { summary: summary.summary, decisions: merged.decisions, candidates: merged.candidates };
    }

    // 2차 검토는 덤이다: 실패해도 1차 결과를 그대로 낸다
    const reviewed = await this.reviewChunks(id, endpoint, model, chunks, promptOf, first.candidates, ctx, deadline);
    steps.push(...reviewed.steps);
    const candidates = await this.withContext(reviewed.candidates);
    return {
      summary: first.summary,
      decisions: first.decisions,
      candidates,
      review: reviewed.review,
      trace: { steps, totalMs: Date.now() - started },
      model,
      analyzedAt: new Date().toISOString(),
    };
  }

  /** 진행 상황은 덤이다: 저장에 실패해도 분석은 이어 간다 */
  private async progress(id: number, progress: MeetingAnalysisProgress): Promise<void> {
    await this.repository.setAnalysisProgress(this.prisma, id, { ...progress }).catch((e: unknown) => this.logger.warn(`회의록 ${id} 진행 상황을 남기지 못했어요: ${e instanceof Error ? e.name : 'unknown'}`));
  }

  private async salesOrdersIn(raw: unknown): Promise<Map<string, number>> {
    const orderNos = collectSalesOrderNos(raw);
    const orders = orderNos.length > 0 ? await this.repository.findSalesOrdersByNo(this.prisma, orderNos) : [];
    return new Map(orders.map((o) => [o.salesOrderNo, o.id]));
  }

  /** 조각 요약을 모델로 하나로 합친다. 실패하면 조각 요약을 차례로 이어 쓴다 (분석은 실패하지 않는다) */
  private async mergeSummaries(
    endpoint: { baseUrl: string; apiKey: string | null },
    model: string,
    meetingDate: string,
    summaries: string[],
    changes: MeetingTraceChange[],
    deadline: Deadline,
  ): Promise<{ summary: string; step: MeetingTraceStep }> {
    const started = Date.now();
    const fallback = joinSummaries(summaries, SUMMARY_MAX);
    if (summaries.length <= 1) return { summary: fallback, step: traceStep('MERGE', model, 0, null, null, changes) };
    if (passed(deadline)) return { summary: fallback, step: traceStep('MERGE', model, 0, null, timeLimitReason(deadline, '요약은 조각 요약을 이어 붙였어요'), changes) };
    try {
      const reply = await this.llmClient.chatJsonWithText(
        endpoint,
        model,
        [
          { role: 'system', content: SUMMARY_MERGE_SYSTEM_PROMPT },
          { role: 'user', content: buildSummaryMergeMessage({ meetingDate, summaries }) },
        ],
        SUMMARY_MERGE_JSON_SCHEMA,
        { timeoutMs: callTimeout(deadline), maxTokens: SUMMARY_MERGE_MAX_TOKENS, profile: LLM_PROFILE.MEETING_ANALYSIS },
      );
      const summary = isObject(reply.value) ? text(reply.value.summary, SUMMARY_MAX) : null;
      if (summary === null) return { summary: fallback, step: traceStep('MERGE', model, Date.now() - started, reply, SUMMARY_MERGE_ERROR_REASON, changes) };
      return { summary, step: traceStep('MERGE', model, Date.now() - started, reply, null, changes) };
    } catch (error) {
      this.logger.warn(`요약 합치기 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof LlmRequestError ? error.message : SUMMARY_MERGE_ERROR_REASON;
      const reply = error instanceof LlmJsonParseError ? { rawText: error.rawText, thinking: error.thinking } : null;
      return { summary: fallback, step: traceStep('MERGE', model, Date.now() - started, reply, reason, changes) };
    }
  }

  /**
   * 조각마다 2차 검토를 하고 차례로 합친다. 조각에는 그 조각의 발언을 근거로 한 후보만 보여 준다.
   * 모든 조각이 실패해야 review.ok=false이고, 일부만 실패하면 실패한 조각 수를 남긴다
   */
  private async reviewChunks(
    id: number,
    endpoint: { baseUrl: string; apiKey: string | null },
    model: string,
    chunks: TranscriptChunk[],
    promptOf: (chunk: TranscriptChunk) => AnalysisPromptInput,
    first: MeetingCandidate[],
    ctx: Omit<AnalysisContext, 'salesOrders'>,
    deadline: Deadline,
  ): Promise<{ candidates: MeetingCandidate[]; review: MeetingReviewResult; steps: MeetingTraceStep[] }> {
    let candidates = first;
    const steps: MeetingTraceStep[] = [];
    let missedCount = 0;
    let concernCount = 0;
    let firstError: string | null = null;
    let failed = 0;
    for (const chunk of chunks) {
      // 2차 검토는 덤이라 시간이 다 되면 남은 조각을 건너뛰고 그때까지 결과로 마친다
      if (passed(deadline)) {
        const reason = timeLimitReason(deadline, '이 조각의 2차 검토를 건너뛰었어요');
        steps.push(traceStep('REVIEW', model, 0, null, reason, [], chunkOf(chunk)));
        failed += 1;
        firstError ??= reason;
        continue;
      }
      await this.progress(id, { phase: 'REVIEW', current: chunk.index, total: chunk.total });
      const shown = chunk.total > 1 ? candidates.filter((c) => c.evidence.some((index) => chunk.numbers.has(index + 1))) : candidates;
      const result = await this.review(endpoint, model, promptOf(chunk), candidates, shown, ctx, chunk, deadline);
      candidates = result.candidates;
      steps.push(result.step);
      if (result.review.ok) {
        missedCount += result.review.missedCount;
        concernCount += result.review.concernCount;
      } else {
        failed += 1;
        firstError ??= result.review.error;
      }
    }
    if (failed === chunks.length) return { candidates, review: { ok: false, error: firstError ?? REVIEW_ERROR_REASON }, steps };
    return { candidates, review: { ok: true, missedCount, concernCount, ...(failed > 0 ? { failedChunks: failed } : {}) }, steps };
  }

  /** 두 번째 LLM 호출: 1차 후보와 전사를 다시 맞춰 빠진 것·의심스러운 것을 찾는다. 어떤 실패도 던지지 않고 review.ok=false로 남긴다 */
  private async review(
    endpoint: { baseUrl: string; apiKey: string | null },
    model: string,
    promptInput: AnalysisPromptInput,
    all: MeetingCandidate[],
    shown: MeetingCandidate[],
    ctx: Omit<AnalysisContext, 'salesOrders'>,
    chunk: TranscriptChunk,
    deadline: Deadline,
  ): Promise<{ candidates: MeetingCandidate[]; review: MeetingReviewResult; step: MeetingTraceStep }> {
    const started = Date.now();
    try {
      const reply = await this.llmClient.chatJsonWithText(
        endpoint,
        model,
        [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildReviewUserMessage({ ...promptInput, candidates: shown.map(reviewLine) }) },
        ],
        REVIEW_JSON_SCHEMA,
        { timeoutMs: callTimeout(deadline), maxTokens: ANALYSIS_MAX_TOKENS, profile: LLM_PROFILE.MEETING_REVIEW },
      );
      const durationMs = Date.now() - started;
      const raw = chunk.total > 1 ? restrictToChunk(reply.value, chunk.numbers, ['missed']) : reply.value;
      const merged = mergeReview(all, raw, { ...ctx, salesOrders: await this.salesOrdersIn(reviewItemsOf(raw)) }, { shownKeys: new Set(shown.map((c) => c.key)), limit: candidateLimit(chunk.total) });
      const error = merged.review.ok ? null : REVIEW_BAD_SHAPE;
      return { candidates: merged.candidates, review: merged.review, step: traceStep('REVIEW', model, durationMs, reply, error, merged.changes, chunkOf(chunk)) };
    } catch (error) {
      this.logger.warn(`2차 검토 실패: ${error instanceof LlmRequestError ? error.message : error instanceof Error ? error.name : 'unknown'}`);
      const reason = error instanceof LlmRequestError ? error.message : REVIEW_ERROR_REASON;
      // JSON으로 읽지 못한 답도 무엇을 냈는지 볼 수 있게 원문을 남긴다
      const reply = error instanceof LlmJsonParseError ? { rawText: error.rawText, thinking: error.thinking } : null;
      return { candidates: all, review: { ok: false, error: reason }, step: traceStep('REVIEW', model, Date.now() - started, reply, reason, [], chunkOf(chunk)) };
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
  chunk?: MeetingTraceStep['chunk'],
): MeetingTraceStep {
  const raw = clip(reply?.rawText ?? null);
  const thinking = clip(reply?.thinking ?? null);
  return { stage, ...(chunk ? { chunk } : {}), model, durationMs, ok: error === null, error, rawAnswer: raw.text, thinking: thinking.text, truncated: raw.cut || thinking.cut, changes };
}

/** 실행 기록의 조각 표시. 나누지 않은 분석에는 붙이지 않는다 */
const chunkOf = (chunk: TranscriptChunk): MeetingTraceStep['chunk'] =>
  chunk.total > 1 ? { index: chunk.index, total: chunk.total, firstSegment: chunk.firstNumber, lastSegment: chunk.lastNumber } : undefined;

const chunkLabel = (chunk: TranscriptChunk) => `${chunk.total}개 조각 중 ${chunk.index}번째(발언 ${chunk.firstNumber}~${chunk.lastNumber})`;

const reviewLine = (c: MeetingCandidate): ReviewCandidateLine => ({
  key: c.key,
  kind: c.kind,
  title: c.title,
  assigneeName: c.assigneeName,
  when: c.dueDate ?? c.startAt ?? c.purchase?.desiredReceiptDate ?? null,
  evidence: c.evidence.map((i) => i + 1),
});
