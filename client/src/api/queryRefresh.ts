// 변경(useAction) 뒤에 다시 불러올 조회를 고른다 (이슈 #476).
// 한 번의 변경이 여러 화면(수주·재고·LOT·알림 배지 …)에 걸치므로 기본은 열려 있는 조회를 모두 다시 부르지만,
// 업무 데이터와 상관없는 조회(로그인 세션·검색·AI 연결·음성·외부 연동 상태, 메신저 그림 미리보기)는 매번 다시 받지 않는다.
// 이 조회들은 자기 화면의 훅이 필요할 때 직접 무효화한다.
import type { Query, QueryClient } from '@tanstack/react-query';

/** 변경 뒤에 자동으로 다시 부르지 않는 조회의 첫 키 (queryKeys.ts의 주제) */
export const INDEPENDENT_QUERY_ROOTS: readonly string[] = ['session', 'search', 'llm', 'stt', 'integrations', 'chat-room-images'];

export function isIndependentQuery(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && INDEPENDENT_QUERY_ROOTS.includes(queryKey[0]);
}

/** 변경이 끝난 뒤: 호출한 쪽이 지정한 키(invalidate)를 먼저, 그 밖에는 업무 데이터 조회를 다시 부른다 */
export async function refreshAfterAction(queryClient: QueryClient, explicit: readonly (readonly unknown[])[] = []): Promise<void> {
  await Promise.all(explicit.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  await queryClient.invalidateQueries({ predicate: (query: Query) => !isIndependentQuery(query.queryKey) });
}
