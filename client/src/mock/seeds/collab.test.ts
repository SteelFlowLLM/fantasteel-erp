import { describe, expect, it } from 'vitest';
import { rowFilesOf } from '@/api/messengerRules';
import { messengerApi } from '@/api/messenger';
import { formatItemQty } from '@/features/messenger/lib/salesOrderQty';
import { getMockDb } from '@/mock/db';
import { SEED_CORE } from '@/mock/seeds/core';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

/** 협업 시드는 AREA_SEEDERS에 등록되어 setup.ts의 resetToSeed()가 넣는다 */

describe('협업 시드', () => {
  it('업무·알림·채팅방이 화면에 보일 만큼 만들어진다', async () => {
    const counts = getMockDb().read((tables) => ({
      tasks: tables.task.length,
      rooms: tables.chatRoom.map((r) => r.chatRoomType),
      files: tables.message.filter((m) => rowFilesOf(m).length > 0).length,
    }));
    expect(counts.tasks).toBe(6);
    // 업무방(WORK)은 거래 시드(core)가 SO-2609-003에 만든다
    expect(counts.rooms).toEqual(['WORK', 'DIRECT', 'GROUP', 'GROUP']);
    expect(counts.files).toBe(1);

    // 구매 정다은: 업무 1건(오늘 기준 마감 전), 업무 지정 알림 1건, 1:1 방에 안 읽은 메시지 1건
    const purchaseId = actAs(SEED_EMPLOYEE_NO.purchase);
    // 업무 화면 api는 서버만 불러 시드 업무는 가짜 DB에서 직접 본다
    expect(getMockDb().read((tables) => tables.task.filter((t) => t.assigneeId === purchaseId).map((t) => t.title))).toEqual(['10월 첫째 주 철광석 입고 일정 확인']);
    // 알림 화면 api도 서버만 불러 가짜 DB 행을 직접 본다. 승인 결과 알림은 거래·대시보드 시드의 구매요청 승인에서 온다
    const notices = getMockDb().read((tables) => tables.notification.filter((n) => n.recipientId === purchaseId));
    expect(notices.map((n) => n.notificationType).filter((type) => type !== 'APPROVAL_RESULT')).toEqual(['TASK_ASSIGNED']);
    const rooms = await messengerApi.listRooms();
    expect(rooms.map((r) => [r.displayName, r.unreadCount])).toEqual([
      ['원료 수급', 0],
      ['SO-2609-003 다온건설', 0],
      ['최준혁', 1],
    ]);
  });

  it('사원 멘션과 부서 멘션 알림이 있고, 시드 첨부를 내려받을 수 있다', async () => {
    const noticesOf = (employeeNo: string) => getMockDb().read((tables) => tables.notification.filter((n) => n.recipientId === employeeIdOf(employeeNo)));
    expect(noticesOf(SEED_EMPLOYEE_NO.logistics).some((n) => n.notificationType === 'MENTION' && n.departmentId === null)).toBe(true);
    const qcMention = noticesOf(SEED_EMPLOYEE_NO.qualityHead).find((n) => n.notificationType === 'MENTION');
    expect(getMockDb().read((tables) => tables.department.find((d) => d.id === qcMention?.departmentId)?.departmentName)).toBe('품질부');

    actAs(SEED_EMPLOYEE_NO.purchaseHead);
    const direct = (await messengerApi.listRooms()).find((r) => r.chatRoomType === 'DIRECT');
    if (!direct) throw new Error('1:1 방이 없어요');
    const withFile = (await messengerApi.listMessages({ chatRoomId: direct.id })).items.find((m) => m.files.length > 0);
    if (!withFile) throw new Error('첨부 메시지가 없어요');
    const file = await messengerApi.getFile({ messageId: withFile.id, fileId: withFile.files[0].id, fileName: '' });
    expect(file.name).toBe('철광석-입고계획-2610.csv');
    expect(decodeURIComponent(file.dataUrl.split(',')[1])).toContain('ORE01 철광석');
  });

  it('안 읽은 수는 마지막 읽은 메시지 뒤의 남이 보낸 메시지 수다 (REQ-MSG-004)', async () => {
    // 거래 시드 업무방(SO-2609-003)의 안 읽은 메시지가 더해진다: 김도윤 3 + 1, 강민석 2 + 1, 박서영 0 + 2
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.salesHead))).toBe(4);
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.productionHead))).toBe(3);
    expect(await messengerApi.countUnread(employeeIdOf(SEED_EMPLOYEE_NO.sales))).toBe(2);
  });

  it('출하 조율 방 메시지의 수주·출하요청 번호가 실제 행으로 이어진다 (REQ-MSG-006, 14.2 ERP 화면 이동)', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const room = (await messengerApi.listRooms()).find((r) => r.displayName === '출하 조율');
    if (!room) throw new Error('출하 조율 방이 없어요');
    const message = (await messengerApi.listMessages({ chatRoomId: room.id })).items.find((m) => m.content?.includes('출하 예정 건'));
    expect(message?.erpLinks.map((link) => link.text)).toEqual([SEED_CORE.salesOrderNos[1], SEED_CORE.waitingShipmentRequestNo]);
    expect(message?.erpLinks.every((link) => /^\/(sales-orders|shipment-requests)\/\d+$/.test(link.href))).toBe(true);
  });

  it('업무방 수주 요약의 코일 품목은 개로 센다 (04 4.1)', async () => {
    actAs(SEED_EMPLOYEE_NO.sales);
    const workRoom = (await messengerApi.listRooms()).find((r) => r.chatRoomType === 'WORK');
    if (!workRoom) throw new Error('업무방이 없어요');
    const detail = await messengerApi.getRoom(workRoom.id);
    const coil = detail.salesOrder?.items.find((item) => item.itemType === 'COIL');
    if (!coil) throw new Error('코일 품목이 없어요');
    expect(formatItemQty(coil).ordered).toBe('6개');
  });
});
