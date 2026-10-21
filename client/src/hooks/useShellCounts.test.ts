import { describe, expect, it } from 'vitest';
import { approvalWaitingCountOptions, BADGE_REFRESH_MS, unreadChatCountOptions, unreadNotificationCountOptions } from '@/hooks/useShellCounts';
import { createQueryClient } from '@/api/queryClient';

describe('셸 배지 자동 갱신 (이슈 #476)', () => {
  it('알림·메신저·승인 배지 숫자는 30초마다와 창으로 돌아올 때 다시 읽는다', () => {
    expect(BADGE_REFRESH_MS).toBe(30_000);
    for (const options of [unreadNotificationCountOptions(1), unreadChatCountOptions(1), approvalWaitingCountOptions(1, true)]) {
      expect(options.refetchInterval).toBe(BADGE_REFRESH_MS);
      expect(options.refetchOnWindowFocus).toBe(true);
    }
  });

  it('부서장이 아니면 승인 배지를 부르지 않는다', () => {
    expect(approvalWaitingCountOptions(1, false).enabled).toBe(false);
    expect(approvalWaitingCountOptions(1, true).enabled).toBe(true);
  });

  it('다른 조회의 기본값은 그대로다: 폴링·창 포커스 갱신 없음', () => {
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchInterval).toBeUndefined();
  });
});
