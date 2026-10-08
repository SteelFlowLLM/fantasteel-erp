// 업무 서버 어댑터: 내 담당 업무 목록(페이지 끝까지·마감일 순)·요약, 등록 입력 확인과 보내는 값, 완료 경로.
import type { TaskView as ServerTaskView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { ok, stopFakeServer, useFakeServer } from '@/api/server/serverTestKit';
import { taskApi } from '@/api/tasks';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';
const task = (id: number, dueDate: string, extra: Partial<ServerTaskView> = {}): ServerTaskView => ({
  id,
  taskTitle: `업무 ${id}`,
  taskDescription: null,
  assigneeId: 77,
  assigneeName: '정다은',
  creatorId: 77,
  creatorName: '정다은',
  dueDate,
  taskStatus: 'OPEN',
  createdAt: AT,
  updatedAt: AT,
  messageId: null,
  linkPath: null,
  ...extra,
});

afterEach(() => stopFakeServer());

describe('업무 서버 어댑터 (api/server/tasks.ts)', () => {
  it('목록은 GET /tasks를 페이지 끝까지 읽어 마감일 순으로 주고, 요청자는 담당자로 채워 숨긴다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => {
      if (c.path !== '/tasks') return undefined;
      return c.query.page === '1'
        ? ok({ items: [task(1, '2026-10-20'), task(2, '2026-10-09', { taskStatus: 'DONE' })], page: 1, size: 2, total: 3 })
        : ok({ items: [task(3, '2026-10-08')], page: 2, size: 2, total: 3 });
    });
    const rows = await taskApi.list('created');
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ title: '업무 3', assignee: { id: 77, employeeName: '정다은' }, linkPath: null, canEdit: true });
    expect(rows[0].creator.id).toBe(rows[0].assignee.id);
    expect(rows[1].canEdit).toBe(false);
    expect(calls.map((c) => c.query.page)).toEqual(['1', '2']);
  });

  it('요약은 진행 중인 내 업무로 센다', async () => {
    useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) =>
      c.path === '/tasks' ? ok({ items: [task(1, '2026-10-06'), task(2, '2026-10-07'), task(3, '2026-10-30'), task(4, '2026-10-01', { taskStatus: 'DONE' })], page: 1, size: 100, total: 4 }) : undefined,
    );
    expect(await taskApi.summary('2026-10-07')).toEqual({ openCount: 3, overdueCount: 1, dueTodayCount: 1 });
  });

  it('등록은 서버 칸 이름으로 보내고, 제목·담당자·마감일이 비면 서버를 부르지 않고 입력칸 오류', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/tasks' && c.method === 'POST' ? ok(task(9, '2026-10-20', { assigneeId: 70, assigneeName: '최준혁' })) : undefined));
    const empty = await taskApi.create({ title: ' ', assigneeId: null, dueDate: '' }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(InputError);
    expect((empty as InputError).fieldErrors).toEqual({ title: '제목을 입력해 주세요', assigneeId: '담당자를 골라 주세요', dueDate: '마감일을 골라 주세요' });
    expect(calls).toHaveLength(0);

    const created = await taskApi.create({ title: ' 일정 확인 ', description: '', assigneeId: 70, dueDate: '2026-10-20', linkPath: '/mrp' });
    expect(calls[0].body).toEqual({ taskTitle: '일정 확인', taskDescription: null, assigneeId: 70, dueDate: '2026-10-20' });
    expect(created).toMatchObject({ id: 9, assignee: { id: 70, employeeName: '최준혁' } });
  });

  it('메시지에서 등록하면 messageId를 보내고, 서버가 준 원본 메시지 경로를 연결 화면으로 쓴다', async () => {
    const link = '/messenger?room=3&message=40';
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/tasks' ? ok(task(9, '2026-10-20', { messageId: 40, linkPath: link })) : undefined));
    const created = await taskApi.create({ title: '입고 확인', assigneeId: 70, dueDate: '2026-10-20', messageId: 40 });
    expect(calls[0].body).toEqual({ taskTitle: '입고 확인', taskDescription: null, assigneeId: 70, dueDate: '2026-10-20', messageId: 40 });
    expect(created.linkPath).toBe(link);
  });

  it('완료는 POST /tasks/:id/complete이고 expectedUpdatedAt은 보내지 않는다', async () => {
    const calls = useFakeServer(SEED_EMPLOYEE_NO.purchase, () => ok(task(5, '2026-10-20', { taskStatus: 'DONE' })));
    expect((await taskApi.complete({ id: 5, expectedUpdatedAt: AT })).taskStatus).toBe('DONE');
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([['POST', '/tasks/5/complete', undefined]]);
  });
});
