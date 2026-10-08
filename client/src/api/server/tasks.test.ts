// 업무 서버 어댑터: 범위별 목록(페이지 끝까지·마감일 순)·요약, 고치기·완료 버튼(등록자·담당자), 등록·수정 입력 확인과 보내는 값, 완료 경로.
import type { TaskView as ServerTaskView } from '@fantasteel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/errors';
import { ok, stopFakeServer, useFakeServer, type ServerCall } from '@/api/server/serverTestKit';
import { taskApi } from '@/api/tasks';
import { SEED_EMPLOYEE_NO } from '@/test/actors';

const AT = '2026-10-07T00:00:00.000Z';
/** 로그인 사원 (서버 id) */
const ME = 77;
const task = (id: number, dueDate: string, extra: Partial<ServerTaskView> = {}): ServerTaskView => ({
  id,
  taskTitle: `업무 ${id}`,
  taskDescription: null,
  assigneeId: ME,
  assigneeName: '정다은',
  creatorId: ME,
  creatorName: '정다은',
  dueDate,
  taskStatus: 'OPEN',
  createdAt: AT,
  updatedAt: AT,
  messageId: null,
  linkPath: null,
  ...extra,
});

/** /auth/me는 로그인 사원, 나머지는 respond */
const fakeServer = (respond: (c: ServerCall) => Response | undefined) =>
  useFakeServer(SEED_EMPLOYEE_NO.purchase, (c) => (c.path === '/auth/me' ? ok({ employeeId: ME }) : respond(c)));
const taskCalls = (calls: ServerCall[]) => calls.filter((c) => c.path !== '/auth/me');

afterEach(() => stopFakeServer());

describe('업무 서버 어댑터 (api/server/tasks.ts)', () => {
  it('목록은 범위를 쿼리로 보내 페이지 끝까지 읽어 마감일 순으로 주고, 고치기는 등록자·담당자, 완료는 담당자만', async () => {
    const calls = fakeServer((c) => {
      if (c.path !== '/tasks') return undefined;
      return c.query.page === '1'
        ? ok({ items: [task(1, '2026-10-20', { assigneeId: 70, assigneeName: '최준혁' }), task(2, '2026-10-09', { taskStatus: 'DONE' })], page: 1, size: 2, total: 3 })
        : ok({ items: [task(3, '2026-10-08', { creatorId: 70, creatorName: '최준혁' })], page: 2, size: 2, total: 3 });
    });
    const rows = await taskApi.list('all');
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ creator: { id: 70, employeeName: '최준혁' }, assignee: { id: ME }, canEdit: true, canComplete: true });
    expect(rows[1]).toMatchObject({ canEdit: false, canComplete: false });
    expect(rows[2]).toMatchObject({ assignee: { id: 70 }, canEdit: true, canComplete: false });
    expect(taskCalls(calls).map((c) => [c.query.page, c.query.scope])).toEqual([
      ['1', 'all'],
      ['2', 'all'],
    ]);
  });

  it('요약은 진행 중인 내 담당 업무로 센다', async () => {
    const calls = fakeServer((c) =>
      c.path === '/tasks' ? ok({ items: [task(1, '2026-10-06'), task(2, '2026-10-07'), task(3, '2026-10-30'), task(4, '2026-10-01', { taskStatus: 'DONE' })], page: 1, size: 100, total: 4 }) : undefined,
    );
    expect(await taskApi.summary('2026-10-07')).toEqual({ openCount: 3, overdueCount: 1, dueTodayCount: 1 });
    expect(taskCalls(calls)[0].query.scope).toBe('mine');
  });

  it('등록은 서버 칸 이름과 연결 화면을 보내고, 빈 값·잘못된 경로는 서버를 부르지 않고 입력칸 오류', async () => {
    const calls = fakeServer((c) => (c.path === '/tasks' && c.method === 'POST' ? ok(task(9, '2026-10-20', { assigneeId: 70, assigneeName: '최준혁', linkPath: '/mrp' })) : undefined));
    const empty = await taskApi.create({ title: ' ', assigneeId: null, dueDate: '', linkPath: 'mrp' }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(InputError);
    expect((empty as InputError).fieldErrors).toMatchObject({ title: '제목을 입력해 주세요', assigneeId: '담당자를 골라 주세요', dueDate: '마감일을 골라 주세요', linkPath: expect.any(String) });
    expect(taskCalls(calls)).toHaveLength(0);

    const created = await taskApi.create({ title: ' 일정 확인 ', description: '', assigneeId: 70, dueDate: '2026-10-20', linkPath: ' /mrp ' });
    expect(taskCalls(calls)[0].body).toEqual({ taskTitle: '일정 확인', taskDescription: null, assigneeId: 70, dueDate: '2026-10-20', linkPath: '/mrp' });
    expect(created).toMatchObject({ id: 9, assignee: { id: 70, employeeName: '최준혁' }, linkPath: '/mrp', canEdit: true, canComplete: false });
  });

  it('메시지에서 등록하면 연결 화면 대신 messageId를 보내고, 서버가 준 원본 메시지 경로를 쓴다', async () => {
    const link = '/messenger?room=3&message=40';
    const calls = fakeServer((c) => (c.path === '/tasks' ? ok(task(9, '2026-10-20', { messageId: 40, linkPath: link })) : undefined));
    const created = await taskApi.create({ title: '입고 확인', assigneeId: 70, dueDate: '2026-10-20', messageId: 40 });
    expect(taskCalls(calls)[0].body).toEqual({ taskTitle: '입고 확인', taskDescription: null, assigneeId: 70, dueDate: '2026-10-20', messageId: 40 });
    expect(created.linkPath).toBe(link);
  });

  it('수정은 PATCH /tasks/:id로 보내고 비운 연결 화면은 null, expectedUpdatedAt은 보내지 않는다', async () => {
    const calls = fakeServer((c) => (c.path === '/tasks/5' ? ok(task(5, '2026-10-25', { taskTitle: '고친 업무' })) : undefined));
    const saved = await taskApi.update({ id: 5, title: '고친 업무', description: '메모', assigneeId: ME, dueDate: '2026-10-25', linkPath: '', expectedUpdatedAt: AT });
    expect(taskCalls(calls).map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/tasks/5', { taskTitle: '고친 업무', taskDescription: '메모', assigneeId: ME, dueDate: '2026-10-25', linkPath: null }],
    ]);
    expect(saved.title).toBe('고친 업무');
  });

  it('완료는 POST /tasks/:id/complete이고 expectedUpdatedAt은 보내지 않는다', async () => {
    const calls = fakeServer((c) => (c.path === '/tasks/5/complete' ? ok(task(5, '2026-10-20', { taskStatus: 'DONE' })) : undefined));
    expect((await taskApi.complete({ id: 5, expectedUpdatedAt: AT })).taskStatus).toBe('DONE');
    expect(taskCalls(calls).map((c) => [c.method, c.path, c.body])).toEqual([['POST', '/tasks/5/complete', undefined]]);
  });
});
