import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { messengerKeys } from '@/api/messenger';
import { ApiError } from '@/api/errors';
import { INDEPENDENT_QUERY_ROOTS, isIndependentQuery, isStaleError, refreshAfterAction } from '@/api/queryRefresh';
import { queryKeys } from '@/api/queryKeys';

async function fetchCount(queryClient: QueryClient, queryKey: readonly unknown[]): Promise<{ n: number }> {
  const counter = { n: 0 };
  await queryClient.fetchQuery({ queryKey, queryFn: async () => ++counter.n, staleTime: 60_000 });
  return counter;
}

describe('변경 뒤 조회 다시 부르기 (이슈 #476)', () => {
  it('AI 연결·음성·연동·메신저 그림은 독립 조회라 자동으로 다시 부르지 않는다', () => {
    expect(isIndependentQuery(messengerKeys.image(1, 2, 3))).toBe(true);
    for (const root of INDEPENDENT_QUERY_ROOTS) expect(isIndependentQuery([root, 'x'])).toBe(true);
  });

  it('업무 데이터 조회와 메신저 목록·메시지는 독립 조회가 아니다', () => {
    expect(isIndependentQuery(['sales-orders', 'list'])).toBe(false);
    // 세션(내 권한·역할·부서장)과 검색은 변경 뒤 낡으면 메뉴 잠금·배지·검색 결과가 틀린다
    expect(isIndependentQuery(queryKeys.session(1))).toBe(false);
    expect(isIndependentQuery(queryKeys.search('SO'))).toBe(false);
    expect(isIndependentQuery(queryKeys.unreadNotificationCount(1))).toBe(false);
    expect(isIndependentQuery(messengerKeys.rooms(1))).toBe(false);
    expect(isIndependentQuery(messengerKeys.messages(1, 2, 30))).toBe(false);
    expect(isIndependentQuery([])).toBe(false);
  });

  it('메신저 그림 미리보기 키는 메신저 조회(all) 아래가 아니다 (소켓 이벤트의 messengerKeys.all 무효화에 걸리지 않는다)', () => {
    const [root] = messengerKeys.all;
    expect(messengerKeys.image(1, 2, 3)[0]).not.toBe(root);
    expect(messengerKeys.messages(1, 2, 30)[0]).toBe(root);
  });

  it('변경 뒤에는 업무 조회만 stale로 만들고 독립 조회와 지정 키 밖의 것은 건드리지 않는다', async () => {
    const queryClient = new QueryClient();
    const orders = await fetchCount(queryClient, ['sales-orders', 'list']);
    const image = await fetchCount(queryClient, messengerKeys.image(1, 2, 3));
    const session = await fetchCount(queryClient, queryKeys.session(1));
    const llm = await fetchCount(queryClient, ['llm', 'settings']);
    expect(orders.n + image.n + session.n + llm.n).toBe(4);
    await refreshAfterAction(queryClient);
    const state = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(state(['sales-orders', 'list'])).toBe(true);
    expect(state(messengerKeys.image(1, 2, 3))).toBe(false);
    expect(state(queryKeys.session(1))).toBe(true);
    expect(state(['llm', 'settings'])).toBe(false);
  });

  it('호출한 쪽이 지정한 키는 독립 조회여도 무효화한다 (설정 저장 화면)', async () => {
    const queryClient = new QueryClient();
    await fetchCount(queryClient, ['llm', 'settings']);
    await refreshAfterAction(queryClient, [['llm', 'settings']]);
    expect(queryClient.getQueryState(['llm', 'settings'])?.isInvalidated).toBe(true);
  });
});

describe('다른 곳에서 먼저 고쳐 막힌 오류 (COM-001, 이슈 #498)', () => {
  it('COM-001만 저장이 막힌 오류로 본다', () => {
    expect(isStaleError(new ApiError('COM-001'))).toBe(true);
    expect(isStaleError(new ApiError('COM-003'))).toBe(false);
    expect(isStaleError(new ApiError('COM-002'))).toBe(false);
    expect(isStaleError(new Error('COM-001'))).toBe(false);
    expect(isStaleError(null)).toBe(false);
  });
});
