// 철강맨AI 조회 도구 보강 (이슈 #506): 알림함·Agent 위험·결재함·초안·기준정보·지난 회의·내 심층 조사. 가짜 service로 도구의 모양과 권한을 본다.
import {
  AI_RESEARCH_STATUS,
  NOTIFICATION_TYPE,
  ROLE,
  type ActionDraftView,
  type AgentCandidateView,
  type AiResearchRunSummaryView,
  type AuthUser,
  type NotificationView,
  type PageResult,
  type Permission,
  type PurchaseRequisitionSummary,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { AiResearchService } from '../../ai-research/ai-research.service';
import type { FactoryAgentService } from '../../factory-agent/factory-agent.service';
import type { MasterDataService } from '../../master-data/master-data.service';
import type { MeetingDigest, MeetingMinutesService } from '../../meeting-minutes/meeting-minutes.service';
import type { MessageActionService } from '../../message-action/message-action.service';
import type { NotificationService } from '../../notification/notification.service';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import { agentRiskTool } from './agent.tool';
import { myActionDraftsTool } from './action-draft.tool';
import { myApprovalsTool } from './approval.tool';
import { ToolArgumentError } from './assistant-tool';
import { masterDataTool } from './master-data.tool';
import { matchesWords, meetingMinutesTool } from './meeting-minutes.tool';
import { collectNotifications, myNotificationsTool } from './notification.tool';
import { myResearchTool } from './research.tool';

const user = (permissions: Partial<Record<Permission, 'VIEW' | 'USE'>> = {}, headDepartmentIds: number[] = []): AuthUser => ({
  employeeId: 7,
  employeeNo: '0000007',
  employeeName: '사원',
  roleCode: ROLE.PURCHASE,
  departmentId: 3,
  jobGradeId: 1,
  headDepartmentIds,
  permissions,
});

function pageOf<T>(all: readonly T[], page: number, size: number): PageResult<T> {
  return { items: all.slice((page - 1) * size, page * size), page, size, total: all.length };
}

// ── 알림 ─────────────────────────────────────────────────

const notification = (id: number, type: NotificationView['notificationType'], read: boolean, content = `알림 ${id}`): NotificationView => ({
  id,
  notificationType: type,
  notificationContent: content,
  linkPath: '/agent',
  messageId: null,
  businessEventId: null,
  readAt: read ? '2026-10-22T00:00:00.000Z' : null,
  createdAt: `2026-10-22T0${id % 10}:30:00.000Z`,
});

/** 알림 API처럼 최신순(id 큰 것이 앞) */
function fakeNotifications(all: readonly NotificationView[]) {
  const sorted = [...all].sort((a, b) => b.id - a.id);
  const queries: { unreadOnly?: boolean; page?: number; size?: number }[] = [];
  const service = {
    list: async (_user: AuthUser, query: { unreadOnly?: boolean; page?: number; size?: number }) => {
      queries.push(query);
      const rows = query.unreadOnly ? sorted.filter((n) => n.readAt === null) : sorted;
      return { ...pageOf(rows, query.page ?? 1, query.size ?? 20), unreadCount: sorted.filter((n) => n.readAt === null).length };
    },
  } as unknown as NotificationService;
  return { service, queries };
}

describe('내 알림함 (get_my_notifications)', () => {
  const all = [notification(1, 'MENTION', true), notification(2, 'TASK_ASSIGNED', false), notification(3, 'DUE_RISK', true), notification(4, 'APPROVAL_REQUESTED', false), notification(5, 'MENTION', true)];

  it('사원 본인의 것이라 패널 전용이고 권한 코드가 없다', () => {
    const tool = myNotificationsTool(fakeNotifications([]).service);
    expect(tool.panelOnly).toBe(true);
    expect(tool.access.permissions).toEqual([]);
  });

  it('안 읽은 알림을 먼저, 그다음 읽은 알림을 최신순으로 준다', async () => {
    const { service } = fakeNotifications(all);
    const output = await myNotificationsTool(service).run({}, user());
    const data = output.data as { '안 읽은 알림 수': number; 알림: { 알림id: number; 읽음: boolean; 유형: string }[]; '생략 줄 수': number };
    expect(data['안 읽은 알림 수']).toBe(2);
    expect(data.알림.map((n) => n.알림id)).toEqual([4, 2, 5, 3, 1]);
    expect(data.알림.slice(0, 2).every((n) => !n.읽음)).toBe(true);
    expect(data.알림[0].유형).toBe('승인 요청');
    expect(data['생략 줄 수']).toBe(0);
  });

  it('unreadOnly면 안 읽은 알림만, type이면 그 유형만 고른다', async () => {
    const { service } = fakeNotifications(all);
    const unread = await myNotificationsTool(service).run({ unreadOnly: true }, user());
    expect((unread.data as { 알림: unknown[] }).알림).toHaveLength(2);
    expect(unread.label).toBe('내 알림 · 안 읽음');
    const mention = await myNotificationsTool(service).run({ type: 'MENTION' }, user());
    expect((mention.data as { 알림: { 알림id: number }[] }).알림.map((n) => n.알림id)).toEqual([5, 1]);
    await expect(myNotificationsTool(service).run({ type: 'NOPE' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('15건을 넘으면 안 읽은 알림 수는 정확히 알리고 넘친 줄 수를 알린다', async () => {
    const many = Array.from({ length: 30 }, (_, i) => notification(i + 1, 'MENTION', i % 2 === 0));
    const { service } = fakeNotifications(many);
    const data = (await myNotificationsTool(service).run({}, user())).data as { '안 읽은 알림 수': number; 알림: unknown[]; '생략 줄 수': number };
    expect(data['안 읽은 알림 수']).toBe(15);
    expect(data.알림).toHaveLength(15);
    expect(data['생략 줄 수']).toBe(15);
  });

  it('유형을 거를 때 안 읽은 알림만 먼저 읽고, 모자라야 최근 읽은 알림 한 쪽을 더 읽는다 (읽은 알림을 10쪽까지 읽지 않는다)', async () => {
    // 읽은 알림 1,000건 + 안 읽은 Agent 알림 3건
    const read = Array.from({ length: 1000 }, (_, i) => notification(i + 1, 'DUE_RISK', true));
    const unread = [notification(2001, 'DUE_RISK', false), notification(2002, 'AGENT_CANDIDATE', false), notification(2003, 'MENTION', false)];
    const { service, queries } = fakeNotifications([...read, ...unread]);
    const found = await collectNotifications(service, user(), { types: [NOTIFICATION_TYPE.DUE_RISK, NOTIFICATION_TYPE.AGENT_CANDIDATE] });
    expect(queries).toEqual([
      { unreadOnly: true, page: 1, size: 100 },
      { unreadOnly: false, page: 1, size: 100 },
    ]);
    expect(found.unread).toBe(2);
    expect(found.rows.slice(0, 2).map((n) => n.id)).toEqual([2002, 2001]);
    expect(found.rows).toHaveLength(15);
    // 이미 읽은 안 읽은 알림 목록을 넘기면 다시 읽지 않는다
    queries.length = 0;
    const again = await collectNotifications(service, user(), { types: [NOTIFICATION_TYPE.DUE_RISK], unreadOnly: true, unread: { rows: unread, unscanned: 0 } });
    expect(queries).toEqual([]);
    expect(again.rows.map((n) => n.id)).toEqual([2001]);
  });

  it('유형을 거를 때 100건이 넘으면 쪽을 넘겨 읽고, 읽지 못한 수를 알린다', async () => {
    const many = Array.from({ length: 1100 }, (_, i) => notification(i + 1, i % 2 === 0 ? 'DUE_RISK' : 'MENTION', false));
    const { service, queries } = fakeNotifications(many);
    const found = await collectNotifications(service, user(), { types: [NOTIFICATION_TYPE.DUE_RISK] });
    expect(queries.map((q) => q.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(found.unscanned).toBe(100);
    expect(found.unread).toBe(500);
    expect(found.rows).toHaveLength(15);
  });
});

// ── Agent ────────────────────────────────────────────────

const candidate = (id: number, riskType: AgentCandidateView['riskType'], draftStatus: AgentCandidateView['draftStatus']): AgentCandidateView => ({
  id,
  actionType: riskType === 'RAW_SHORTAGE' ? 'PURCHASE_REQUISITION_CREATE' : 'REPRODUCTION_PLAN_CREATE',
  draftStatus,
  riskType,
  summary: `요약 ${id}`,
  evidence: {},
  payload: {},
  confirmerId: null,
  confirmerName: null,
  result: null,
  executionErrorCode: null,
  executionAttemptCount: 0,
  rejectReason: null,
  confirmedAt: null,
  createdAt: '2026-10-22T01:00:00.000Z',
  updatedAt: '2026-10-22T01:00:00.000Z',
});

describe('공장 Agent 위험 (get_agent_risks)', () => {
  const candidates = [candidate(1, 'RAW_SHORTAGE', 'WAITING_APPROVAL'), candidate(2, 'GOOD_QTY_SHORTAGE', 'EXECUTED'), candidate(3, 'RAW_SHORTAGE', 'REJECTED'), candidate(4, 'GOOD_QTY_SHORTAGE', 'AI_GENERATED')];
  const agentOptions: unknown[] = [];
  // 서비스처럼 openOnly면 처리 전인 후보만 읽는다
  const agent = {
    list: async (_u: AuthUser, options?: { openOnly?: boolean }) => {
      agentOptions.push(options);
      return options?.openOnly ? candidates.filter((c) => c.draftStatus !== 'EXECUTED' && c.draftStatus !== 'REJECTED') : candidates;
    },
  } as unknown as FactoryAgentService;
  const alerts = fakeNotifications([notification(10, 'DUE_RISK', false, '[Agent] 납기 위험: SO-1'), notification(11, 'QUALITY_RATE_RISE', true), notification(12, 'MENTION', false), notification(13, 'AGENT_CANDIDATE', false, '[Agent 대응 후보] 원료 부족: LIM01')]);
  const tool = agentRiskTool(agent, alerts.service);
  const purchaser = user({ PURCHASE_REQUISITION_CREATE: 'VIEW' });

  it('열린 후보(확정 대기·확정 전)만 최근 것부터 주고, 처리가 끝난 후보는 includeClosed일 때만 준다', async () => {
    const data = (await tool.run({}, purchaser)).data as Record<string, unknown>;
    expect(data['열린 대응 후보 수']).toBe(2);
    expect((data['대응 후보'] as { 후보id: number }[]).map((c) => c.후보id)).toEqual([4, 1]);
    const all = (await tool.run({ includeClosed: true }, purchaser)).data as Record<string, unknown>;
    expect(all['대응 후보 수']).toBe(4);
    expect((all['대응 후보'] as { 후보id: number }[]).map((c) => c.후보id)).toEqual([4, 1, 3, 2]);
  });

  it('끝난 후보는 includeClosed일 때만 service에서 읽는다 (처리 전인 후보만 묻는다)', async () => {
    agentOptions.length = 0;
    await tool.run({}, purchaser);
    await tool.run({ includeClosed: true }, purchaser);
    expect(agentOptions).toEqual([{ openOnly: true }, { openOnly: false }]);
  });

  it('후보 한 줄에는 한글 표시명이 있고 영문 코드가 없다', async () => {
    const [first] = ((await tool.run({}, purchaser)).data as { '대응 후보': Record<string, unknown>[] })['대응 후보'];
    expect(first).toMatchObject({ 위험: '합격 매수 부족', '대응 업무': '재생산 계획 생성', 상태: '생성' });
    expect(JSON.stringify(first)).not.toMatch(/RAW_SHORTAGE|GOOD_QTY_SHORTAGE|WAITING_APPROVAL/);
  });

  it('Agent 알림은 대응 후보·납기 위험·불합격률 상승만, 안 읽은 것 먼저 준다', async () => {
    const data = (await tool.run({}, purchaser)).data as { '안 읽은 Agent 알림 수': number; 'Agent 알림': { 알림id: number }[] };
    expect(data['안 읽은 Agent 알림 수']).toBe(2);
    expect(data['Agent 알림'].map((n) => n.알림id)).toEqual([13, 10, 11]);
  });

  it('riskType을 주면 그 위험만: 알림형 위험은 후보 없이 알림만', async () => {
    const due = (await tool.run({ riskType: 'DUE_RISK' }, purchaser)).data as Record<string, unknown>;
    expect(due['열린 대응 후보 수']).toBe(0);
    expect((due['Agent 알림'] as { 알림id: number }[]).map((n) => n.알림id)).toEqual([10]);
    const raw = (await tool.run({ riskType: 'RAW_SHORTAGE' }, purchaser)).data as Record<string, unknown>;
    expect((raw['대응 후보'] as { 후보id: number }[]).map((c) => c.후보id)).toEqual([1]);
    expect((raw['Agent 알림'] as { 알림id: number }[]).map((n) => n.알림id)).toEqual([13]);
    await expect(tool.run({ riskType: 'NOPE' }, purchaser)).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('후보를 만드는 업무의 조회 권한이 하나도 없으면 후보를 service에 묻지 않고 알림만 준다', async () => {
    let asked = 0;
    const guarded = agentRiskTool({ list: async () => (asked += 1, candidates) } as unknown as FactoryAgentService, alerts.service);
    const data = (await guarded.run({}, user({}))).data as Record<string, unknown>;
    expect(asked).toBe(0);
    expect(data['대응 후보 안내']).toContain('구매요청 등록');
    expect(data).not.toHaveProperty('대응 후보');
    expect(data['안 읽은 Agent 알림 수']).toBe(2);
  });

  it('사원 본인의 목록이라 패널 전용이다', () => {
    expect(tool.panelOnly).toBe(true);
  });
});

// ── 결재함 ───────────────────────────────────────────────

const requisition = (id: number): PurchaseRequisitionSummary =>
  ({
    id,
    purchaseRequisitionNo: `PR-2610-000${id}`,
    purchaseRequisitionStatus: 'WAITING_APPROVAL',
    itemId: 1,
    itemCode: 'LIM01',
    itemName: '석회석',
    defaultSupplierId: null,
    defaultSupplierName: null,
    requestedTon: '120.000',
    desiredReceiptDate: '2026-10-30',
    requesterId: 9,
    requesterName: '정다은',
    departmentId: 3,
    departmentName: '구매부',
    approverId: null,
    approverName: null,
    approvedAt: null,
    productionPlanId: null,
    productionPlanNo: null,
    actionDraftId: null,
    purchaseOrderNo: null,
    rejectedAt: null,
    createdAt: '2026-10-21T01:00:00.000Z',
    updatedAt: '2026-10-21T01:00:00.000Z',
  }) as PurchaseRequisitionSummary;

describe('내 결재함 (get_my_approvals)', () => {
  const queries: unknown[] = [];
  const purchasing = {
    listRequisitions: async (_user: AuthUser, query: unknown) => {
      queries.push(query);
      return pageOf([requisition(1), requisition(2)], 1, 15);
    },
  } as unknown as PurchasingService;
  const tool = myApprovalsTool(purchasing);

  it('부서장이면 승인함(approvable) 구매요청을 요청자·원료와 함께 준다', async () => {
    const data = (await tool.run({}, user({}, [3]))).data as { '결재 대기 구매요청 수': number; 구매요청: Record<string, unknown>[] };
    expect(queries.at(-1)).toMatchObject({ approvable: true });
    expect(data['결재 대기 구매요청 수']).toBe(2);
    expect(data.구매요청[0]).toMatchObject({ 구매요청번호: 'PR-2610-0001', 상태: '승인 대기', 원료: 'LIM01 석회석', '요청 톤': '120.000', 요청자: '정다은(구매부)', 요청일: '2026-10-21' });
  });

  it('요청일은 서울 날짜다 (UTC로 전날 저녁이어도 서울 새벽이면 그날)', async () => {
    const late = myApprovalsTool({ listRequisitions: async () => pageOf([{ ...requisition(1), createdAt: '2026-10-21T20:00:00.000Z' }], 1, 15) } as unknown as PurchasingService);
    const row = ((await late.run({}, user({}, [3]))).data as { 구매요청: { 요청일: string }[] }).구매요청[0];
    expect(row.요청일).toBe('2026-10-22');
  });

  it('부서장이 아니면 service를 부르지 않고 결재함이 없다고 알린다', async () => {
    queries.length = 0;
    const data = (await tool.run({}, user({ PURCHASE_REQUISITION_CREATE: 'USE' }, []))).data as Record<string, unknown>;
    expect(queries).toHaveLength(0);
    expect(data['결재 대기 구매요청 수']).toBe(0);
    expect(data.안내).toContain('부서장이 아니라');
    expect(data).not.toHaveProperty('구매요청');
  });

  it('패널 전용이다', () => {
    expect(tool.panelOnly).toBe(true);
  });
});

// ── 초안 ────────────────────────────────────────────────

const draft = (id: number, draftStatus: ActionDraftView['draftStatus'], extra: Partial<ActionDraftView> = {}): ActionDraftView =>
  ({
    id,
    actionType: 'PURCHASE_REQUISITION_CREATE',
    draftStatus,
    payload: { itemId: 1, requestedTon: '50.000', desiredReceiptDate: '2026-11-01', requestReason: null, sourceText: null, aiFilledFields: [] },
    itemCode: 'ORE01',
    itemName: '철광석',
    itemDefaultSupplierName: null,
    requesterId: 7,
    requesterName: '사원',
    requesterDepartmentName: '구매부',
    requesterJobGradeName: '사원',
    message: { id: 1, chatRoomId: 1, chatRoomName: '구매 업무방', chatRoomType: 'WORK', senderName: '정다은', content: '철광석 50톤 11월 1일까지 필요해요', createdAt: '2026-10-21T01:00:00.000Z' },
    meetingMinutes: null,
    unresolvedFields: [],
    payloadLabels: {},
    result: null,
    executionErrorCode: null,
    executionAttemptCount: 0,
    rejectReason: null,
    confirmedAt: null,
    createdAt: '2026-10-21T01:00:00.000Z',
    updatedAt: '2026-10-21T01:00:00.000Z',
    ...extra,
  }) as ActionDraftView;

describe('내 Message→ERP 초안 (get_my_action_drafts)', () => {
  const drafts = [draft(5, 'EXECUTED', { result: { table: 'purchase_requisition', id: 1, no: 'PR-2610-0001', status: 'WAITING_APPROVAL' } }), draft(4, 'REJECTED', { rejectReason: '중복' }), draft(3, 'APPROVED', { executionErrorCode: 'PUR-001', executionAttemptCount: 2 }), draft(2, 'WAITING_APPROVAL', { unresolvedFields: ['원료'] })];
  const asked: unknown[] = [];
  const tool = myActionDraftsTool({
    list: async (u: AuthUser, query: unknown) => {
      asked.push([u.employeeId, query]);
      return drafts;
    },
  } as unknown as MessageActionService);

  it('내 초안만 service에 묻고, 기본은 처리할 초안(확인 대기·확정 뒤 실행 실패)만 준다', async () => {
    const data = (await tool.run({}, user())).data as { '초안 수': number; 초안: Record<string, unknown>[] };
    expect(asked.at(-1)).toEqual([7, {}]);
    expect(data['초안 수']).toBe(2);
    expect(data.초안.map((d) => d.초안id)).toEqual([3, 2]);
    expect(data.초안[0]).toMatchObject({ '업무 유형': '구매요청 생성', 상태: '확정', '실행 오류 코드': 'PUR-001', '실행 시도': 2, 원료: 'ORE01 철광석', '요청 톤': '50.000' });
    expect(data.초안[1]).toMatchObject({ 상태: '확인 대기', '확인할 칸': ['원료'] });
    expect(String(data.초안[1]['원본 메시지'])).toBe('구매 업무방 · 정다은: 철광석 50톤 11월 1일까지 필요해요');
  });

  it('status를 주면 그 상태만 준다 (반려 사유·만든 업무 번호 포함)', async () => {
    const rejected = (await tool.run({ status: 'REJECTED' }, user())).data as { 초안: Record<string, unknown>[] };
    expect(rejected.초안).toHaveLength(1);
    expect(rejected.초안[0]).toMatchObject({ '반려 사유': '중복' });
    const done = (await tool.run({ status: 'EXECUTED' }, user())).data as { 초안: Record<string, unknown>[] };
    expect(done.초안[0]).toMatchObject({ '만든 업무': 'PR-2610-0001' });
    await expect(tool.run({ status: 'X' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('원본 메시지 글은 80자까지만 보낸다', async () => {
    const long = myActionDraftsTool({ list: async () => [draft(1, 'WAITING_APPROVAL', { message: { ...drafts[0].message!, content: '가'.repeat(300) } })] } as unknown as MessageActionService);
    const row = ((await long.run({}, user())).data as { 초안: Record<string, string>[] }).초안[0];
    expect(row['원본 메시지'].length).toBeLessThan(120);
  });

  it('패널 전용이다', () => {
    expect(tool.panelOnly).toBe(true);
  });
});

// ── 기준정보 ────────────────────────────────────────────

describe('기준정보 (get_master_data)', () => {
  const masterData = {
    listCustomers: async () => [
      { id: 1, customerCode: 'CUS-01', customerName: '가람중공업' },
      { id: 2, customerCode: 'CUS-02', customerName: '나래조선' },
    ],
    listSuppliers: async () => [{ id: 1, supplierCode: 'SUP-01', supplierName: '가온광업' }],
    listSteelGrades: async () => [
      { id: 1, steelGradeCode: 'SS275', steelGradeName: 'SS275', standardNo: 'KS D 3503:2026', updatedAt: '', codeLockedBy: ['품목'] },
      { id: 2, steelGradeCode: 'SM355A', steelGradeName: 'SM355A', standardNo: 'KS D 3515:2018', updatedAt: '', codeLockedBy: [] },
    ],
    listSpecMappings: async () => [
      {
        id: 1,
        steelGradeId: 1,
        steelGradeCode: 'SS275',
        slabItem: { id: 1, itemCode: 'SL-SS275-250x1200x10000', thicknessMm: '250.00', widthMm: '1200.00', lengthMm: '10000.00', theoreticalWeightTon: '23.550' },
        coilItem: { id: 2, itemCode: 'CO-SS275-2.5x1200x980000', thicknessMm: '2.50', widthMm: '1200.00', lengthMm: '980000.00', theoreticalWeightTon: '23.079' },
        hotRollingYieldRate: '0.9800',
        updatedAt: '',
      },
    ],
  } as unknown as MasterDataService;
  const tool = masterDataTool(masterData);

  it('기준정보 관리 조회 권한을 도구 모음이 먼저 확인한다 (권한이 없으면 service를 부르지 않는다)', () => {
    expect(tool.access).toEqual({ checkedBy: 'TOOLBOX', permissions: ['MASTER_MANAGE'] });
    expect(tool.panelOnly).toBeUndefined();
  });

  it('고객사·공급업체·강종·규격 매핑을 한글 이름으로 준다', async () => {
    expect((await tool.run({ kind: 'customers' }, user())).data).toMatchObject({ '고객사 수': 2, 목록: [{ 고객사코드: 'CUS-01', 고객사: '가람중공업' }, { 고객사코드: 'CUS-02' }] });
    expect((await tool.run({ kind: 'suppliers' }, user())).data).toMatchObject({ '공급업체 수': 1, 목록: [{ 공급업체: '가온광업' }] });
    const grades = (await tool.run({ kind: 'steel_grades' }, user())).data as { 목록: Record<string, unknown>[] };
    expect(grades.목록[0]).toEqual({ 강종코드: 'SS275', 강종: 'SS275', '적용 규격 번호': 'KS D 3503:2026' });
    const mapping = ((await tool.run({ kind: 'spec_mappings' }, user())).data as { 목록: Record<string, unknown>[] }).목록[0];
    expect(mapping).toMatchObject({
      강종: 'SS275',
      '슬래브 치수(두께×너비×길이 mm)': '250×1200×10000',
      '코일 치수(두께×너비×길이 mm)': '2.5×1200×980000',
      '코일 1개 이론중량 톤': '23.079',
      '열연 계획 수율': '98.0%',
    });
  });

  it('keyword로 코드·이름을 거르고 (띄어쓰기·대소문자 무시), 모르는 종류는 인자 오류', async () => {
    expect(((await tool.run({ kind: 'customers', keyword: '나래' }, user())).data as { 목록: unknown[] }).목록).toHaveLength(1);
    expect(((await tool.run({ kind: 'steel_grades', keyword: 'sm 355a' }, user())).data as { 목록: unknown[] }).목록).toHaveLength(1);
    expect(((await tool.run({ kind: 'steel_grades', keyword: 'KS D 3515' }, user())).data as { 목록: unknown[] }).목록).toHaveLength(1);
    expect(((await tool.run({ kind: 'spec_mappings', keyword: 'sm355' }, user())).data as { 목록: unknown[] }).목록).toHaveLength(0);
    await expect(tool.run({ kind: 'yards' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({}, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('15줄을 넘으면 넘친 줄 수를 알린다', async () => {
    const many = masterDataTool({ listCustomers: async () => Array.from({ length: 40 }, (_, i) => ({ id: i, customerCode: `C${i}`, customerName: `고객${i}` })) } as unknown as MasterDataService);
    const data = (await many.run({ kind: 'customers' }, user())).data as { '고객사 수': number; 목록: unknown[]; '생략 줄 수': number };
    expect(data['고객사 수']).toBe(40);
    expect(data.목록).toHaveLength(15);
    expect(data['생략 줄 수']).toBe(25);
  });
});

// ── 지난 회의 ───────────────────────────────────────────

const digest = (id: number, date: string, title: string, summary: string | null, decisions: string[] = []): MeetingDigest => ({
  id,
  meetingMinutesTitle: title,
  meetingDate: date,
  meetingMinutesStatus: 'CONFIRMED',
  attendeeCount: 3,
  creatorId: 1,
  creatorName: '김도윤',
  createdAt: `${date}T01:00:00.000Z`,
  summary,
  decisions,
});

describe('지난 회의 검색 (search_meeting_minutes)', () => {
  const meetings = [
    digest(4, '2026-10-20', '주간 생산 회의', '열연 라인 점검 일정을 논의했어요', ['다음 주 수요일 열연 라인 점검']),
    digest(3, '2026-10-13', '구매 협의', '석회석 단가 인상 요청이 있었어요', ['석회석 단가 협상은 구매부가 맡는다']),
    digest(2, '2026-10-06', '영업 회의', null),
    digest(1, '2026-09-29', '품질 회의', '불합격률 상승 원인을 살폈어요', ['SS275 검사 항목 재확인']),
  ];
  const queries: { meetingMinutesStatus?: string; from?: string; to?: string; page: number; size: number }[] = [];
  const service = {
    searchDigests: async (query: (typeof queries)[number]) => {
      queries.push(query);
      const rows = meetings.filter((m) => (!query.from || m.meetingDate >= query.from) && (!query.to || m.meetingDate <= query.to) && (!query.meetingMinutesStatus || m.meetingMinutesStatus === query.meetingMinutesStatus));
      return pageOf(rows, query.page, query.size);
    },
    // 한 회의를 자세히 볼 때도 전사 칸을 뺀 조회(getDigest)만 쓴다. 전사가 든 get은 부르면 안 된다
    get: async () => {
      throw new Error('전사 원문이 든 상세 조회를 부르면 안 돼요');
    },
    getDigest: async (id: number) => {
      if (id !== 3) throw new AppException('VOC-001');
      return {
        ...digest(3, '2026-10-13', '구매 협의', '검토한 요약', ['석회석 단가 협상은 구매부가 맡는다']),
        attendees: [{ employeeId: 2, employeeName: '박서영', departmentName: '영업부', roleCode: 'SALES' }],
      };
    },
  } as unknown as MeetingMinutesService;
  const tool = meetingMinutesTool(service);

  it('회의록은 전 역할이 열람해서 권한 코드가 없고, 채팅 AI 답에도 쓸 수 있다', () => {
    expect(tool.access).toEqual({ checkedBy: 'TOOLBOX', permissions: [] });
    expect(tool.panelOnly).toBeUndefined();
  });

  it('낱말이 없으면 최근 회의부터 앞 몇 건의 요약·결정사항과 함께 준다', async () => {
    const data = (await tool.run({}, user())).data as { '회의록 수': number; 회의록: Record<string, unknown>[] };
    expect(data['회의록 수']).toBe(4);
    expect(data.회의록.map((m) => m.회의록id)).toEqual([4, 3, 2, 1]);
    expect(data.회의록[0]).toMatchObject({ 제목: '주간 생산 회의', 회의일: '2026-10-20', 상태: '확정', 작성자: '김도윤', 요약: '열연 라인 점검 일정을 논의했어요', 결정사항: ['다음 주 수요일 열연 라인 점검'] });
    expect(data.회의록[2].요약).toBeNull();
  });

  it('제목에 없어도 요약·결정사항의 낱말로 찾는다 (낱말마다 들어 있으면 맞다)', async () => {
    const byDecision = (await tool.run({ keyword: '단가 협상' }, user())).data as { '회의록 수': number; 회의록: { 회의록id: number }[] };
    expect(byDecision.회의록.map((m) => m.회의록id)).toEqual([3]);
    const bySummary = (await tool.run({ keyword: '불합격률' }, user())).data as { 회의록: { 회의록id: number }[] };
    expect(bySummary.회의록.map((m) => m.회의록id)).toEqual([1]);
    const byTitle = (await tool.run({ keyword: '생산회의' }, user())).data as { 회의록: { 회의록id: number }[] };
    expect(byTitle.회의록.map((m) => m.회의록id)).toEqual([4]);
    const none = (await tool.run({ keyword: '없는낱말' }, user())).data as { '회의록 수': number; 회의록: unknown[] };
    expect(none).toMatchObject({ '회의록 수': 0, 회의록: [] });
  });

  it('회의일 범위·상태는 service(DB)에 넘기고, 뒤바뀐 범위는 인자 오류', async () => {
    await tool.run({ from: '2026-10-01', to: '2026-10-15', status: 'CONFIRMED' }, user());
    expect(queries.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-15', meetingMinutesStatus: 'CONFIRMED' });
    const ranged = (await tool.run({ from: '2026-10-01', to: '2026-10-15' }, user())).data as { 회의록: { 회의록id: number }[] };
    expect(ranged.회의록.map((m) => m.회의록id)).toEqual([3, 2]);
    await expect(tool.run({ from: '2026-10-15', to: '2026-10-01' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({ from: '10/01' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({ status: 'X' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('낱말로 찾을 때 100건이 넘으면 쪽을 넘겨 읽는다', async () => {
    const many = Array.from({ length: 230 }, (_, i) => digest(i + 1, '2026-10-01', `회의 ${i + 1}`, i === 229 ? '가격 인상' : null));
    const pages: number[] = [];
    const big = meetingMinutesTool({
      searchDigests: async (query: { page: number; size: number }) => {
        pages.push(query.page);
        return pageOf(many, query.page, query.size);
      },
    } as unknown as MeetingMinutesService);
    const data = (await big.run({ keyword: '가격 인상' }, user())).data as { '회의록 수': number };
    expect(pages).toEqual([1, 2, 3]);
    expect(data['회의록 수']).toBe(1);
  });

  it('meetingMinutesId를 주면 그 회의 하나의 참석자·요약·결정사항을 준다 (없는 id는 인자 오류)', async () => {
    const output = await tool.run({ meetingMinutesId: 3 }, user());
    expect(output.label).toBe('지난 회의 · 구매 협의');
    expect(output.data).toMatchObject({ 회의록id: 3, 요약: '검토한 요약', 결정사항: ['석회석 단가 협상은 구매부가 맡는다'], 참석자: ['박서영(영업부, 영업)'] });
    expect(JSON.stringify(output.data)).not.toContain('transcript');
    await expect(tool.run({ meetingMinutesId: 99 }, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('matchesWords: 띄어쓰기·대소문자를 무시하고 낱말이 모두 있어야 맞다', () => {
    expect(matchesWords(['SS275 검사 항목 재확인'], 'ss275 재확인')).toBe(true);
    expect(matchesWords(['SS275 검사'], 'SS275 재확인')).toBe(false);
    expect(matchesWords([null, undefined, '단가'], '단가')).toBe(true);
    expect(matchesWords(['단가'], '   ')).toBe(false);
  });
});

// ── 심층 조사 ───────────────────────────────────────────

const run = (id: number, status: AiResearchRunSummaryView['status'], extra: Partial<AiResearchRunSummaryView> = {}): AiResearchRunSummaryView => ({
  id,
  question: `질문 ${id}`,
  title: null,
  status,
  stepsUsed: 2,
  maxSteps: 8,
  sourceCount: 4,
  createdAt: '2026-10-22T01:00:00.000Z',
  updatedAt: '2026-10-22T01:10:00.000Z',
  finishedAt: null,
  ...extra,
});

describe('내 심층 조사 (get_my_research)', () => {
  const runs = [run(5, AI_RESEARCH_STATUS.RUNNING), run(4, AI_RESEARCH_STATUS.AWAITING_APPROVAL, { title: '철강 시황' }), run(3, AI_RESEARCH_STATUS.COMPLETED, { finishedAt: '2026-10-21T05:00:00.000Z' }), run(2, AI_RESEARCH_STATUS.FAILED), run(1, AI_RESEARCH_STATUS.CANCELLED)];
  const owners: number[] = [];
  const tool = myResearchTool({
    list: async (u: AuthUser, query: { page?: number; size?: number }) => {
      owners.push(u.employeeId);
      return pageOf(runs, query.page ?? 1, query.size ?? 20);
    },
  } as unknown as AiResearchService);

  it('내 조사만 service에 묻고, 최근 조사부터 상태·진행 단계와 끝나지 않은 조사 수를 준다', async () => {
    const data = (await tool.run({}, user())).data as { '조사 수': number; '끝나지 않은 조사 수': number; 조사: Record<string, unknown>[] };
    expect(owners.at(-1)).toBe(7);
    expect(data['조사 수']).toBe(5);
    expect(data['끝나지 않은 조사 수']).toBe(2);
    expect(data.조사[0]).toMatchObject({ 조사id: 5, 상태: '조사 중', '진행 단계': '2/8', '모은 출처 수': 4 });
    expect(data.조사[1]).toMatchObject({ 제목: '철강 시황', 상태: '계획 확인 대기' });
    expect(String(data.조사[1].안내)).toContain('[시작]');
    expect(data.조사[2]).toHaveProperty('끝난시각');
  });

  it('status를 주면 그 상태만 준다', async () => {
    const failed = (await tool.run({ status: 'FAILED' }, user())).data as { '조사 수': number; 조사: { 조사id: number }[] };
    expect(failed['조사 수']).toBe(1);
    expect(failed.조사[0].조사id).toBe(2);
    await expect(tool.run({ status: 'X' }, user())).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('패널 전용이다', () => {
    expect(tool.panelOnly).toBe(true);
  });
});
