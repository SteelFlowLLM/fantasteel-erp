// 알림 서버 어댑터: 안 읽은 수·최근 알림·알림함(limit·hasMore, 서버 페이지 상한 넘기기)·읽음·모두 읽음, 서버 응답 → 화면 모양.
import type { NotificationView as ServerNotificationView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { notificationApi } from '@/api/notifications';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';
const row = (id: number, readAt: string | null = null): ServerNotificationView => ({
  id,
  notificationType: 'APPROVAL_REQUESTED',
  notificationContent: `구매요청 PR-2610-000${id} 승인 요청 · 정다은님`,
  linkPath: `/approvals?pr=${id}`,
  messageId: null,
  businessEventId: 10 + id,
  readAt,
  createdAt: AT,
});
const pageOf = (items: ServerNotificationView[], total: number, page = 1, size = 20) => ({ items, page, size, total, unreadCount: 4 });

afterEach(() => stopFakeServer());

describe('알림 서버 어댑터 (api/server/notifications.ts)', () => {
  it('안 읽은 수는 안 읽은 것만 1건 물어 unreadCount를 쓴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => (c.path === '/notifications' ? ok(pageOf([row(1)], 4, 1, 1)) : undefined));
    expect(await notificationApi.countUnread(0)).toBe(4);
    expect(calls[0].query).toEqual({ page: '1', size: '1', unreadOnly: 'true' });
  });

  it('내용 한 줄은 제목 자리에, 본문·부서는 비우고 읽음은 readAt으로 정한다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => (c.path === '/notifications' ? ok(pageOf([row(1), row(2, AT)], 2)) : undefined));
    expect(await notificationApi.listRecent(0, 8)).toEqual([
      { id: 1, notificationType: 'APPROVAL_REQUESTED', title: '구매요청 PR-2610-0001 승인 요청 · 정다은님', body: null, linkPath: '/approvals?pr=1', isRead: false, createdAt: AT },
      expect.objectContaining({ id: 2, isRead: true }),
    ]);
    const page = await notificationApi.list({ limit: 20 });
    expect(page).toMatchObject({ hasMore: false, unreadCount: 4 });
    expect(page.items[1]).toMatchObject({ departmentId: null, departmentName: null, readAt: AT });
  });

  it('알림함 limit이 서버 페이지 상한(100)을 넘으면 여러 페이지로 읽고, 남은 게 있으면 hasMore', async () => {
    const all = Array.from({ length: 130 }, (_, i) => row(i + 1));
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => {
      if (c.path !== '/notifications') return undefined;
      const page = Number(c.query.page);
      const size = Number(c.query.size);
      return ok(pageOf(all.slice((page - 1) * size, page * size), all.length, page, size));
    });
    const page = await notificationApi.list({ limit: 120, unreadOnly: true });
    expect(page.items).toHaveLength(120);
    expect(page.hasMore).toBe(true);
    expect(calls.map((c) => [c.query.page, c.query.size, c.query.unreadOnly])).toEqual([
      ['1', '100', 'true'],
      ['2', '100', 'true'],
    ]);
  });

  it('읽음은 POST /notifications/:id/read, 모두 읽음은 read-all의 readCount를 돌려준다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchaseHead, (c) => (c.path === '/notifications/3/read' ? ok(row(3, AT)) : c.path === '/notifications/read-all' ? ok({ readCount: 5 }) : undefined));
    expect(await notificationApi.markRead(3)).toMatchObject({ id: 3, isRead: true, readAt: AT });
    expect(await notificationApi.markAllRead()).toBe(5);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /notifications/3/read', 'POST /notifications/read-all']);
  });
});
