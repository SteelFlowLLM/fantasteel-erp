// 철강맨AI 심층 조사 (이슈 #378, 문서에 없는 기능). 서버 docs/backend/ai-research.md
// 상태·이벤트 종류는 공통 코드가 아니라 이 기능 안의 값이다 (DB는 CHECK로 막는다).

export const AI_RESEARCH_STATUS = {
  /** 계획을 만드는 중 */
  PLANNING: 'PLANNING',
  /** 계획을 보고 고치거나 시작하기를 기다림 */
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  /** 시작을 눌러 차례를 기다림 */
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type AiResearchStatus = (typeof AI_RESEARCH_STATUS)[keyof typeof AI_RESEARCH_STATUS];

export const AI_RESEARCH_STATUS_LABEL: Record<AiResearchStatus, string> = {
  PLANNING: '계획 세우는 중',
  AWAITING_APPROVAL: '계획 확인 대기',
  QUEUED: '차례 기다리는 중',
  RUNNING: '조사 중',
  COMPLETED: '완료',
  FAILED: '실패',
  CANCELLED: '취소됨',
};

/** 정해 둔 한도 (가정값) */
export const AI_RESEARCH_LIMITS = {
  questionMin: 2,
  questionMax: 1000,
  /** 계획 단계 수 */
  maxPlanSteps: 6,
  planTitleMax: 100,
  stepTitleMax: 100,
  /** 검색어 길이 (웹 검색과 같다) */
  queryMax: 80,
  /** 서버 기본값 (서버는 환경 변수 AI_RESEARCH_MAX_STEPS·AI_RESEARCH_MAX_SOURCES로 바꿀 수 있다. 실제 값은 조사의 budget) */
  defaultMaxSteps: 12,
  defaultMaxSources: 40,
  /** 단계·출처 상한 (환경 변수·조사별 budget 모두 이 안) */
  maxStepsCap: 30,
  maxSourcesCap: 100,
  /** 더 조사하기 한 번에 늘리는 단계 (모두 min(30, 기본 단계 × 2)까지) */
  extendSteps: 4,
  /** 차트 수·계열 수·점 수 상한 */
  maxCharts: 2,
  maxChartSeries: 4,
  maxChartPoints: 24,
  /** 사원 한 명이 동시에 진행(계획·대기·조사 중)할 수 있는 조사 수 */
  activeRunsPerEmployee: 3,
  /** 철강맨AI에서 먼저 알아본 것(seed): 간단 답 글자 수·출처 수 상한 (이슈 #408) */
  seedAnswerMax: 4000,
  seedSourcesMax: 10,
  seedTitleMax: 300,
  seedUrlMax: 2000,
  /** 계획·보고서를 말로 고치기: 부탁 글자 수 (이슈 #416·#418, 가정값) */
  instructionMax: 500,
  /** 보고서 판 수 상한 (1판 포함, 이슈 #418, 가정값) */
  maxReportVersions: 10,
  /** 보고서 고치기에서 더 검색할 때 늘리는 단계 (모두 maxStepsCap까지) */
  revisionSteps: 4,
  /** 보고서 고치기에서 더 검색할 때 새 출처 자리 (모은 출처 + 이만큼, maxSourcesCap까지) */
  revisionSources: 10,
  /** 사원 한 명의 켜진 반복 조사 수 (이슈 #521, 가정값) */
  maxSchedulesPerEmployee: 5,
} as const;

export interface AiResearchPlanStep {
  title: string;
  /** 웹 검색어 (80자까지, 회사 안 정보 없이) */
  query: string;
}

export interface AiResearchPlan {
  title: string;
  steps: AiResearchPlanStep[];
}

export interface AiResearchBudget {
  maxSteps: number;
  maxSources: number;
}

/** 조사하며 고쳐 쓰는 메모 */
export interface AiResearchState {
  summary: string;
  /** 아직 모르는 것 */
  gaps: string[];
  /** 근거가 아직 없는 주장 */
  unsupportedClaims: string[];
}

/** 모은 출처. 제목·요약은 웹에서 온 글이라 화면은 글로만 그린다(HTML로 넣지 않는다) */
export interface AiResearchSourceView {
  /** 보고서의 [n] */
  id: number;
  title: string;
  url: string;
  snippet: string;
  /** 페이지 본문을 읽었는지 */
  read: boolean;
}

export interface AiResearchSupportedClaim {
  claim: string;
  sourceIds: number[];
}

/** 보고서 전 점검 */
export interface AiResearchAudit {
  thesis: string;
  outline: string[];
  supportedClaims: AiResearchSupportedClaim[];
  contradictions: string[];
  missingDimensions: string[];
  /** 근거에서 끌어낸 설계 가설 (보고서는 '추론'으로 표시하고 확인 방법과 함께 쓴다, 이슈 #384) */
  designInferences?: string[];
  /** 근거 없이 정밀한 수치·임계값 (보고서에 사실처럼 쓰지 않는다) */
  unsupportedPrecision?: string[];
}

export const AI_RESEARCH_EVENT_TYPES = [
  'plan.ready',
  'step.started',
  'search.done',
  'source.added',
  'page.read',
  'state.updated',
  'audit.ready',
  'report.ready',
  'failed',
  'cancelled',
  'budget.exhausted',
  'charts.ready',
  'revision.requested',
  'revision.ready',
  'report.retry',
] as const;
export type AiResearchEventType = (typeof AI_RESEARCH_EVENT_TYPES)[number];

/** 이벤트마다의 짧은 내용. 웹에서 온 글(title)은 화면이 글로만 그린다 */
export interface AiResearchEventPayloads {
  /** copiedFrom: 다시 조사로 계획을 가져온 조사 id (새로 세운 계획이면 없다). scheduled: 반복 차례에 가져온 계획 (이슈 #521) */
  'plan.ready': { title: string; stepCount: number; revision: number; fallback: boolean; copiedFrom?: number; scheduled?: boolean };
  'step.started': { step: number; action: 'search' | 'read'; query: string | null; sourceId: number | null; fallback: boolean };
  'search.done': { query: string; engine: string | null; resultCount: number; added: number; error: string | null };
  'source.added': { sourceId: number; title: string; url: string };
  'page.read': { sourceId: number; title: string; chars: number; error: string | null };
  'state.updated': { summary: string; gapCount: number; unsupportedCount: number };
  /** failure: 점검 LLM이 다시 시도해도 실패해 점검 없이 보고서로 넘어간 까닭 (이슈 #521) */
  'audit.ready': { claimCount: number; contradictionCount: number; missingCount: number; ok: boolean; failure?: AiResearchReportFallbackReason };
  /** fallback: 보고서 LLM 대신 쓴 대체본이면 그 까닭 (이슈 #521) */
  'report.ready': { chars: number; truncated: boolean; citedCount: number; incomplete?: boolean; fallback?: AiResearchReportFallbackReason };
  failed: { reason: string };
  cancelled: Record<string, never>;
  'budget.exhausted': { stepsUsed: number; maxSteps: number; gapCount: number; reason?: string };
  /** 보고서 뒤 차트 제안. count는 확인을 통과한 차트 수, droppedPoints는 출처 글에서 찾지 못해 뺀 점 수 */
  'charts.ready': { count: number; droppedPoints: number };
  /** 보고서 고치기 요청 (이슈 #418). instruction은 200자까지, addedSteps는 더 검색하려고 늘린 단계 수 */
  'revision.requested': { version: number; instruction: string; search: boolean; addedSteps: number };
  /** 고친 보고서를 version판으로 남겼다 */
  'revision.ready': { version: number; chars: number };
  /** 점검·보고서 LLM이 잠깐 실패해(reason) waitSeconds초 쉬었다 다시 부탁한다. attempt는 다시 하는 차례(1부터) (이슈 #521) */
  'report.retry': { phase: 'audit' | 'report'; reason: AiResearchLlmRetryReason; attempt: number; waitSeconds: number };
}

/** 다시 해 볼 만한 LLM 실패: 시간 초과 · 연결 실패 · 모델 없음(서버가 바빠 모델 목록을 못 읽음) · LLM 서버 5xx·429 */
export type AiResearchLlmRetryReason = 'TIMEOUT' | 'CONNECT' | 'NO_MODEL' | 'SERVER';

export const AI_RESEARCH_LLM_RETRY_LABEL: Record<AiResearchLlmRetryReason, string> = {
  TIMEOUT: '시간 초과',
  CONNECT: 'AI 서버 연결 실패',
  NO_MODEL: 'AI 모델을 찾지 못함',
  SERVER: 'AI 서버 오류',
};

/**
 * 보고서 LLM이 쓴 보고서 대신 남긴 대체본의 까닭 (이슈 #521). 잠깐 실패(TIMEOUT·NO_MODEL·CONNECT)는 쉬었다 다시 해 본 뒤의 까닭이다.
 * TIMEOUT 시간 초과 · NO_MODEL 모델 없음(서버가 바빠 모델 목록을 못 읽음 포함) · CONNECT 연결 실패 · ERROR 그 밖의 LLM 실패(잘못된 요청 등, 다시 하지 않음) · EMPTY 빈 답
 */
export type AiResearchReportFallbackReason = 'TIMEOUT' | 'NO_MODEL' | 'CONNECT' | 'ERROR' | 'EMPTY';

export const AI_RESEARCH_REPORT_FALLBACK_LABEL: Record<AiResearchReportFallbackReason, string> = {
  TIMEOUT: '보고서 생성 시간 초과',
  NO_MODEL: 'AI 모델을 찾지 못함',
  CONNECT: 'AI 서버 연결 실패',
  ERROR: '보고서 생성 실패',
  EMPTY: 'AI가 빈 보고서를 냄',
};

/** 대체본. previous면 조사 메모가 아니라 앞 판 보고서를 그대로 둔 것 (보고서 고치기). attempts는 보고서 LLM을 부른 횟수 */
export interface AiResearchReportFallback {
  reason: AiResearchReportFallbackReason;
  previous: boolean;
  attempts: number;
}

/** 대체본 표시 (이슈 #521): '대체본(보고서 생성 시간 초과 · 3번 시도)', 고치기에서 앞 판을 그대로 두었으면 '앞 판 그대로(…)' */
export function aiResearchFallbackText(fallback: AiResearchReportFallback | null | undefined): string | null {
  if (!fallback) return null;
  const why = `${AI_RESEARCH_REPORT_FALLBACK_LABEL[fallback.reason]}${fallback.attempts > 1 ? ` · ${fallback.attempts}번 시도` : ''}`;
  return fallback.previous ? `앞 판 그대로(${why})` : `대체본(${why})`;
}

/** 보고서 판 하나 (목록용, 본문 없음). instruction이 null이면 1판(처음 보고서)이거나 더 조사하기로 다시 쓴 판 */
export interface AiResearchReportVersionSummary {
  version: number;
  instruction: string | null;
  search: boolean;
  createdAt: string;
}

/** GET ai-research/runs/:id/versions/:version */
export interface AiResearchReportVersionView extends AiResearchReportVersionSummary {
  report: string;
  charts: AiResearchChart[];
}

/** 아직 판이 나오지 않은 보고서 고치기 */
export interface AiResearchPendingRevision {
  version: number;
  instruction: string;
  search: boolean;
}

/** 차트 한 점. y는 출처(sourceId)의 글에 실제로 있는 숫자만 (서버가 확인한다) */
export interface AiResearchChartPoint {
  x: string;
  y: number;
  sourceId: number;
}

export interface AiResearchChartSeries {
  name: string;
  points: AiResearchChartPoint[];
}

/** 보고서와 함께 보는 차트 (코드 실행 없이 화면이 그린다) */
export interface AiResearchChart {
  title: string;
  type: 'line' | 'bar';
  unit: string;
  xLabel: string;
  series: AiResearchChartSeries[];
}

export type AiResearchEventView = {
  [K in AiResearchEventType]: { seq: number; type: K; payload: AiResearchEventPayloads[K]; createdAt: string };
}[AiResearchEventType];

// ── 반복 실행 (이슈 #521) ──

export const AI_RESEARCH_SCHEDULE_FREQUENCY = {
  /** 매일 */
  DAILY: 'DAILY',
  /** 매주 고른 요일 */
  WEEKLY: 'WEEKLY',
} as const;
export type AiResearchScheduleFrequency = (typeof AI_RESEARCH_SCHEDULE_FREQUENCY)[keyof typeof AI_RESEARCH_SCHEDULE_FREQUENCY];

/** 요일 이름. 요일 번호(1=월 … 7=일) - 1로 찾는다 */
export const AI_RESEARCH_WEEKDAY_LABEL = ['월', '화', '수', '목', '금', '토', '일'] as const;

/** 실행 시각 HH:MM (Asia/Seoul, 24시간) */
export const AI_RESEARCH_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 반복 규칙. weekdays는 WEEKLY의 요일(1=월 … 7=일), DAILY면 [] */
export interface AiResearchScheduleRule {
  frequency: AiResearchScheduleFrequency;
  weekdays: number[];
  time: string;
}

/** PUT ai-research/runs/:id/schedule 본문 */
export type SetAiResearchScheduleInput = AiResearchScheduleRule;

/** 반복 하나 (GET ai-research/schedules · 조사 상세의 schedule) */
export interface AiResearchScheduleView extends AiResearchScheduleRule {
  id: number;
  /** 반복을 건 조사. 차례마다 이 조사의 질문·계획으로 새 조사를 만든다 */
  runId: number;
  /** 그 조사의 제목 (계획 제목, 없으면 질문) */
  title: string;
  enabled: boolean;
  /** 다음 차례 시각 (꺼져 있으면 null) */
  nextRunAt: string | null;
  /** 마지막으로 차례가 온 시각 (건너뛰었어도) */
  lastRunAt: string | null;
  /** 마지막으로 만든 조사 */
  lastRunId: number | null;
  /** 마지막 차례를 건너뛴 이유 (만들었으면 null) */
  lastSkipReason: string | null;
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 요일을 고른 순서와 상관없이 1~7 안의 것만 한 번씩, 작은 것부터 */
export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/**
 * after 뒤(같은 시각은 넘김) 첫 차례 시각. 시각·요일은 Asia/Seoul(서머타임 없음, +09:00)로 본다.
 * 매주인데 요일이 없거나 시각이 형식에 맞지 않으면 null.
 */
export function nextAiResearchRunAt(rule: AiResearchScheduleRule, after: Date): Date | null {
  const match = AI_RESEARCH_SCHEDULE_TIME_PATTERN.exec(rule.time);
  const weekdays = normalizeWeekdays(rule.weekdays);
  if (!match || (rule.frequency === AI_RESEARCH_SCHEDULE_FREQUENCY.WEEKLY && weekdays.length === 0)) return null;
  const hour = Number(match[1]);
  const minute = Number(rule.time.slice(3, 5));
  const seoul = new Date(after.getTime() + SEOUL_OFFSET_MS);
  for (let day = 0; day <= 7; day += 1) {
    const date = Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + day);
    const at = date + (hour * 60 + minute) * 60_000 - SEOUL_OFFSET_MS;
    if (at <= after.getTime()) continue;
    // getUTCDay: 0=일 → 7, 1=월 → 1
    const weekday = new Date(date).getUTCDay() || 7;
    if (rule.frequency === AI_RESEARCH_SCHEDULE_FREQUENCY.DAILY || weekdays.includes(weekday)) return new Date(at);
  }
  return null;
}

/** '매일 09:00' · '매주 월·수·금 09:00' · '매주 평일 09:00' */
export function aiResearchScheduleText(rule: AiResearchScheduleRule): string {
  if (rule.frequency === AI_RESEARCH_SCHEDULE_FREQUENCY.DAILY) return `매일 ${rule.time}`;
  const weekdays = normalizeWeekdays(rule.weekdays);
  const days = weekdays.join(',') === '1,2,3,4,5' ? '평일' : weekdays.join(',') === '6,7' ? '주말' : weekdays.map((d) => AI_RESEARCH_WEEKDAY_LABEL[d - 1]).join('·');
  return `매주 ${days} ${rule.time}`;
}

/** 목록 한 줄 (GET ai-research/runs) */
export interface AiResearchRunSummaryView {
  id: number;
  question: string;
  /** 계획 제목. 계획 전이면 null */
  title: string | null;
  status: AiResearchStatus;
  stepsUsed: number;
  maxSteps: number;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** 이 조사에 켜진 반복이 있는지 (이슈 #521) */
  repeating: boolean;
  /** 반복이 만든 조사인지 */
  fromSchedule: boolean;
}

/** 조사 하나 (GET ai-research/runs/:id). events는 afterSeq 다음 것만 */
export interface AiResearchRunView extends AiResearchRunSummaryView {
  /** 철강맨AI에서 먼저 알아본 것. 질문만으로 만든 조사면 null */
  seed: AiResearchSeed | null;
  plan: AiResearchPlan | null;
  planRevision: number;
  budget: AiResearchBudget;
  researchState: AiResearchState | null;
  /** 이미 검색한 검색어 (계획 단계의 진행 표시용) */
  searchedQueries: string[];
  sources: AiResearchSourceView[];
  audit: AiResearchAudit | null;
  report: string | null;
  /** 보고서가 길이 한도에 걸려 끊겼는지 (보고서 맨 위에도 알림이 있다) */
  reportTruncated: boolean;
  /** 조사를 다 마치지 못하고(30분 상한·LLM 실패) 그때까지 모은 출처로 보고서를 쓴 이유. 다 마쳤으면 null (보고서 맨 위에도 알림이 있다) */
  incompleteReason?: string | null;
  /** 지금 보고서가 보고서 LLM이 쓴 것이 아니라 대체본이면 그 까닭(시간 초과·모델 없음·연결 실패…)과 시도 횟수 (이슈 #521). 아니면 null */
  reportFallback: AiResearchReportFallback | null;
  /** 근거 점검 LLM이 다시 시도해도 실패해 점검 없이 보고서를 쓴 까닭 (이슈 #521). 아니면 null */
  auditFailure: AiResearchReportFallbackReason | null;
  /**
   * 이 조사의 반복 (이슈 #521). 반복을 건 조사면 그 반복, 반복이 만든 조사면 만든 반복(runId가 원래 조사).
   * 끈 반복도 보인다(enabled false). 반복이 없으면 null
   */
  schedule: AiResearchScheduleView | null;
  /** Notion으로 마지막에 내보낸 보고서 판 (판이 없던 보고서면 null) */
  notionExportedVersion: number | null;
  failureReason: string | null;
  /** 단계를 다 써서 끝났고 아직 모르는 것이 남아 더 조사할 수 있는지 */
  canExtend: boolean;
  /** 출처의 숫자로 만든 차트 (2개까지). 없으면 [] */
  charts: AiResearchChart[];
  /** Notion으로 내보낸 페이지 주소. 내보내지 않았으면 null */
  notionPageUrl: string | null;
  /** 보고서 판 (오래된 것부터, 본문 없음). 고친 적이 없으면 [] (이슈 #418) */
  versions: AiResearchReportVersionSummary[];
  /** 고치는 중인 부탁 (판이 아직 없음). 없으면 null */
  pendingRevision: AiResearchPendingRevision | null;
  /** 보고서를 고칠 수 있는지: 완료·보고서 있음·판이 상한 아래 */
  canRevise: boolean;
  events: AiResearchEventView[];
  /** 지금까지의 마지막 이벤트 순번. 다음 조회의 afterSeq로 쓴다 */
  lastSeq: number;
}

export interface AiResearchCapabilities {
  /** LLM 모델이 정해져 있으면 쓸 수 있다 (검색 엔진이 없어도 위키백과로 찾는다) */
  available: boolean;
}

/**
 * 철강맨AI에서 먼저 알아본 것 (이슈 #408). 웹 검색 답·대화의 심층 조사 카드에서 조사를 만들 때 넘긴다.
 * 계획을 세울 때 참고하고(이미 확인된 것은 다시 찾지 않게), 출처는 조사 출처 목록에 미리 넣는다.
 */
export interface AiResearchSeed {
  /** 철강맨AI의 간단 답 (seedAnswerMax자까지) */
  answer: string;
  /** 간단 답의 웹 출처 (http·https만, seedSourcesMax개까지) */
  sources: { title: string; url: string }[];
}

export interface CreateAiResearchRunInput {
  question: string;
  /** 조사별 예산 (없으면 서버 기본값). 상한(maxStepsCap·maxSourcesCap) 안에서만 */
  budget?: Partial<AiResearchBudget>;
  /** 철강맨AI에서 먼저 알아본 것 (없으면 질문만으로 계획을 세운다) */
  seed?: AiResearchSeed;
}

/** POST ai-research/runs/:id/notion-export */
export interface AiResearchNotionExportResult {
  notionPageUrl: string;
  run: AiResearchRunView;
}

/** POST ai-research/runs/:id/plan/suggest (이슈 #416) 말로 고치기 결과. 서버는 저장하지 않는다. dropped = 규칙(검색어 확인·같은 검색어·6단계)에 맞지 않아 뺀 단계 수 */
export interface AiResearchPlanSuggestion {
  plan: AiResearchPlan;
  dropped: number;
}
