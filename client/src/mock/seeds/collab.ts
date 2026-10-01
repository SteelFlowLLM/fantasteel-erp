// 협업 시드: 업무 6건, 업무 지정 알림, 1:1 채팅방 1개 · 그룹 채팅방 2개와 메시지(첨부 1개, 사원 멘션 2개, 부서 멘션 1개).
// 업무방(WORK)은 거래 시드(core)가 수주와 함께 만든다. 모든 값은 시연용 가정값이다 (docs/rework/areas/collab.md '가정값').
// 등록: mock/seeds/index.ts의 AREA_SEEDERS에 { key: 'collab', run: seedCollab }을 거래 시드 뒤에 넣는다 (병합 단계).
// 시드는 api/client를 가져오지 않는다 (mock/db → seed → 이 파일로 이어지는 순환을 피함).
import { CHAT_ROOM_TYPE, NOTIFICATION_TYPE, TASK_STATUS } from '@/codes';
import { postMessage } from '@/api/messengerRules';
import { taskAssignedNotice } from '@/features/tasks/lib/taskNotice';
import type { ChatRoomRow, MessageRow } from '@/mock/schema';
import { SEED_CORE } from '@/mock/seeds/core';
import { createNotifications } from '@/mock/services/notifications';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

/** 같은 테이블 위에서 시각만 다른 tx (seeds/index.ts의 seedTxAt과 같다. 순환 참조를 피하려고 여기 둔다) */
function at(tx: MockTx, isoDateTime: string): MockTx {
  const now = new Date(isoDateTime);
  return { tables: tx.tables, now, nowIso: now.toISOString() };
}

const SEED_CSV_PATH = 'chat/seed/철광석-입고계획-2610.csv';
const SEED_CSV = ['입고예정일,원료,공급업체,수량(t)', '2026-10-05,ORE01 철광석,가온광업,12000', '2026-10-08,ORE01 철광석,가온광업,9000'].join('\n');

/** 시드 첨부의 내용 (경로 → data URL). 시드로 초기화해도 지워지지 않는다 (mock/fileStorage.ts) */
export const SEED_FILES: Readonly<Record<string, string>> = {
  [SEED_CSV_PATH]: `data:text/csv;charset=utf-8,${encodeURIComponent(SEED_CSV)}`,
};

const SEED_CSV_BYTES = new TextEncoder().encode(SEED_CSV).length;

interface SeedTask {
  title: string;
  description: string | null;
  assignee: string;
  creator: string;
  dueDate: string | null;
  linkPath: string | null;
  createdAt: string;
  completedAt?: string;
  /** 업무 지정 알림을 읽은 시각 */
  noticeReadAt?: string;
}

const SEED_TASKS: readonly SeedTask[] = [
  {
    title: '10월 첫째 주 철광석 입고 일정 확인',
    description: '공급업체와 입고예정 일자를 확인하고 발주에 반영해 주세요.',
    assignee: '2207005',
    creator: '1702004',
    dueDate: '2026-10-02',
    linkPath: '/purchase-orders',
    createdAt: '2026-09-29T09:00:00+09:00',
  },
  {
    title: '고객사 납기 협의 결과 정리',
    description: '이번 주 협의한 납기 변경 요청을 수주별로 정리해 주세요.',
    assignee: '2103003',
    creator: '1608002',
    dueDate: '2026-09-30',
    linkPath: '/sales-orders',
    createdAt: '2026-09-28T10:30:00+09:00',
    noticeReadAt: '2026-09-28T11:00:00+09:00',
  },
  {
    title: 'SM355A 열연 검사 기준 확인',
    description: '두께 구간별 항복·인장·연신율 값이 KS와 같은지 확인해 주세요.',
    assignee: '2205013',
    creator: '1802012',
    dueDate: '2026-10-01',
    linkPath: '/quality/standards',
    createdAt: '2026-09-29T15:20:00+09:00',
  },
  {
    title: '코일 야드 적재 위치 점검',
    description: null,
    assignee: '2304015',
    creator: '1610014',
    dueDate: '2026-09-30',
    linkPath: '/inventories',
    createdAt: '2026-09-29T08:40:00+09:00',
    completedAt: '2026-09-30T16:20:00+09:00',
    noticeReadAt: '2026-09-29T09:10:00+09:00',
  },
  {
    title: '신규 입사자 사원 등록',
    description: '10월 입사자 2명의 사원번호를 만들고 역할을 지정해 주세요.',
    assignee: '1503001',
    creator: '1503001',
    dueDate: '2026-10-05',
    linkPath: '/admin/employees',
    createdAt: '2026-09-30T13:00:00+09:00',
  },
  {
    title: '출하요청 서류 양식 공유',
    description: null,
    assignee: '1610014',
    creator: '2103003',
    dueDate: null,
    linkPath: null,
    createdAt: '2026-09-30T17:05:00+09:00',
  },
];

interface SeedMessage {
  sender: string;
  at: string;
  content: string | null;
  file?: { name: string; mimeType: string; path: string; size: number };
}

interface SeedRoom {
  chatRoomType: typeof CHAT_ROOM_TYPE.DIRECT | typeof CHAT_ROOM_TYPE.GROUP;
  chatRoomName: string | null;
  creator: string;
  createdAt: string;
  members: readonly string[];
  messages: readonly SeedMessage[];
  /** 사원번호 → 몇 번째 메시지까지 읽었는지 (1부터, 0 = 하나도 안 읽음). 없으면 보낸 메시지까지만 읽은 상태 */
  readUpTo: Readonly<Record<string, number>>;
}

const SEED_ROOMS: readonly SeedRoom[] = [
  {
    chatRoomType: CHAT_ROOM_TYPE.DIRECT,
    chatRoomName: null,
    creator: '1702004',
    createdAt: '2026-09-29T10:00:00+09:00',
    members: ['1702004', '2207005'],
    messages: [
      { sender: '1702004', at: '2026-09-29T10:02:00+09:00', content: '다은 씨, 10월 첫째 주 철광석 입고 계획 정리한 파일 공유해 줄 수 있어요?' },
      {
        sender: '2207005',
        at: '2026-09-29T10:15:00+09:00',
        content: '네, 입고 계획 파일 보내 드려요.',
        file: { name: '철광석-입고계획-2610.csv', mimeType: 'text/csv', path: SEED_CSV_PATH, size: SEED_CSV_BYTES },
      },
      { sender: '1702004', at: '2026-09-29T10:20:00+09:00', content: '고마워요. 확인하고 발주 일정 맞춰 볼게요.' },
    ],
    readUpTo: { '1702004': 3, '2207005': 2 },
  },
  {
    chatRoomType: CHAT_ROOM_TYPE.GROUP,
    chatRoomName: '출하 조율',
    creator: '2103003',
    createdAt: '2026-09-30T09:00:00+09:00',
    members: ['2103003', '1608002', '1610014', '2304015', '2205013', '1802012'],
    messages: [
      { sender: '2103003', at: '2026-09-30T09:05:00+09:00', content: `다음 주 출하 예정 건(${SEED_CORE.salesOrderNos[1]}, 출하요청 ${SEED_CORE.waitingShipmentRequestNo}) 같이 확인해 주세요.` },
      { sender: '1610014', at: '2026-09-30T09:12:00+09:00', content: '@권예진 코일 야드 적재 위치 점검 결과 공유 부탁해요.' },
      { sender: '2304015', at: '2026-09-30T09:30:00+09:00', content: '점검 끝났어요. 적재 위치는 재고 화면에 맞춰 두었어요.' },
      { sender: '2103003', at: '2026-09-30T10:02:00+09:00', content: '@품질부 출하 전 검사 일정도 알려 주세요.' },
      { sender: '2205013', at: '2026-09-30T10:20:00+09:00', content: '검사 일정은 내일 오전에 공유드릴게요.' },
    ],
    readUpTo: { '2103003': 5, '1608002': 2, '1610014': 5, '2304015': 3, '2205013': 5, '1802012': 1 },
  },
  {
    chatRoomType: CHAT_ROOM_TYPE.GROUP,
    chatRoomName: '원료 수급',
    creator: '1709007',
    createdAt: '2026-09-30T13:50:00+09:00',
    members: ['1709007', '2207005', '1702004', '1401006'],
    messages: [
      { sender: '1709007', at: '2026-09-30T14:00:00+09:00', content: '고로 원료 재고가 빠르게 줄고 있어요. 다음 주 석탄 입고 일정 확인 부탁드려요.' },
      { sender: '2207005', at: '2026-09-30T14:10:00+09:00', content: '@윤성호 석탄 입고예정은 10월 6일이에요. 확정되면 다시 알려 드릴게요.' },
    ],
    readUpTo: { '1709007': 1, '2207005': 2, '1702004': 2, '1401006': 0 },
  },
];

export function seedCollab(tx: MockTx): void {
  const employeeIdOf = (employeeNo: string): number => {
    const employee = tx.tables.employee.find((e) => e.employeeNo === employeeNo);
    if (!employee) throw new Error(`협업 시드: 사원이 없어요 ${employeeNo}`);
    return employee.id;
  };

  // ── 업무와 업무 지정 알림 ──
  for (const seed of SEED_TASKS) {
    const createdTx = at(tx, seed.createdAt);
    const assigneeId = employeeIdOf(seed.assignee);
    const creatorId = employeeIdOf(seed.creator);
    const task = insertRow(createdTx, 'task', {
      title: seed.title,
      description: seed.description,
      assigneeId,
      creatorId,
      dueDate: seed.dueDate,
      taskStatus: seed.completedAt ? TASK_STATUS.DONE : TASK_STATUS.OPEN,
      linkPath: seed.linkPath,
      completedAt: seed.completedAt ? new Date(seed.completedAt).toISOString() : null,
      ...(seed.completedAt ? { updatedAt: new Date(seed.completedAt).toISOString() } : {}),
    });
    if (assigneeId === creatorId) continue;
    const creatorName = tx.tables.employee.find((e) => e.id === creatorId)?.employeeName ?? '';
    const notice = taskAssignedNotice(task, creatorName);
    const rows = createNotifications(createdTx, {
      notificationType: NOTIFICATION_TYPE.TASK_ASSIGNED,
      ...notice,
      recipientEmployeeIds: [assigneeId],
    });
    if (seed.noticeReadAt) {
      const readAt = new Date(seed.noticeReadAt).toISOString();
      for (const row of rows) updateRow(at(tx, seed.noticeReadAt), 'notification', row.id, { isRead: true, readAt });
    }
  }

  // ── 채팅방과 메시지 (멘션 알림은 메시지를 보낼 때와 같은 규칙으로 만든다) ──
  for (const seed of SEED_ROOMS) {
    const createdTx = at(tx, seed.createdAt);
    const room: ChatRoomRow = insertRow(createdTx, 'chatRoom', {
      chatRoomType: seed.chatRoomType,
      chatRoomName: seed.chatRoomName,
      salesOrderId: null,
      createdEmployeeId: employeeIdOf(seed.creator),
    });
    for (const employeeNo of seed.members) {
      insertRow(createdTx, 'chatRoomMember', { chatRoomId: room.id, employeeId: employeeIdOf(employeeNo), lastReadMessageId: null });
    }
    const posted: MessageRow[] = [];
    for (const message of seed.messages) {
      posted.push(
        postMessage(at(tx, message.at), room, employeeIdOf(message.sender), {
          content: message.content,
          file: message.file ?? null,
        }),
      );
    }
    for (const [employeeNo, upTo] of Object.entries(seed.readUpTo)) {
      const employeeId = employeeIdOf(employeeNo);
      const member = tx.tables.chatRoomMember.find((m) => m.chatRoomId === room.id && m.employeeId === employeeId);
      const lastReadMessageId = upTo > 0 ? (posted[upTo - 1]?.id ?? null) : null;
      if (member) updateRow(at(tx, seed.messages[Math.max(upTo, 1) - 1]?.at ?? seed.createdAt), 'chatRoomMember', member.id, { lastReadMessageId });
    }
  }
}
