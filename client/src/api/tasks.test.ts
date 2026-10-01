import { describe, expect, it } from 'vitest';
import { setActingEmployeeForTest } from '@/api/actor';
import { InputError } from '@/api/client';
import { taskApi } from '@/api/tasks';
import { getMockDb } from '@/mock/db';
import { updateRow } from '@/mock/store';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

const notificationsOf = (employeeId: number) => getMockDb().read((tables) => tables.notification.filter((n) => n.recipientId === employeeId));

describe('업무 (REQ-NTF-001)', () => {
  it('담당자·마감일을 지정해 만들고, 담당자에게 업무 지정 알림이 간다', async () => {
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const assigneeId = employeeIdOf(SEED_EMPLOYEE_NO.purchase);
    const task = await taskApi.create({ title: ' 철광석 입고 일정 확인 ', assigneeId, dueDate: '2026-10-02', linkPath: '/goods-receipts' });
    expect(task).toMatchObject({ title: '철광석 입고 일정 확인', taskStatus: 'OPEN', dueDate: '2026-10-02', linkPath: '/goods-receipts', canEdit: true });
    expect(task.assignee.id).toBe(assigneeId);

    const notices = notificationsOf(assigneeId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ notificationType: 'TASK_ASSIGNED', linkPath: `/tasks?tab=tasks&task=${task.id}`, isRead: false });

    actAs(SEED_EMPLOYEE_NO.purchase);
    expect((await taskApi.list('mine')).map((t) => t.id)).toEqual([task.id]);
    expect(await taskApi.summary('2026-10-02')).toEqual({ openCount: 1, overdueCount: 0, dueTodayCount: 1 });
  });

  it('나에게 맡기는 업무는 알림이 없다', async () => {
    const me = actAs(SEED_EMPLOYEE_NO.admin);
    await taskApi.create({ title: '사원 등록', assigneeId: me });
    expect(notificationsOf(me)).toHaveLength(0);
  });

  it('입력 확인: 제목·담당자 필수, 연결 화면은 "/" 경로, 날짜 형식', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const error = await taskApi.create({ title: ' ', assigneeId: null, linkPath: 'goods', dueDate: '2026-13-01' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect(Object.keys((error as InputError).fieldErrors).sort()).toEqual(['assigneeId', 'dueDate', 'linkPath', 'title']);
  });

  it('없는 담당자는 COM-003, 사용 안 함 사원은 입력 오류', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await expect(taskApi.create({ title: '업무', assigneeId: 9999 })).rejects.toMatchObject({ code: 'COM-003' });
    const inactiveId = employeeIdOf(SEED_EMPLOYEE_NO.logistics);
    getMockDb().transact((tx) => updateRow(tx, 'employee', inactiveId, { isActive: false }));
    await expect(taskApi.create({ title: '업무', assigneeId: inactiveId })).rejects.toBeInstanceOf(InputError);
  });

  it('계정 선택이 없으면 COM-002', async () => {
    setActingEmployeeForTest(null);
    await expect(taskApi.list('mine')).rejects.toMatchObject({ code: 'COM-002' });
  });

  it('만든 사람·담당자만 고치고 완료한다. 다른 사원은 COM-002', async () => {
    actAs(SEED_EMPLOYEE_NO.salesHead);
    const task = await taskApi.create({ title: '납기 협의', assigneeId: employeeIdOf(SEED_EMPLOYEE_NO.sales) });

    actAs(SEED_EMPLOYEE_NO.quality);
    await expect(taskApi.complete({ id: task.id })).rejects.toMatchObject({ code: 'COM-002' });
    await expect(taskApi.update({ id: task.id, title: '바꿈', assigneeId: task.assignee.id })).rejects.toMatchObject({ code: 'COM-002' });

    actAs(SEED_EMPLOYEE_NO.sales);
    const done = await taskApi.complete({ id: task.id, expectedUpdatedAt: task.updatedAt });
    expect(done.taskStatus).toBe('DONE');
    expect(done.completedAt).not.toBeNull();
  });

  it('담당자를 바꾸면 새 담당자에게 알림, 열어 둔 뒤 바뀌었으면 COM-001', async () => {
    actAs(SEED_EMPLOYEE_NO.salesHead);
    const task = await taskApi.create({ title: '납기 협의', assigneeId: employeeIdOf(SEED_EMPLOYEE_NO.sales) });
    const newAssignee = employeeIdOf(SEED_EMPLOYEE_NO.logistics);
    const updated = await taskApi.update({ id: task.id, title: '납기 협의', assigneeId: newAssignee, expectedUpdatedAt: task.updatedAt });
    expect(updated.assignee.id).toBe(newAssignee);
    expect(notificationsOf(newAssignee)).toHaveLength(1);

    await expect(taskApi.update({ id: task.id, title: '다시', assigneeId: newAssignee, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toMatchObject({
      code: 'COM-001',
    });
  });

  it('완료한 업무는 다시 완료(COM-001)하거나 고칠 수 없다. 없는 업무는 COM-003', async () => {
    const me = actAs(SEED_EMPLOYEE_NO.admin);
    const task = await taskApi.create({ title: '점검', assigneeId: me });
    await taskApi.complete({ id: task.id });
    await expect(taskApi.complete({ id: task.id })).rejects.toMatchObject({ code: 'COM-001' });
    await expect(taskApi.update({ id: task.id, title: '점검', assigneeId: me })).rejects.toBeInstanceOf(InputError);
    await expect(taskApi.complete({ id: 9999 })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('범위: 내 업무 / 내가 만든 업무 / 전체(둘을 합침), 마감일 빠른 순', async () => {
    const me = actAs(SEED_EMPLOYEE_NO.salesHead);
    const sales = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    const a = await taskApi.create({ title: 'A', assigneeId: sales, dueDate: '2026-10-09' });
    const b = await taskApi.create({ title: 'B', assigneeId: me, dueDate: '2026-10-03' });
    actAs(SEED_EMPLOYEE_NO.sales);
    const c = await taskApi.create({ title: 'C', assigneeId: me });
    actAs(SEED_EMPLOYEE_NO.salesHead);
    expect((await taskApi.list('mine')).map((t) => t.id)).toEqual([b.id, c.id]);
    expect((await taskApi.list('created')).map((t) => t.id)).toEqual([b.id, a.id]);
    expect((await taskApi.list('all')).map((t) => t.id)).toEqual([b.id, a.id, c.id]);
  });
});
