import { describe, expect, it } from 'vitest';
import { messengerApi } from '@/api/messenger';
import { notificationApi } from '@/api/notifications';
import { taskApi } from '@/api/tasks';
import { getMockDb } from '@/mock/db';
import { seedCollab } from '@/mock/seeds/collab';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

/** 병합 단계에서 AREA_SEEDERS에 등록하기 전이라 테스트에서 직접 돌린다 */
const runSeed = () => getMockDb().transact((tx) => seedCollab(tx));

describe('협업 시드', () => {
  it('업무·알림·채팅방이 화면에 보일 만큼 만들어진다', async () => {
    runSeed();
    const counts = getMockDb().read((tables) => ({
      tasks: tables.task.length,
      rooms: tables.chatRoom.map((r) => r.chatRoomType),
      files: tables.message.filter((m) => m.fileName).length,
    }));
    expect(counts.tasks).toBe(6);
    expect(counts.rooms).toEqual(['DIRECT', 'GROUP', 'GROUP']);
    expect(counts.files).toBe(1);

    // 구매 정다은: 업무 1건(오늘 기준 마감 전), 업무 지정 알림 1건, 1:1 방에 안 읽은 메시지 1건
    actAs(SEED_EMPLOYEE_NO.purchase);
    expect((await taskApi.list('mine')).map((t) => t.title)).toEqual(['10월 첫째 주 철광석 입고 일정 확인']);
    const notices = await notificationApi.list();
    expect(notices.items.map((n) => n.notificationType)).toEqual(['TASK_ASSIGNED']);
    const rooms = await messengerApi.listRooms();
    expect(rooms.map((r) => [r.displayName, r.unreadCount])).toEqual([
      ['원료 수급', 0],
      ['최준혁', 1],
    ]);
  });

  it('사원 멘션과 부서 멘션 알림이 있고, 시드 첨부를 내려받을 수 있다', async () => {
    runSeed();
    actAs(SEED_EMPLOYEE_NO.logistics);
    expect((await notificationApi.list()).items.some((n) => n.notificationType === 'MENTION' && n.departmentId === null)).toBe(true);
    actAs(SEED_EMPLOYEE_NO.qualityHead);
    const qcMention = (await notificationApi.list()).items.find((n) => n.notificationType === 'MENTION');
    expect(qcMention?.departmentName).toBe('품질부');

    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const direct = (await messengerApi.listRooms()).find((r) => r.chatRoomType === 'DIRECT');
    if (!direct) throw new Error('1:1 방이 없어요');
    const withFile = (await messengerApi.listMessages({ chatRoomId: direct.id })).items.find((m) => m.file);
    if (!withFile) throw new Error('첨부 메시지가 없어요');
    const file = await messengerApi.getFile(withFile.id);
    expect(file.name).toBe('철광석-입고계획-2610.csv');
    expect(decodeURIComponent(file.dataUrl.split(',')[1])).toContain('ORE01 철광석');
  });

  it('안 읽은 수는 마지막 읽은 메시지 뒤의 남이 보낸 메시지 수다 (REQ-MSG-004)', async () => {
    runSeed();
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.salesHead))).toBe(3);
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.productionHead))).toBe(2);
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.sales))).toBe(0);
  });
});
