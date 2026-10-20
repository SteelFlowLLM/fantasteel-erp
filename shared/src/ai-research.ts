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

/** 끝난 상태 (더 바뀌지 않는다. COMPLETED는 더 조사하기로 QUEUED가 될 수 있다) */
export const AI_RESEARCH_FINISHED_STATUSES: readonly AiResearchStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

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
  /** 계획을 말로 고치기: 부탁 글자 수 (이슈 #416, 가정값) */
  instructionMax: 500,
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
] as const;
export type AiResearchEventType = (typeof AI_RESEARCH_EVENT_TYPES)[number];

/** 이벤트마다의 짧은 내용. 웹에서 온 글(title)은 화면이 글로만 그린다 */
export interface AiResearchEventPayloads {
  /** copiedFrom: 다시 조사로 계획을 가져온 조사 id (새로 세운 계획이면 없다) */
  'plan.ready': { title: string; stepCount: number; revision: number; fallback: boolean; copiedFrom?: number };
  'step.started': { step: number; action: 'search' | 'read'; query: string | null; sourceId: number | null; fallback: boolean };
  'search.done': { query: string; engine: string | null; resultCount: number; added: number; error: string | null };
  'source.added': { sourceId: number; title: string; url: string };
  'page.read': { sourceId: number; title: string; chars: number; error: string | null };
  'state.updated': { summary: string; gapCount: number; unsupportedCount: number };
  'audit.ready': { claimCount: number; contradictionCount: number; missingCount: number; ok: boolean };
  'report.ready': { chars: number; truncated: boolean; citedCount: number; incomplete?: boolean };
  failed: { reason: string };
  cancelled: Record<string, never>;
  'budget.exhausted': { stepsUsed: number; maxSteps: number; gapCount: number; reason?: string };
  /** 보고서 뒤 차트 제안. count는 확인을 통과한 차트 수, droppedPoints는 출처 글에서 찾지 못해 뺀 점 수 */
  'charts.ready': { count: number; droppedPoints: number };
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
  failureReason: string | null;
  /** 단계를 다 써서 끝났고 아직 모르는 것이 남아 더 조사할 수 있는지 */
  canExtend: boolean;
  /** 출처의 숫자로 만든 차트 (2개까지). 없으면 [] */
  charts: AiResearchChart[];
  /** Notion으로 내보낸 페이지 주소. 내보내지 않았으면 null */
  notionPageUrl: string | null;
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

export interface UpdateAiResearchPlanInput {
  revision: number;
  plan: AiResearchPlan;
}

export interface StartAiResearchRunInput {
  revision: number;
}

/** POST ai-research/runs/:id/plan/suggest (이슈 #416). plan은 화면의 지금 계획(저장하지 않은 고침 포함) */
export interface SuggestAiResearchPlanInput {
  instruction: string;
  plan: AiResearchPlan;
}

/** 말로 고치기 결과. 서버는 저장하지 않는다. dropped = 규칙(검색어 확인·같은 검색어·6단계)에 맞지 않아 뺀 단계 수 */
export interface AiResearchPlanSuggestion {
  plan: AiResearchPlan;
  dropped: number;
}
