import type { AuthUser } from '@fantasteel/shared';
import { NotificationService } from './notification.service';
import type { NotificationRow } from './notification.repository';

// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (organization/testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('../organization/testing/nest-common.shim'));
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

const me: AuthUser = { employeeId: 1, employeeNo: '2104012', employeeName: '김영업', roleCode: 'SALES', departmentId: 1, departmentName: '영업부', jobGrade: '대리', headDepartmentIds: [], permissions: {} };

const n = (id: number, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id, notificationType: 'TASK', title: `알림 ${id}`, body: null, linkPath: null, departmentId: null, isRead: false, readAt: null, createdAt: new Date('2026-09-30T00:00:00Z'), ...over,
});

function setup() {
  const repo = { listMine: jest.fn(), countUnread: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(), findMine: jest.fn() };
  const realtime = { toEmployees: jest.fn(), changed: jest.fn() };
  const prisma = { tx: (fn: (t: unknown) => unknown) => fn({}) };
  return { repo, realtime, service: new NotificationService(prisma as never, repo as never, realtime as never) };
}

describe('NotificationService', () => {
  describe('listMine (커서 페이지)', () => {
    it('limit보다 1개 더 읽어 다음 페이지가 있으면 nextCursor를 준다', async () => {
      const { service, repo } = setup();
      repo.listMine.mockResolvedValue([n(9), n(8), n(7)]);
      const page = await service.listMine({ limit: 2 }, me);
      expect(repo.listMine.mock.calls[0][2]).toEqual({ unreadOnly: false, cursor: undefined, take: 3 });
      expect(page.items.map((i) => i.id)).toEqual([9, 8]);
      expect(page.nextCursor).toBe(8);
    });

    it('마지막 페이지면 nextCursor가 null이다', async () => {
      const { service, repo } = setup();
      repo.listMine.mockResolvedValue([n(2), n(1)]);
      const page = await service.listMine({ limit: 2 }, me);
      expect(page.nextCursor).toBeNull();
    });

    it('내 id로만 조회하고 unreadOnly·cursor를 넘긴다', async () => {
      const { service, repo } = setup();
      repo.listMine.mockResolvedValue([]);
      await service.listMine({ unreadOnly: true, cursor: 5 }, me);
      expect(repo.listMine.mock.calls[0][1]).toBe(1);
      expect(repo.listMine.mock.calls[0][2]).toEqual({ unreadOnly: true, cursor: 5, take: 21 });
    });
  });

  describe('markRead', () => {
    it('내 알림을 읽음 처리하고 다른 화면에 알린다', async () => {
      const { service, repo, realtime } = setup();
      repo.markRead.mockResolvedValue(1);
      repo.findMine.mockResolvedValue(n(3, { isRead: true }));
      const r = await service.markRead(3, me);
      expect(r.isRead).toBe(true);
      expect(repo.markRead.mock.calls[0].slice(1)).toEqual([1, 3]);
      expect(realtime.toEmployees).toHaveBeenCalledWith([1], 'notification-read', { id: 3 });
    });

    it('이미 읽은 알림을 또 읽어도 성공하고 알리지 않는다 (멱등)', async () => {
      const { service, repo, realtime } = setup();
      repo.markRead.mockResolvedValue(0);
      repo.findMine.mockResolvedValue(n(3, { isRead: true }));
      await expect(service.markRead(3, me)).resolves.toMatchObject({ id: 3 });
      expect(realtime.toEmployees).not.toHaveBeenCalled();
    });

    it('남의 알림이거나 없는 알림은 404다', async () => {
      const { service, repo } = setup();
      repo.markRead.mockResolvedValue(0);
      repo.findMine.mockResolvedValue(null);
      await expect(service.markRead(99, me)).rejects.toMatchObject({ code: 'COM-004' });
    });
  });

  describe('markAllRead', () => {
    it('읽음 처리한 개수를 돌려주고, 바뀐 것이 있을 때만 알린다', async () => {
      const { service, repo, realtime } = setup();
      repo.markAllRead.mockResolvedValue(4);
      await expect(service.markAllRead(me)).resolves.toEqual({ updated: 4 });
      expect(realtime.toEmployees).toHaveBeenCalledWith([1], 'notification-read', { all: true });
      realtime.toEmployees.mockClear();
      repo.markAllRead.mockResolvedValue(0);
      await service.markAllRead(me);
      expect(realtime.toEmployees).not.toHaveBeenCalled();
    });
  });
});
