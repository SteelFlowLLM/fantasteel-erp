// 대시보드 위젯 다시 읽기 간격: 서버 모드만 30초마다, 가짜 DB 모드는 다시 읽지 않는다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_REFRESH_MS } from '@/api/dashboard';
import { dashboardRefetchInterval } from '@/hooks/useDashboardWidget';

afterEach(() => vi.unstubAllEnvs());

describe('dashboardRefetchInterval', () => {
  it('서버 모드면 30초마다 다시 읽는다', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'server');
    expect(dashboardRefetchInterval()).toBe(DASHBOARD_REFRESH_MS);
    expect(DASHBOARD_REFRESH_MS).toBe(30_000);
  });

  it('가짜 DB 모드(기본)는 다시 읽지 않는다', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'mock');
    expect(dashboardRefetchInterval()).toBe(false);
  });
});
