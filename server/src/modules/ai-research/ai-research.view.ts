import type { AiResearchEventView, AiResearchRunSummaryView, AiResearchRunView, AiResearchStatus } from '@fantasteel/shared';
import type { AiResearchEvent, AiResearchRun } from '../../generated/prisma/client';
import type { listAiResearchRuns } from '../../generated/prisma/sql';
import { canExtend, readBudget, storedAudit, storedPlan, storedSources, storedState } from './ai-research.rules';

export function toRunSummary(row: listAiResearchRuns.Result): AiResearchRunSummaryView {
  return {
    id: row.id,
    question: row.question,
    title: row.title,
    status: row.status as AiResearchStatus,
    stepsUsed: row.steps_used,
    maxSteps: row.max_steps ?? 0,
    sourceCount: row.source_count ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

/** 출처 본문(readText)은 크고 웹에서 온 글이라 보내지 않고 읽었는지만 알린다 */
export function toRunView(row: AiResearchRun, events: AiResearchEvent[], lastSeq: number): AiResearchRunView {
  const status = row.status as AiResearchStatus;
  const plan = storedPlan(row.plan);
  const budget = readBudget(row.budget);
  const state = row.researchState === null ? null : storedState(row.researchState);
  const sources = storedSources(row.sources);
  const audit = storedAudit(row.audit);
  return {
    id: row.id,
    question: row.question,
    title: plan?.title ?? null,
    status,
    stepsUsed: row.stepsUsed,
    maxSteps: budget.maxSteps,
    sourceCount: sources.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    plan,
    planRevision: row.planRevision,
    budget,
    researchState: state ? { summary: state.summary, gaps: state.gaps, unsupportedClaims: state.unsupportedClaims } : null,
    searchedQueries: state?.searchedQueries ?? [],
    sources: sources.map((s) => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet, read: s.readText !== undefined })),
    audit: audit ? { thesis: audit.thesis, outline: audit.outline, supportedClaims: audit.supportedClaims, contradictions: audit.contradictions, missingDimensions: audit.missingDimensions } : null,
    report: row.report,
    reportTruncated: audit?.reportTruncated ?? false,
    incompleteReason: audit?.incompleteReason ?? null,
    failureReason: row.failureReason,
    canExtend: canExtend({ status, stepsUsed: row.stepsUsed, budget, state }),
    events: events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: e.createdAt.toISOString() }) as AiResearchEventView),
    lastSeq,
  };
}
