// 철강맨AI 심층 조사 api (이슈 #378, 문서에 없는 기능). 서버 docs/backend/ai-research.md
// 진행은 소켓이 아니라 화면이 2~3초마다 afterSeq 다음 이벤트만 받아 간다.
import type {
  CreateAiResearchRunInput,
  AiResearchCapabilities,
  AiResearchNotionExportResult,
  AiResearchPlan,
  AiResearchPlanSuggestion,
  AiResearchRunSummaryView,
  AiResearchRunView,
  PageResult,
} from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const aiResearchKeys = {
  all: ['ai-research'] as const,
  list: (employeeId: number) => ['ai-research', 'list', employeeId] as const,
  detail: (employeeId: number, id: number) => ['ai-research', 'detail', employeeId, id] as const,
};

export const AI_RESEARCH_LIST_SIZE = 50;

export const aiResearchApi = {
  capabilities: (): Promise<AiResearchCapabilities> => serverRequest('GET', '/ai-research/capabilities'),
  list: (): Promise<PageResult<AiResearchRunSummaryView>> => serverRequest('GET', '/ai-research/runs', { query: { page: 1, size: AI_RESEARCH_LIST_SIZE } }),
  /** afterSeq 다음 이벤트만 받는다 */
  get: (id: number, afterSeq: number): Promise<AiResearchRunView> => serverRequest('GET', `/ai-research/runs/${id}`, { query: { afterSeq } }),
  create: (input: CreateAiResearchRunInput): Promise<AiResearchRunView> => serverRequest('POST', '/ai-research/runs', { body: input }),
  exportToNotion: (id: number): Promise<AiResearchNotionExportResult> => serverRequest('POST', `/ai-research/runs/${id}/notion-export`),
  updatePlan: (id: number, revision: number, plan: AiResearchPlan): Promise<AiResearchRunView> => serverRequest('PUT', `/ai-research/runs/${id}/plan`, { body: { revision, plan } }),
  /** 계획을 말로 고치기 (이슈 #416): 화면의 지금 계획과 부탁을 보내 고친 계획을 받는다. 서버는 저장하지 않는다 */
  suggestPlan: (id: number, instruction: string, plan: AiResearchPlan): Promise<AiResearchPlanSuggestion> =>
    serverRequest('POST', `/ai-research/runs/${id}/plan/suggest`, { body: { instruction: instruction.trim(), plan } }),
  /** 제목만 바꾼다 (계획이 있으면 어느 상태에서나, 판 +1) */
  rename: (id: number, revision: number, title: string): Promise<AiResearchRunView> => serverRequest('PATCH', `/ai-research/runs/${id}/title`, { body: { revision, title: title.trim() } }),
  /** 끝난 조사의 질문·계획을 복사해 계획 확인 대기인 새 조사를 만든다 */
  rerun: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/rerun`),
  start: (id: number, revision: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/start`, { body: { revision } }),
  extend: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/extend`),
  cancel: (id: number): Promise<AiResearchRunView> => serverRequest('POST', `/ai-research/runs/${id}/cancel`),
};
