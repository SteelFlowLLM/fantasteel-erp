// 과거 사례 (EX, API-267~270, docs/backend/past-case.md). 서버가 예시 사례와 등록 사례(DB past_case)를 합쳐 준다.
import type { CreatePastCaseInput, PastCaseDraftView, PastCaseSearchInput, PastCaseView } from '@fantasteel/shared';
import { serverRequest } from '@/api/http';

export const pastCaseKeys = {
  all: ['past-cases'] as const,
  search: (input: PastCaseSearchInput) => ['past-cases', 'search', input] as const,
};

export const pastCaseApi = {
  search: (input: PastCaseSearchInput): Promise<PastCaseView[]> =>
    serverRequest('GET', '/past-cases', { query: { q: input.q || undefined, category: input.category, days: input.days } }),
  get: (id: number): Promise<PastCaseView> => serverRequest('GET', `/past-cases/${id}`),
  /** AI가 초안을 쓰는 동안 수십 초 걸릴 수 있다. AI가 실패해도 서버가 검사 결과 초안을 준다 */
  createDraft: (lotId: number): Promise<PastCaseDraftView> => serverRequest('POST', `/lots/${lotId}/past-case-drafts`),
  create: (input: CreatePastCaseInput): Promise<PastCaseView> => serverRequest('POST', '/past-cases', { body: input }),
};
