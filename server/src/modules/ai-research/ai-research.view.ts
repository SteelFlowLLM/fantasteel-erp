import { AI_RESEARCH_LIMITS, AI_RESEARCH_STATUS, type AiResearchEventView, type AiResearchReportVersionSummary, type AiResearchReportVersionView, type AiResearchRunSummaryView, type AiResearchRunView, type AiResearchStatus } from '@fantasteel/shared';
import type { AiResearchEvent, AiResearchReportVersion, AiResearchRun } from '../../generated/prisma/client';
import type { listAiResearchRuns } from '../../generated/prisma/sql';
import { storedCharts } from './ai-research.charts';
import { canExtend, isInternalSource, readBudget, storedAudit, storedPlan, storedSeed, storedSources, storedState } from './ai-research.rules';

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

type VersionRow = Pick<AiResearchReportVersion, 'version' | 'instruction' | 'search' | 'createdAt'>;

const toVersionSummary = (row: VersionRow): AiResearchReportVersionSummary => ({ version: row.version, instruction: row.instruction, search: row.search, createdAt: row.createdAt.toISOString() });

export function toVersionView(row: AiResearchReportVersion): AiResearchReportVersionView {
  return { ...toVersionSummary(row), report: row.report, charts: storedCharts(row.charts) };
}

/** 판이 상한 아래인지 (보고서 고치기·판이 생긴 뒤의 더 조사하기는 판을 하나 더 남긴다) */
export const hasVersionRoom = (versionCount: number): boolean => versionCount < AI_RESEARCH_LIMITS.maxReportVersions;

/** 출처 본문(readText)은 크고 웹에서 온 글이라 보내지 않고 읽었는지만 알린다. versions는 보고서 판(본문 없이) */
export function toRunView(row: AiResearchRun, events: AiResearchEvent[], lastSeq: number, versions: VersionRow[] = []): AiResearchRunView {
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
    // 우리 ERP 조회·사내 지식 출처는 웹 출처 수에 세지 않는다 (이슈 #435·#484)
    sourceCount: sources.filter((s) => !isInternalSource(s)).length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    seed: storedSeed(row.seed),
    plan,
    planRevision: row.planRevision,
    budget,
    researchState: state ? { summary: state.summary, gaps: state.gaps, unsupportedClaims: state.unsupportedClaims } : null,
    searchedQueries: state?.searchedQueries ?? [],
    sources: sources.map((s) => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet, read: s.readText !== undefined })),
    audit: audit ? { thesis: audit.thesis, outline: audit.outline, supportedClaims: audit.supportedClaims, contradictions: audit.contradictions, missingDimensions: audit.missingDimensions, designInferences: audit.designInferences, unsupportedPrecision: audit.unsupportedPrecision } : null,
    report: row.report,
    reportTruncated: audit?.reportTruncated ?? false,
    incompleteReason: audit?.incompleteReason ?? null,
    failureReason: row.failureReason,
    canExtend: canExtend({ status, stepsUsed: row.stepsUsed, budget, state }) && (versions.length === 0 || hasVersionRoom(versions.length)),
    charts: storedCharts(row.charts),
    notionPageUrl: row.notionPageUrl,
    versions: versions.map(toVersionSummary),
    // 일꾼이 고치는 중일 때만 (취소·실패로 끝났으면 남은 부탁을 보이지 않는다)
    pendingRevision: state?.revision && (status === AI_RESEARCH_STATUS.QUEUED || status === AI_RESEARCH_STATUS.RUNNING) ? { version: state.revision.version, instruction: state.revision.instruction, search: state.revision.search } : null,
    canRevise: status === AI_RESEARCH_STATUS.COMPLETED && Boolean(row.report) && hasVersionRoom(versions.length),
    events: events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: e.createdAt.toISOString() }) as AiResearchEventView),
    lastSeq,
  };
}
