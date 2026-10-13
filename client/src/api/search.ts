// 통합 검색 (상단 바, PLAN 5장에서 남기기로 함): 수주번호·LOT 번호·출하요청 번호를 찾아 해당 화면으로 보낸다.
// - 정확히 같은 번호가 맨 앞, 그다음 수주 → LOT → 출하요청 순. 최대 10건.
// - 목록 API로 찾는다(api/server/search.ts). 조회 권한이 없는 수주·출하요청은 나오지 않는다.
// - 목록은 보이지만 이동할 화면을 열 수 없는 사원에게는 모든 사원이 여는 화면으로 보낸다:
//   수주 → 작업 로그의 수주 이력 재현, 출하요청 → 출하요청 번호로 LOT 추적.
import { serverSearchCandidates } from '@/api/server/search';

export type SearchHitKind = 'SALES_ORDER' | 'LOT' | 'SHIPMENT_REQUEST';

export const SEARCH_HIT_KIND_LABEL: Record<SearchHitKind, string> = {
  SALES_ORDER: '수주',
  LOT: 'LOT',
  SHIPMENT_REQUEST: '출하요청',
};

/** 정렬 전 후보 (두 데이터 모드가 같은 규칙으로 정렬·자른다) */
export interface SearchCandidate {
  kind: SearchHitKind;
  label: string;
  href: string;
}

export interface SearchHit {
  kind: SearchHitKind;
  kindLabel: string;
  label: string;
  href: string;
}

export const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 10;

const KIND_ORDER: Record<SearchHitKind, number> = { SALES_ORDER: 0, LOT: 1, SHIPMENT_REQUEST: 2 };

/** 정확히 같은 번호가 맨 앞, 그다음 수주 → LOT → 출하요청, 같은 종류는 번호 내림차순. 최대 10건 */
function rankHits(term: string, candidates: readonly SearchCandidate[]): SearchHit[] {
  return candidates
    .map((c) => ({ ...c, exact: c.label.toUpperCase() === term }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.label.localeCompare(a.label))
    .slice(0, SEARCH_LIMIT)
    .map(({ kind, label, href }) => ({ kind, kindLabel: SEARCH_HIT_KIND_LABEL[kind], label, href }));
}

export const searchApi = {
  search: async (keyword: string): Promise<SearchHit[]> => {
    const term = keyword.trim().toUpperCase();
    return term.length < SEARCH_MIN_LENGTH ? [] : rankHits(term, await serverSearchCandidates(term, SEARCH_LIMIT));
  },
};
