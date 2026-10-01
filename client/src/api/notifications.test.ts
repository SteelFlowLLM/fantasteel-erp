import { beforeEach, describe, expect, it } from 'vitest';
import { InputError } from '@/api/client';
import { notificationApi } from '@/api/notifications';
import { getMockDb } from '@/mock/db';
import { recordBusinessEvent } from '@/mock/businessEvents';
import { actAs, departmentIdOf, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';
import { resetToMasterSeed } from '@/test/masterSeed';

const rowsOf = (employeeId: number) => getMockDb().read((tables) => tables.notification.filter((n) => n.recipientId === employeeId));

// 이 시험은 협업 시드가 없는 상태(조직·기준정보만)를 전제로 쓰였다
beforeEach(resetToMasterSeed);

describe('알림 (REQ-NTF-002)', () => {
  it('개인 알림을 보내고, 받은 사람이 목록에서 보고 읽음 처리한다', async () => {
    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const purchase = employeeIdOf(SEED_EMPLOYEE_NO.purchase);
    expect(await notificationApi.notify({ type: 'APPROVAL_RESULT', recipientEmployeeIds: [purchase], title: '구매요청 승인', linkPath: '/purchase-requisitions' })).toBe(1);

    actAs(SEED_EMPLOYEE_NO.purchase);
    const page = await notificationApi.list();
    expect(page.unreadCount).toBe(1);
    expect(page.items[0]).toMatchObject({ notificationType: 'APPROVAL_RESULT', title: '구매요청 승인', isRead: false, departmentId: null });
    expect(await notificationApi.countUnread(purchase)).toBe(1);

    const read = await notificationApi.markRead(page.items[0].id);
    expect(read.isRead).toBe(true);
    expect(read.readAt).not.toBeNull();
    expect(await notificationApi.countUnread(purchase)).toBe(0);
    expect((await notificationApi.list({ unreadOnly: true })).items).toHaveLength(0);
  });

  it('부서 알림은 그 부서의 사용 중 사원 모두에게 간다 (REQ-ORG-004)', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const qc = departmentIdOf('QC');
    expect(await notificationApi.notify({ type: 'MENTION', departmentId: qc, title: '품질부 확인 요청' })).toBe(2);
    for (const no of [SEED_EMPLOYEE_NO.qualityHead, SEED_EMPLOYEE_NO.quality]) {
      const rows = rowsOf(employeeIdOf(no));
      expect(rows).toHaveLength(1);
      expect(rows[0].departmentId).toBe(qc);
    }
    actAs(SEED_EMPLOYEE_NO.quality);
    expect((await notificationApi.list()).items[0].departmentName).toBe('품질부');
  });

  it('같은 작업 로그·받는 사람으로는 한 번만 만든다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const eventId = getMockDb().transact((tx) =>
      recordBusinessEvent(tx, { businessEventType: 'SALES_ORDER_CREATED', actor: { actorType: 'SYSTEM' }, targetType: 'sales_order', targetId: 1 }).id,
    );
    const sales = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    expect(await notificationApi.notify({ type: 'MENTION', recipientEmployeeIds: [sales], title: '첫 번째', sourceEventId: eventId })).toBe(1);
    expect(await notificationApi.notify({ type: 'MENTION', recipientEmployeeIds: [sales], title: '두 번째', sourceEventId: eventId })).toBe(0);
    expect(rowsOf(sales)).toHaveLength(1);
  });

  it('남의 알림은 읽음 처리할 수 없다(COM-002), 없는 알림은 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    await notificationApi.notify({ type: 'MENTION', recipientEmployeeIds: [employeeIdOf(SEED_EMPLOYEE_NO.sales)], title: '알림' });
    const id = rowsOf(employeeIdOf(SEED_EMPLOYEE_NO.sales))[0].id;
    await expect(notificationApi.markRead(id)).rejects.toMatchObject({ code: 'COM-002' });
    await expect(notificationApi.markRead(9999)).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('모두 읽음은 내 안 읽은 알림 수를 돌려준다', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const sales = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    await notificationApi.notify({ type: 'MENTION', recipientEmployeeIds: [sales], title: '하나' });
    await notificationApi.notify({ type: 'TASK_ASSIGNED', recipientEmployeeIds: [sales], title: '둘' });
    actAs(SEED_EMPLOYEE_NO.sales);
    expect(await notificationApi.markAllRead()).toBe(2);
    expect(await notificationApi.markAllRead()).toBe(0);
  });

  it('입력 확인: 받는 사람·제목 필수, 경로 형식. 없는 부서·사원은 COM-003', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const error = await notificationApi.notify({ type: 'MENTION', title: '', linkPath: 'tasks' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputError);
    expect(Object.keys((error as InputError).fieldErrors).sort()).toEqual(['linkPath', 'recipientEmployeeIds', 'title']);
    await expect(notificationApi.notify({ type: 'MENTION', title: '알림', departmentId: 9999 })).rejects.toMatchObject({ code: 'COM-003' });
    await expect(notificationApi.notify({ type: 'MENTION', title: '알림', recipientEmployeeIds: [9999] })).rejects.toMatchObject({ code: 'COM-003' });
  });

  it('목록은 최신순이고 limit보다 많으면 hasMore', async () => {
    actAs(SEED_EMPLOYEE_NO.admin);
    const sales = employeeIdOf(SEED_EMPLOYEE_NO.sales);
    for (let index = 1; index <= 3; index += 1) await notificationApi.notify({ type: 'MENTION', recipientEmployeeIds: [sales], title: `알림 ${index}` });
    actAs(SEED_EMPLOYEE_NO.sales);
    const page = await notificationApi.list({ limit: 2 });
    expect(page.items.map((n) => n.title)).toEqual(['알림 3', '알림 2']);
    expect(page.hasMore).toBe(true);
  });
});
