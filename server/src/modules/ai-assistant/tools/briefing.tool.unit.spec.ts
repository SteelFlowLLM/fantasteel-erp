// 아침 브리핑 묶음 도구 (get_my_briefing, 이슈 #506): 묶음마다 화면과 같은 service를 그 사원으로 부르고,
// 권한이 없거나 해당되지 않는 묶음은 빼며, 읽을 것이 없으면 '없음'이다.
import { ROLE, type AgentCandidateView, type AuthUser, type NotificationView, type PageResult, type Permission, type PurchaseRequisitionSummary, type SalesOrderSummary, type ScheduleEventView, type TaskView } from '@fantasteel/shared';
import type { FactoryAgentService } from '../../factory-agent/factory-agent.service';
import type { NotificationService } from '../../notification/notification.service';
import type { TaskService } from '../../notification/task.service';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import type { SalesOrderService } from '../../sales-order/sales-order.service';
import type { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import { BRIEFING_ROWS, myBriefingTool, type BriefingServices } from './briefing.tool';

const TODAY = '2026-10-22';
const user = (permissions: Partial<Record<Permission, 'VIEW' | 'USE'>>, headDepartmentIds: number[] = []): AuthUser => ({
  employeeId: 7,
  employeeNo: '1702004',
  employeeName: '최준혁',
  roleCode: ROLE.PURCHASE,
  departmentId: 3,
  jobGradeId: 1,
  headDepartmentIds,
  permissions,
});

const pageOf = <T>(all: readonly T[], page: number, size: number): PageResult<T> => ({ items: all.slice((page - 1) * size, page * size), page, size, total: all.length });

const event = (id: number, title: string, startAt: string, endAt: string): ScheduleEventView =>
  ({ id, scheduleEventTitle: title, scheduleEventDescription: null, startAt, endAt, linkPath: null, meetingMinutes: null, attendees: [{ employeeId: 7, employeeName: '최준혁' }], creator: { id: 7, name: '최준혁' }, notionSync: false, notionPageUrl: null }) as unknown as ScheduleEventView;

const task = (id: number, title: string, dueDate: string): TaskView =>
  ({ id, taskTitle: title, taskDescription: null, assigneeId: 7, assigneeName: '최준혁', creatorId: 2, creatorName: '김도윤', dueDate, taskStatus: 'OPEN', createdAt: '', updatedAt: '', messageId: null, linkPath: null }) as TaskView;

const requisition = (id: number): PurchaseRequisitionSummary =>
  ({ id, purchaseRequisitionNo: `PR-2610-000${id}`, purchaseRequisitionStatus: 'WAITING_APPROVAL', itemCode: 'LIM01', itemName: '석회석', requestedTon: '120.000', desiredReceiptDate: '2026-10-30', requesterName: '정다은', departmentName: '구매부', productionPlanNo: null, createdAt: '2026-10-21T01:00:00.000Z' }) as PurchaseRequisitionSummary;

const notification = (id: number, type: NotificationView['notificationType'], read = false): NotificationView => ({
  id,
  notificationType: type,
  notificationContent: `알림 ${id}`,
  linkPath: null,
  messageId: null,
  businessEventId: null,
  readAt: read ? '2026-10-22T00:00:00.000Z' : null,
  createdAt: '2026-10-22T00:30:00.000Z',
});

const candidate = (id: number, draftStatus: AgentCandidateView['draftStatus']): AgentCandidateView =>
  ({ id, actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus, riskType: 'RAW_SHORTAGE', summary: `원료 부족 ${id}`, evidence: {}, payload: {}, confirmerId: null, confirmerName: null, result: null, executionErrorCode: null, executionAttemptCount: 0, rejectReason: null, confirmedAt: null, createdAt: '2026-10-22T01:00:00.000Z', updatedAt: '' }) as AgentCandidateView;

const order = (id: number, dueDate: string, isDueRisk: boolean): SalesOrderSummary =>
  ({ id, salesOrderNo: `SO-2610-00${id}`, customerName: '가람중공업', ownerEmployeeName: '박서영', earliestDueDate: dueDate, isDueRisk }) as SalesOrderSummary;

interface Fixture {
  events: ScheduleEventView[];
  tasks: TaskView[];
  requisitions: PurchaseRequisitionSummary[];
  notifications: NotificationView[];
  candidates: AgentCandidateView[];
  orders: SalesOrderSummary[];
}

const calls: string[] = [];

function services(data: Partial<Fixture>, broken: Partial<Record<keyof Fixture, boolean>> = {}): BriefingServices {
  const f: Fixture = { events: [], tasks: [], requisitions: [], notifications: [], candidates: [], orders: [], ...data };
  const guard = (key: keyof Fixture) => {
    calls.push(key);
    if (broken[key]) throw new Error(`${key} 실패`);
  };
  return {
    scheduleEvents: {
      listMine: async (_u: AuthUser, query: { from?: string; to?: string }) => {
        guard('events');
        expect(query).toEqual({ from: TODAY, to: TODAY });
        return f.events;
      },
    } as unknown as ScheduleEventService,
    tasks: {
      list: async (_u: AuthUser, query: { scope: string; taskStatus: string; page: number; size: number }) => {
        guard('tasks');
        expect(query).toMatchObject({ scope: 'mine', taskStatus: 'OPEN' });
        return pageOf(f.tasks, query.page, query.size);
      },
    } as unknown as TaskService,
    purchasing: {
      listRequisitions: async (_u: AuthUser, query: { approvable?: boolean; page: number; size: number }) => {
        guard('requisitions');
        expect(query.approvable).toBe(true);
        return pageOf(f.requisitions, query.page, query.size);
      },
    } as unknown as PurchasingService,
    notifications: {
      list: async (_u: AuthUser, query: { unreadOnly?: boolean; page: number; size: number }) => {
        guard('notifications');
        const rows = query.unreadOnly ? f.notifications.filter((n) => n.readAt === null) : f.notifications;
        return { ...pageOf(rows, query.page, query.size), unreadCount: f.notifications.filter((n) => n.readAt === null).length };
      },
    } as unknown as NotificationService,
    agent: {
      list: async () => {
        guard('candidates');
        return f.candidates;
      },
    } as unknown as FactoryAgentService,
    salesOrders: {
      list: async (query: { page: number; size: number }) => {
        guard('orders');
        return pageOf(f.orders, query.page, query.size);
      },
    } as unknown as SalesOrderService,
  };
}

const brief = async (s: BriefingServices, u: AuthUser) => (await myBriefingTool(s, () => TODAY).run({}, u)).data as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
});

describe('아침 브리핑 도구 (get_my_briefing)', () => {
  it('사원 본인의 것이라 패널 전용이고 권한 코드가 없다', () => {
    const tool = myBriefingTool(services({}));
    expect(tool.panelOnly).toBe(true);
    expect(tool.access.permissions).toEqual([]);
    expect(tool.definition.name).toBe('get_my_briefing');
    expect(tool.definition.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('부서장이고 수주 조회 권한이 있으면 여섯 묶음이 모두 채워진다', async () => {
    const data = await brief(
      services({
        events: [event(1, '구매 협의', '2026-10-22T01:00:00.000Z', '2026-10-22T02:00:00.000Z')],
        tasks: [task(1, '발주 검토', '2026-10-20'), task(2, '견적서 보내기', '2026-10-22'), task(3, '단가표 정리', '2026-10-25'), task(4, '다음 달 업무', '2026-11-30')],
        requisitions: [requisition(1), requisition(2)],
        notifications: [notification(1, 'TASK_ASSIGNED'), notification(2, 'DUE_RISK'), notification(3, 'MENTION', true)],
        candidates: [candidate(1, 'WAITING_APPROVAL'), candidate(2, 'EXECUTED')],
        orders: [order(1, '2026-10-24', true), order(2, '2026-10-21', true), order(3, '2026-12-01', false)],
      }),
      user({ SALES_ORDER_CREATE: 'VIEW', PURCHASE_REQUISITION_CREATE: 'USE' }, [3]),
    );

    expect(data.기준일).toBe(TODAY);
    expect(data['오늘 내 일정']).toEqual({ '일정 수': 1, 일정: [{ 제목: '구매 협의', 시간: '10:00~11:00', 참석자: ['최준혁'] }] });
    expect(data['마감이 지난 내 업무']).toEqual({ '업무 수': 1, 업무: [{ 업무id: 1, 제목: '발주 검토', 마감일: '2026-10-20', '마감까지 남은 일수': -2, 등록자: '김도윤' }] });
    const soon = data['마감 임박 내 업무 (3일 안)'] as { '업무 수': number; 업무: { 제목: string; '마감까지 남은 일수': number }[] };
    expect(soon['업무 수']).toBe(2);
    expect(soon.업무.map((t) => [t.제목, t['마감까지 남은 일수']])).toEqual([['견적서 보내기', 0], ['단가표 정리', 3]]);
    expect(data['내 결재 대기']).toMatchObject({ '결재 대기 구매요청 수': 2, 구매요청: [{ 구매요청번호: 'PR-2610-0001' }, { 구매요청번호: 'PR-2610-0002' }] });
    // Agent 알림(납기 위험, id 2)은 Agent 묶음에서 세므로 알림 묶음에서는 뺀다
    expect(data['안 읽은 알림']).toMatchObject({ '안 읽은 알림 수(Agent 알림 제외)': 1, 알림: [{ 알림id: 1 }] });
    // 열린 후보만 센다 (반영된 후보는 뺀다). Agent 알림은 납기 위험 하나
    expect(data['열린 Agent 위험']).toMatchObject({ '열린 대응 후보 수': 1, '대응 후보': [{ 후보id: 1 }], '안 읽은 Agent 알림 수': 1, 'Agent 알림': [{ 알림id: 2 }] });
    // 납기 위험 수주만, 납기가 빠른(이미 지난) 것부터
    expect(data['납기 위험 수주']).toMatchObject({ '납기 위험 수주 수': 2, 수주: [{ 수주번호: 'SO-2610-002', '납기까지 남은 일수': -1 }, { 수주번호: 'SO-2610-001', '납기까지 남은 일수': 2 }] });
    expect(data).not.toHaveProperty('제외한 묶음');
  });

  it('먼저 할 일 후보는 급한 순서(지난 업무 → 납기 위험 수주 → Agent 위험 → 결재 → 일정 → 임박 업무 → 알림)로 앞에서 3개만 고른다', async () => {
    const full = await brief(
      services({
        events: [event(1, '구매 협의', '2026-10-22T01:00:00.000Z', '2026-10-22T02:00:00.000Z')],
        tasks: [task(1, '발주 검토', '2026-10-20'), task(2, '견적서 보내기', '2026-10-22')],
        requisitions: [requisition(1)],
        notifications: [notification(1, 'TASK_ASSIGNED')],
        candidates: [candidate(1, 'WAITING_APPROVAL')],
        orders: [order(2, '2026-10-21', true)],
      }),
      user({ SALES_ORDER_CREATE: 'VIEW', PURCHASE_REQUISITION_CREATE: 'USE' }, [3]),
    );
    expect(full['먼저 할 일 후보(급한 순서, 최대 3)']).toEqual([
      '마감이 지난 내 업무 1건 (가장 오래된 것: 발주 검토, 마감 2026-10-20)',
      '납기 위험 수주 1건 (가장 이른 것: SO-2610-002 가람중공업, 납기 2026-10-21, 1일 지남)',
      '열린 Agent 위험: 열린 Agent 대응 후보 1건, 안 읽은 Agent 알림 0건 (예: 원료 부족 1)',
    ]);
    // 키 순서도 같은 우선순위다
    expect(Object.keys(full)).toEqual(['기준일', '먼저 할 일 후보(급한 순서, 최대 3)', '마감이 지난 내 업무', '납기 위험 수주', '열린 Agent 위험', '내 결재 대기', '오늘 내 일정', '마감 임박 내 업무 (3일 안)', '안 읽은 알림']);

    // 위쪽 묶음이 비면 아래 묶음이 올라온다
    const light = await brief(services({ events: [event(1, '구매 협의', '2026-10-22T01:00:00.000Z', '2026-10-22T02:00:00.000Z')], notifications: [notification(1, 'TASK_ASSIGNED')] }), user({}, []));
    expect(light['먼저 할 일 후보(급한 순서, 최대 3)']).toEqual(['오늘 일정 1건 (첫 일정: 구매 협의 10:00)', '안 읽은 알림 1건']);
    const nothing = await brief(services({}), user({}, []));
    expect(nothing['먼저 할 일 후보(급한 순서, 최대 3)']).toBe('없음');
  });

  it('부서장이 아니면 결재 묶음을, 수주 조회 권한이 없으면 납기 묶음을 빼고 이유를 알리며, 그 service는 부르지 않는다', async () => {
    const data = await brief(services({ requisitions: [requisition(1)], orders: [order(1, '2026-10-24', true)] }), user({}, []));
    expect(data).not.toHaveProperty('내 결재 대기');
    expect(data).not.toHaveProperty('납기 위험 수주');
    expect(data['제외한 묶음']).toEqual([
      { 묶음: '내 결재 대기', 이유: expect.stringContaining('부서장이 아니라') },
      { 묶음: '납기 위험 수주', 이유: expect.stringContaining('수주 등록 조회 권한이 없어') },
    ]);
    expect(calls).not.toContain('requisitions');
    expect(calls).not.toContain('orders');
    // 나머지 묶음은 그대로 있다
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['오늘 내 일정', '마감이 지난 내 업무', '안 읽은 알림', '열린 Agent 위험']));
  });

  it('읽을 것이 없는 묶음은 없음이다', async () => {
    const data = await brief(services({}), user({ SALES_ORDER_CREATE: 'VIEW' }, [3]));
    expect(data['오늘 내 일정']).toBe('없음');
    expect(data['마감이 지난 내 업무']).toBe('없음');
    expect(data['마감 임박 내 업무 (3일 안)']).toBe('없음');
    expect(data['내 결재 대기']).toBe('없음');
    expect(data['안 읽은 알림']).toBe('없음');
    expect(data['열린 Agent 위험']).toBe('없음');
    expect(data['납기 위험 수주']).toBe('없음');
  });

  it('후보를 볼 권한이 없는 사원에게는 후보 칸 없이 Agent 알림만 있다', async () => {
    const withAlert = await brief(services({ candidates: [candidate(1, 'WAITING_APPROVAL')], notifications: [notification(2, 'QUALITY_RATE_RISE')] }), user({}));
    expect(withAlert['열린 Agent 위험']).toEqual({ '안 읽은 Agent 알림 수': 1, 'Agent 알림': [expect.objectContaining({ 알림id: 2 })] });
    expect(calls).not.toContain('candidates');
    const nothing = await brief(services({ candidates: [candidate(1, 'WAITING_APPROVAL')] }), user({}));
    expect(nothing['열린 Agent 위험']).toBe('없음');
  });

  it('묶음마다 줄 수를 줄이고 더 있는 수를 알린다', async () => {
    const many = Array.from({ length: 9 }, (_, i) => requisition(i + 1));
    const data = await brief(services({ requisitions: many }), user({}, [3]));
    const approval = data['내 결재 대기'] as { '결재 대기 구매요청 수': number; 구매요청: unknown[]; '더 있는 수': number };
    expect(approval['결재 대기 구매요청 수']).toBe(9);
    expect(approval.구매요청).toHaveLength(BRIEFING_ROWS);
    expect(approval['더 있는 수']).toBe(9 - BRIEFING_ROWS);
  });

  it('한 묶음이 실패해도 나머지 묶음은 준다', async () => {
    const data = await brief(services({ tasks: [task(1, '발주 검토', '2026-10-20')] }, { notifications: true, events: true }), user({}, []));
    expect(data['오늘 내 일정']).toEqual({ 오류: '이 묶음은 조회하지 못했어요' });
    expect(data['안 읽은 알림']).toEqual({ 오류: '이 묶음은 조회하지 못했어요' });
    expect(data['마감이 지난 내 업무']).toMatchObject({ '업무 수': 1 });
  });

  it('업무는 100건이 넘으면 쪽을 넘겨 읽고, 읽지 못한 수를 알린다', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => task(i + 1, `업무 ${i + 1}`, '2026-12-31'));
    const data = await brief(services({ tasks: many }), user({}, []));
    expect(data['마감이 지난 내 업무']).toBe('없음');
    expect(data['확인하지 못한 업무 수']).toBe(200);
  });

  it('출처 이름이 붙는다 (오늘 브리핑)', async () => {
    expect((await myBriefingTool(services({}), () => TODAY).run({}, user({}, []))).label).toBe('오늘 브리핑');
  });
});
