// 철강맨AI 심층 조사 api (이슈 #378, 문서에 없는 기능). 서버 docs/backend/ai-research.md
// 진행은 소켓이 아니라 화면이 2~3초마다 afterSeq 다음 이벤트만 받아 간다.
import type {
  CreateAiResearchRunInput,
  AiResearchCapabilities,
  AiResearchNotionExportResult,
  AiResearchPlan,
  AiResearchPlanSuggestion,
  AiResearchReportVersionView,
  AiResearchRunSummaryView,
  AiResearchRunView,
  AiResearchScheduleView,
  PageResult,
  SetAiResearchScheduleInput,
} from '@fantasteel/shared';
import { serverDownload, serverRequest } from '@/api/http';

export const aiResearchKeys = {
  all: ['ai-research'] as const,
  list: (employeeId: number) => ['ai-research', 'list', employeeId] as const,
  detail: (employeeId: number, id: number) => ['ai-research', 'detail', employeeId, id] as const,
  version: (employeeId: number, id: number, version: number) => ['ai-research', 'version', employeeId, id, version] as const,
  schedules: (employeeId: number) => ['ai-research', 'schedules', employeeId] as const,
};

export const AI_RESEARCH_LIST_SIZE = 50;

export const aiResearchApi = {
  capabilities: (): Promise<AiResearchCapabilities> => serverRequest('GET', '/ai-research/capabilities'),
  list: (): Promise<PageResult<AiResearchRunSummaryView>> => serverRequest('GET', '/ai-research/runs', { query: { page: 1, size: AI_RESEARCH_LIST_SIZE } }),
  /** afterSeq 다음 이벤트만 받는다 */
  get: (id: number, afterSeq: number): Promise<AiResearchRunView> => serverRequest('GET', `/ai-research/runs/${id}`, { query: { afterSeq } }),
  create: (input: CreateAiResearchRunInput): Promise<AiResearchRunView> => serverRequest('POST', '/ai-research/runs', { body: input }),
  /** Notion 내보내기 (이슈 #521): version을 주면 그 판, 없으면 지금 판. 다시 내보내면 새 페이지를 만든다 */
  exportToNotion: (id: number, version?: number): Promise<AiResearchNotionExportResult> =>
    serverRequest('POST', `/ai-research/runs/${id}/notion-export`, { body: version === undefined ? {} : { version } }),
  /** 보고서 PDF (이슈 #521). version이 없으면 지금 보고서 */
  pdf: (id: number, version?: number): Promise<Blob> => serverDownload(`/ai-research/runs/${id}/pdf${version === undefined ? '' : `?version=${version}`}`),
  /** 내 반복 목록 (이슈 #521) */
  schedules: (): Promise<AiResearchScheduleView[]> => serverRequest('GET', '/ai-research/schedules'),
  /** 반복 걸기·바꾸기. 반복이 만든 조사의 id를 줘도 원래 조사의 반복이 바뀐다 */
  setSchedule: (id: number, input: SetAiResearchScheduleInput): Promise<AiResearchScheduleView> => serverRequest('PUT', `/ai-research/runs/${id}/schedule`, { body: input }),
  disableSchedule: (id: number): Promise<AiResearchScheduleView> => serverRequest('DELETE', `/ai-research/runs/${id}/schedule`),
  updatePlan: (id: number, revision: number, plan: AiResearchPlan): Promise<AiResearchRunView> => serverRequest('PUT', `/ai-research/runs/${id}/plan`, { body: { revision, plan } }),
  /** 계획을 말로 고치기 (이슈 #416): 화면의 지금 계획과 부탁을 보내 고친 계획을 받는다. 서버는 저장하지 않는다 */
  suggestPlan: (id: number, instruction: string, plan: AiResearchPlan): Promise<AiResearchPlanSuggestion> =>
    serverRequest('POST', `/ai-research/runs/${id}/plan/suggest`, { body: { instruction: instruction.trim(), plan } }),
  /** 제목만 바꾼다 (계획이 있으면 어느 상태에서나, 판 +1) */
  rename: (id: number, revision: number, title: string): Promise<AiResearchRunView> => serverRequest('PATCH', `/ai-research/runs/${id}/title`, { body: { revision, title: title.trim() } }),
  /** 끝난 조사의 질문·계획을 복사해 계획 확인 대기인 새 조사를 만든다 */
  rerun: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/rerun`),
  start: (id: number, revision: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/start`, { body: { revision } }),
  /** 보고서를 말로 고치기 (이슈 #418): 부탁을 보내 다시 줄에 세운다. 고친 보고서는 다음 판으로 남는다 */
  revise: (id: number, instruction: string, search: boolean): Promise<AiResearchRunView> =>
    serverRequest('POST', `/ai-research/runs/${id}/revisions`, { body: { instruction: instruction.trim(), search } }),
  /** 보고서 판 하나 (본문·차트) */
  getVersion: (id: number, version: number): Promise<AiResearchReportVersionView> => serverRequest('GET', `/ai-research/runs/${id}/versions/${version}`),
  extend: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/extend`),
  cancel: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/cancel`),
};
