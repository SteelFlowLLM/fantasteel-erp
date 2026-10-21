// 외부 연결 API 호출: Notion 반영 실패 목록과 다시 시도의 경로·방법·응답 (이슈 #518)
import type { NotionSyncFailureView, NotionSyncRetryResult } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { integrationApi, integrationKeys } from '@/api/integrations';
import { ApiError } from '@/api/errors';
import { fail, ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const failure: NotionSyncFailureView = {
  id: 7,
  targetType: 'task',
  targetId: 12,
  title: '원료 입고 확인',
  failureCount: 2,
  lastError: 'Notion 페이지를 만들지 못했어요',
  isResultUnknown: false,
  retryAfter: '2026-10-22T05:03:00.000Z',
  firstFailedAt: '2026-10-22T04:55:00.000Z',
  lastFailedAt: '2026-10-22T04:59:00.000Z',
};
const retried: NotionSyncRetryResult = { requested: 1, succeeded: 0, failed: 1, skipped: 0, failures: [{ ...failure, failureCount: 3 }] };

afterEach(() => stopFakeServer());

describe('Notion 반영 실패 API (api/integrations.ts)', () => {
  it('목록은 GET integrations/notion/sync-failures', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path === '/integrations/notion/sync-failures' ? ok([failure]) : undefined));
    expect(await integrationApi.notionSyncFailures()).toEqual([failure]);
    expect(calls).toMatchObject([{ method: 'GET', path: '/integrations/notion/sync-failures' }]);
  });

  it('전체 다시 시도는 POST …/sync-failures/retry, 한 건은 POST …/sync-failures/:id/retry', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.admin, (c) => (c.path.endsWith('/retry') ? ok(retried) : undefined));
    expect(await integrationApi.retryNotionSyncFailures()).toEqual(retried);
    expect(await integrationApi.retryNotionSyncFailure(7)).toEqual(retried);
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['POST', '/integrations/notion/sync-failures/retry'],
      ['POST', '/integrations/notion/sync-failures/7/retry'],
    ]);
  });

  it('권한이 없으면 서버가 거절한 COM-002를 그대로 던진다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.sales, () => fail(403, 'COM-002', '연동 관리 사용 권한이 필요해요'));
    await expect(integrationApi.retryNotionSyncFailures()).rejects.toMatchObject({ code: 'COM-002' });
    await expect(integrationApi.retryNotionSyncFailure(7)).rejects.toBeInstanceOf(ApiError);
  });

  it('조회 키는 외부 연결 조회 아래에 둔다 (변경 뒤 외부 연결 키로 한꺼번에 다시 부른다)', () => {
    expect(integrationKeys.syncFailures().slice(0, integrationKeys.all.length)).toEqual([...integrationKeys.all]);
  });
});
