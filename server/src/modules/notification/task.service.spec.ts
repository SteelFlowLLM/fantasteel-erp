import type { AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { NotificationSender } from './notification.sender';
import { TaskService } from './task.service';
import type { TaskRow } from './task.repository';

// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (organization/testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('../organization/testing/nest-common.shim'));
// 실시간·DB 연결(ESM 패키지·PrismaClient)은 이 테스트에 필요 없다
jest.mock('../../common/realtime/realtime.service', () => ({ RealtimeService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

const me: AuthUser = { employeeId: 1, employeeNo: '2104012', employeeName: '김영업', roleCode: 'SALES', departmentId: 1, departmentName: '영업부', jobGrade: '대리', headDepartmentIds: [], permissions: {} };
const other = { ...me, employeeId: 9, employeeName: '제3자' };

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 10, title: '검사 성적서 확인', description: null, assigneeId: 2, creatorId: 1, dueDate: null, taskStatus: 'TODO', linkPath: null, completedAt: null,
    createdAt: new Date('2026-09-30T00:00:00Z'), updatedAt: new Date('2026-09-30T00:00:00Z'),
    assignee: { employeeName: '담당' }, creator: { employeeName: '김영업' }, ...over,
  };
}

function setup(existing: TaskRow | null = row()) {
  const notificationCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = { notification: { findMany: jest.fn().mockResolvedValue([]), createMany: notificationCreateMany } };
  const prisma = { tx: (fn: (t: unknown) => unknown) => fn(tx) };
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation(async (_tx: unknown, data: Partial<TaskRow>) => row({ ...data, id: 11 } as Partial<TaskRow>)),
    update: jest.fn().mockImplementation(async (_tx: unknown, id: number, data: Partial<TaskRow>) => row({ ...(existing ?? {}), ...stripUndefined(data), id } as Partial<TaskRow>)),
    isActiveEmployee: jest.fn().mockResolvedValue(true),
  };
  const realtime = { changed: jest.fn(), toEmployees: jest.fn() };
  const sender = new NotificationSender(realtime as never);
  const service = new TaskService(prisma as never, repo as never, sender, realtime as never);
  return { service, repo, realtime, notificationCreateMany };
}

const stripUndefined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

describe('TaskService', () => {
  describe('create', () => {
    it('다른 사람에게 맡기면 담당자에게 TASK 알림을 보낸다', async () => {
      const { service, notificationCreateMany, realtime } = setup();
      const t = await service.create({ title: '  납기 확인  ', assigneeId: 2, dueDate: '2026-10-05', linkPath: '/sales-orders/3' }, me);
      expect(t.creatorId).toBe(1);
      expect(t.title).toBe('납기 확인');
      expect(notificationCreateMany).toHaveBeenCalledTimes(1);
      const data = notificationCreateMany.mock.calls[0][0].data[0];
      expect(data).toMatchObject({ recipientId: 2, notificationType: 'TASK', linkPath: '/sales-orders/3' });
      expect(data.title).toContain('납기 확인');
      expect(realtime.changed).toHaveBeenCalledWith('tasks');
    });

    it('자기 자신에게 맡기면 알림을 보내지 않는다', async () => {
      const { service, notificationCreateMany } = setup();
      await service.create({ title: '내 할 일', assigneeId: 1 }, me);
      expect(notificationCreateMany).not.toHaveBeenCalled();
    });

    it('마감일은 날짜만 저장하고 YYYY-MM-DD로 돌려준다', async () => {
      const { service, repo } = setup();
      const t = await service.create({ title: 'x', assigneeId: 2, dueDate: '2026-10-05' }, me);
      expect(repo.create.mock.calls[0][1].dueDate).toEqual(new Date('2026-10-05T00:00:00Z'));
      expect(t.dueDate).toBe('2026-10-05');
    });

    it('사용 중이 아닌 사원은 담당자로 지정할 수 없다', async () => {
      const { service, repo } = setup();
      repo.isActiveEmployee.mockResolvedValue(false);
      await expect(service.create({ title: 'x', assigneeId: 2 }, me)).rejects.toBeInstanceOf(AppException);
    });
  });

  describe('update (만든 사람·담당자만)', () => {
    it('제3자는 고칠 수 없다 (403)', async () => {
      const { service } = setup();
      await expect(service.update(10, { title: 'y' }, other)).rejects.toMatchObject({ code: 'COM-002' });
    });

    it('없는 업무는 404다', async () => {
      const { service } = setup(null);
      await expect(service.update(10, { title: 'y' }, me)).rejects.toMatchObject({ code: 'COM-004' });
    });

    it('담당자도 고칠 수 있고, 담당자를 바꾸면 새 담당자에게 알린다', async () => {
      const { service, notificationCreateMany } = setup();
      await service.update(10, { assigneeId: 3 }, { ...me, employeeId: 2 }); // 현재 담당자(2)가 3에게 넘김
      expect(notificationCreateMany.mock.calls[0][0].data[0]).toMatchObject({ recipientId: 3, notificationType: 'TASK' });
    });

    it('담당자를 바꾸지 않으면 알림이 없다', async () => {
      const { service, notificationCreateMany } = setup();
      await service.update(10, { title: '새 제목', assigneeId: 2 }, me);
      expect(notificationCreateMany).not.toHaveBeenCalled();
    });

    it('내가 나에게 넘기는 경우는 알림이 없다', async () => {
      const { service, notificationCreateMany } = setup();
      await service.update(10, { assigneeId: 1 }, me);
      expect(notificationCreateMany).not.toHaveBeenCalled();
    });

    it('마감일을 null로 비울 수 있다', async () => {
      const { service, repo } = setup(row({ dueDate: new Date('2026-10-05T00:00:00Z') }));
      await service.update(10, { dueDate: null }, me);
      expect(repo.update.mock.calls[0][2].dueDate).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('완료로 바꾸면 completedAt을 기록한다', async () => {
      const { service, repo } = setup();
      await service.setStatus(10, 'DONE', me);
      const data = repo.update.mock.calls[0][2];
      expect(data.taskStatus).toBe('DONE');
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('완료된 업무를 다시 열면 completedAt을 지운다', async () => {
      const { service, repo } = setup(row({ taskStatus: 'DONE', completedAt: new Date() }));
      await service.setStatus(10, 'IN_PROGRESS', me);
      expect(repo.update.mock.calls[0][2]).toEqual({ taskStatus: 'IN_PROGRESS', completedAt: null });
    });

    it('같은 상태로 바꾸면 아무것도 쓰지 않는다', async () => {
      const { service, repo } = setup(row({ taskStatus: 'DONE', completedAt: new Date('2026-09-30T01:00:00Z') }));
      const t = await service.setStatus(10, 'DONE', me);
      expect(repo.update).not.toHaveBeenCalled();
      expect(t.completedAt).toEqual(new Date('2026-09-30T01:00:00Z'));
    });

    it('제3자는 상태를 바꿀 수 없다', async () => {
      const { service } = setup();
      await expect(service.setStatus(10, 'DONE', other)).rejects.toMatchObject({ code: 'COM-002' });
    });
  });

  describe('list scope', () => {
    it.each([
      [undefined, { assigneeId: 1, taskStatus: undefined }],
      ['mine', { assigneeId: 1, taskStatus: undefined }],
      ['created', { creatorId: 1, taskStatus: undefined }],
      ['all', { OR: [{ assigneeId: 1 }, { creatorId: 1 }], taskStatus: undefined }],
    ] as const)('scope=%s는 내 업무만 조회한다', async (scope, where) => {
      const { service, repo } = setup();
      await service.list({ scope }, me);
      expect(repo.list.mock.calls[0][1]).toEqual(where);
    });

    it('status 필터를 함께 건다', async () => {
      const { service, repo } = setup();
      await service.list({ status: 'TODO' }, me);
      expect(repo.list.mock.calls[0][1]).toEqual({ assigneeId: 1, taskStatus: 'TODO' });
    });
  });
});
