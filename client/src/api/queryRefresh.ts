// 변경(useAction) 뒤에 다시 불러올 조회를 고른다 (이슈 #476).
// 한 번의 변경이 여러 화면(수주·재고·LOT·알림 배지 …)에 걸치므로 기본은 열려 있는 조회를 모두 다시 부르지만,
// 업무 데이터와 상관없는 조회(AI 연결·음성·외부 연동 상태, 메신저 그림 미리보기)는 매번 다시 받지 않는다.
// 이 조회들은 자기 화면의 훅이 필요할 때 직접 무효화한다.
// 로그인 세션(사원 권한·역할·부서장)과 통합 검색은 독립이 아니다: 자기 권한·부서장을 바꾸는 관리 화면, 업무 변경 직후의 검색 결과가 옛 값으로 남는다.
import type { Query, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

/** 변경 뒤에 자동으로 다시 부르지 않는 조회의 첫 키 (queryKeys.ts의 주제) */
export const INDEPENDENT_QUERY_ROOTS: readonly string[] = ['llm', 'stt', 'integrations', 'chat-room-images'];

export function isIndependentQuery(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && INDEPENDENT_QUERY_ROOTS.includes(queryKey[0]);
}

/** 변경이 끝난 뒤: 호출한 쪽이 지정한 키(invalidate)를 먼저, 그 밖에는 업무 데이터 조회를 다시 부른다 */
export async function refreshAfterAction(queryClient: QueryClient, explicit: readonly (readonly unknown[])[] = []): Promise<void> {
  await Promise.all(explicit.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  await queryClient.invalidateQueries({ predicate: (query: Query) => !isIndependentQuery(query.queryKey) });
}

/**
 * 저장이 막힌 오류가 "그 사이 다른 곳에서 먼저 고쳤다"(COM-001)인지. 이 오류 뒤에도 화면이 불러올 때의 수정 시각(updatedAt)을 그대로 들고 있으면
 * 새로 고치기 전까지 같은 오류가 되풀이되므로, 부른 쪽이 조회를 다시 읽는다 (useAction의 refreshOnStale, 이슈 #498)
 */
export const isStaleError = (error: unknown): boolean => error instanceof ApiError && error.code === 'COM-001';
