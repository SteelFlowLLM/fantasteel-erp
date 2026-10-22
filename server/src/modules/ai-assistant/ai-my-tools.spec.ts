// 철강맨AI 조회 도구 보강(이슈 #506)을 실제 앱·DB(fs_collab)로 확인한다: 알림함·Agent 위험·결재함·초안·기준정보·지난 회의·내 심층 조사 도구를
// 권한이 있는 사원과 없는 사원으로, 아침 브리핑 묶음과 대시보드 위젯별 권한을 부른다. LLM은 부르지 않는다.
// 이 묶음의 다른 시험이 같은 DB를 쓰므로 만든 행은 끝에 모두 지운다.
import { Test, type TestingModule } from '@nestjs/testing';
import { AI_RESEARCH_STATUS, DRAFT_STATUS, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantToolbox } from './tools/assistant-toolbox';

let moduleRef: TestingModule;
let prisma: PrismaService;
let toolbox: AssistantToolbox;
/** 최준혁: 구매부 부서장 */
let choi: AuthUser;
/** 정다은: 구매부 사원 */
let jeong: AuthUser;
/** 박서영: 영업부 사원 */
let park: AuthUser;
/** 김도윤: 영업부 부서장 */
let kim: AuthUser;

const TAG = 'T-F2';
const created = { notifications: [] as number[], requisitions: [] as number[], drafts: [] as number[], runs: [] as number[], meetings: [] as number[], tasks: [] as number[], events: [] as number[], salesOrders: [] as number[] };
let seq = 0;
const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 같은 사원이지만 화면 권한도 부서장 자리도 없는 사용자 (권한 없는 쪽 시험용) */
const withoutAccess = (user: AuthUser): AuthUser => ({ ...user, permissions: {}, headDepartmentIds: [] });

async function call(user: AuthUser, name: string, args: Record<string, unknown> = {}): Promise<{ data: Record<string, unknown>; sourceId: string | null; raw: string }> {
  const result = await toolbox.run(user, { id: 'c1', name, arguments: JSON.stringify(args) });
  return { data: JSON.parse(result.content) as Record<string, unknown>, sourceId: result.source?.id ?? null, raw: result.content };
}

async function notify(recipientId: number, type: string, content: string, read = false): Promise<number> {
  const row = await prisma.notification.create({ data: { recipientId, notificationType: type, notificationContent: `${TAG} ${content}`, linkPath: '/agent', readAt: read ? new Date() : null } });
  created.notifications.push(row.id);
  return row.id;
}

async function requisition(requesterId: number, status = 'WAITING_APPROVAL'): Promise<{ id: number; no: string }> {
  seq += 1;
  const item = await prisma.item.findFirstOrThrow({ where: { itemType: 'RAW_MATERIAL' }, orderBy: { id: 'asc' } });
  const no = `${TAG}-PR-${seq}-${Date.now() % 100000}`;
  const row = await prisma.purchaseRequisition.create({ data: { purchaseRequisitionNo: no, itemId: item.id, requestedTon: new Prisma.Decimal('77.500'), desiredReceiptDate: new Date(`${plusDays(10)}T00:00:00.000Z`), requesterId, purchaseRequisitionStatus: status } });
  created.requisitions.push(row.id);
  return { id: row.id, no };
}

async function agentCandidate(riskType: string, actionType: string, summary: string, draftStatus: string = DRAFT_STATUS.WAITING_APPROVAL): Promise<number> {
  seq += 1;
  const row = await prisma.actionDraft.create({
    data: { actionType, draftStatus, payload: { agent: { riskType, targetKey: `${TAG}:${riskType}:${seq}:${Date.now()}`, detectedOn: seoulToday(), summary, evidence: {} } } },
  });
  created.drafts.push(row.id);
  return row.id;
}

async function meeting(creatorId: number, input: { title: string; date: string; status?: string; summary?: string | null; decisions?: string[] }): Promise<number> {
  const analysis = input.decisions ? { summary: `AI ${input.title} 요약`, decisions: input.decisions.map((text) => ({ text, evidence: [0] })), candidates: [], model: 'test', analyzedAt: '2026-10-20T00:00:00.000Z' } : null;
  const row = await prisma.meetingMinutes.create({
    data: {
      meetingMinutesTitle: `${TAG} ${input.title}`,
      meetingDate: new Date(`${input.date}T00:00:00.000Z`),
      meetingMinutesStatus: input.status ?? 'CONFIRMED',
      summary: input.summary ?? null,
      ...(analysis ? { analysisResult: analysis } : {}),
      creatorId,
      attendees: { create: [{ employeeId: creatorId }] },
    },
  });
  created.meetings.push(row.id);
  return row.id;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  toolbox = moduleRef.get(AssistantToolbox);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  choi = await load('1702004');
  jeong = await load('2207005');
  park = await load('2103003');
  kim = await load('1608002');
}, 60_000);

afterAll(async () => {
  await prisma?.notification.deleteMany({ where: { id: { in: created.notifications } } });
  await prisma?.salesOrderItem.deleteMany({ where: { salesOrderId: { in: created.salesOrders } } });
  await prisma?.salesOrder.deleteMany({ where: { id: { in: created.salesOrders } } });
  await prisma?.actionDraft.deleteMany({ where: { id: { in: created.drafts } } });
  await prisma?.purchaseRequisition.deleteMany({ where: { id: { in: created.requisitions } } });
  await prisma?.aiResearchRun.deleteMany({ where: { id: { in: created.runs } } });
  await prisma?.task.deleteMany({ where: { id: { in: created.tasks } } });
  await prisma?.scheduleEventAttendee.deleteMany({ where: { scheduleEventId: { in: created.events } } });
  await prisma?.scheduleEvent.deleteMany({ where: { id: { in: created.events } } });
  await prisma?.meetingAttendee.deleteMany({ where: { meetingMinutesId: { in: created.meetings } } });
  await prisma?.meetingMinutes.deleteMany({ where: { id: { in: created.meetings } } });
  await moduleRef?.close();
});

describe('도구 목록: 사원 본인의 것은 패널 전용', () => {
  const PERSONAL = ['get_my_briefing', 'get_my_notifications', 'get_my_approvals', 'get_my_action_drafts', 'get_agent_risks', 'get_my_research'];

  it('사내 채팅 @AI에는 알리지 않고, 철강맨AI 패널에만 알린다', () => {
    const chat = toolbox.definitions({}).map((d) => d.name);
    const panel = toolbox.definitions({ actionCards: true }).map((d) => d.name);
    for (const name of PERSONAL) {
      expect(chat).not.toContain(name);
      expect(panel).toContain(name);
    }
    expect(chat).toEqual(expect.arrayContaining(['get_master_data', 'search_meeting_minutes', 'read_knowledge']));
  });

  it('채팅에 남은 답을 멤버에게 보일지: 본인 것은 누구에게도, 기준정보는 권한이 있는 멤버에게만, 지난 회의는 모두에게', () => {
    for (const name of PERSONAL) expect(toolbox.canViewAll(choi, [name])).toBe(false);
    expect(toolbox.canViewAll(kim, ['get_master_data'])).toBe(true);
    expect(toolbox.canViewAll(withoutAccess(kim), ['get_master_data'])).toBe(false);
    expect(toolbox.canViewAll(withoutAccess(kim), ['search_meeting_minutes'])).toBe(true);
  });
});

describe('내 알림함 (get_my_notifications)', () => {
  it('내 알림만, 안 읽은 것 먼저 준다. 남의 알림은 오지 않는다', async () => {
    const readId = await notify(jeong.employeeId, 'MENTION', '읽은 알림', true);
    const unreadId = await notify(jeong.employeeId, 'TASK_ASSIGNED', '안 읽은 알림');
    const choiId = await notify(choi.employeeId, 'APPROVAL_REQUESTED', '최준혁의 알림');

    const mine = await call(jeong, 'get_my_notifications');
    const rows = mine.data.알림 as { 알림id: number; 내용: string; 읽음: boolean }[];
    const ids = rows.map((n) => n.알림id);
    expect(ids).toEqual(expect.arrayContaining([unreadId, readId]));
    expect(ids).not.toContain(choiId);
    expect(ids.indexOf(unreadId)).toBeLessThan(ids.indexOf(readId));
    expect(rows.every((n) => !n.내용.includes('최준혁의 알림'))).toBe(true);
    expect(mine.sourceId).toBe('get_my_notifications');

    const unreadOnly = await call(jeong, 'get_my_notifications', { unreadOnly: true });
    expect((unreadOnly.data.알림 as { 읽음: boolean }[]).every((n) => !n.읽음)).toBe(true);
    const others = await call(choi, 'get_my_notifications');
    expect((others.data.알림 as { 알림id: number }[]).map((n) => n.알림id)).toContain(choiId);
    expect((others.data.알림 as { 알림id: number }[]).map((n) => n.알림id)).not.toContain(unreadId);
  });
});

describe('내 결재함 (get_my_approvals)', () => {
  it('부서장은 자기 부서원의 승인 대기 구매요청만 본다 (내 요청과 다른 부서 요청은 제외)', async () => {
    const fromJeong = await requisition(jeong.employeeId);
    const own = await requisition(choi.employeeId);
    const approved = await requisition(jeong.employeeId, 'APPROVED');

    const inbox = await call(choi, 'get_my_approvals');
    const numbers = (inbox.data.구매요청 as { 구매요청번호: string }[]).map((r) => r.구매요청번호);
    expect(numbers).toContain(fromJeong.no);
    expect(numbers).not.toContain(own.no);
    expect(numbers).not.toContain(approved.no);
    expect(inbox.data['결재 대기 구매요청 수']).toBeGreaterThanOrEqual(1);
    expect(inbox.sourceId).toBe('get_my_approvals');

    // 영업부장은 부서장이지만 구매부 요청의 승인권자가 아니다
    const sales = await call(kim, 'get_my_approvals');
    expect(((sales.data.구매요청 ?? []) as { 구매요청번호: string }[]).map((r) => r.구매요청번호)).not.toContain(fromJeong.no);
  });

  it('부서장이 아닌 사원에게는 결재함이 없다고만 알린다 (구매요청 번호를 주지 않는다)', async () => {
    const pending = await requisition(jeong.employeeId);
    for (const user of [jeong, withoutAccess(choi)]) {
      const none = await call(user, 'get_my_approvals');
      expect(none.data['결재 대기 구매요청 수']).toBe(0);
      expect(none.data.안내).toContain('부서장이 아니라');
      expect(none.raw).not.toContain(pending.no);
    }
  });
});

describe('내 Message→ERP 초안 (get_my_action_drafts)', () => {
  it('내가 확정할 초안만 주고, 남의 초안·Agent 후보는 주지 않는다', async () => {
    const meetingId = await meeting(choi.employeeId, { title: '초안 원본 회의', date: plusDays(-3) });
    const item = await prisma.item.findFirstOrThrow({ where: { itemType: 'RAW_MATERIAL' }, orderBy: { id: 'asc' } });
    const payload = { itemId: item.id, requestedTon: '55.000', desiredReceiptDate: plusDays(14), requestReason: null, sourceText: null, aiFilledFields: [] };
    const mine = await prisma.actionDraft.create({ data: { actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus: DRAFT_STATUS.WAITING_APPROVAL, payload, meetingMinutesId: meetingId, requesterId: jeong.employeeId } });
    const rejected = await prisma.actionDraft.create({ data: { actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus: DRAFT_STATUS.REJECTED, payload, meetingMinutesId: meetingId, requesterId: jeong.employeeId, rejectReason: `${TAG} 중복 요청` } });
    const theirs = await prisma.actionDraft.create({ data: { actionType: 'PURCHASE_REQUISITION_CREATE', draftStatus: DRAFT_STATUS.WAITING_APPROVAL, payload, meetingMinutesId: meetingId, requesterId: choi.employeeId } });
    created.drafts.push(mine.id, rejected.id, theirs.id);
    const candidateId = await agentCandidate('RAW_SHORTAGE', 'PURCHASE_REQUISITION_CREATE', `${TAG} 후보 요약`);

    const open = await call(jeong, 'get_my_action_drafts');
    const openIds = (open.data.초안 as { 초안id: number }[]).map((d) => d.초안id);
    expect(openIds).toContain(mine.id);
    expect(openIds).not.toContain(rejected.id);
    expect(openIds).not.toContain(theirs.id);
    expect(openIds).not.toContain(candidateId);
    const row = (open.data.초안 as Record<string, unknown>[]).find((d) => d.초안id === mine.id);
    expect(row).toMatchObject({ '업무 유형': '구매요청 생성', 상태: '확인 대기', 원료: `${item.itemCode} ${item.itemName}`, '요청 톤': '55.000', '원본 회의록': `${TAG} 초안 원본 회의` });

    const closed = await call(jeong, 'get_my_action_drafts', { status: 'REJECTED' });
    expect((closed.data.초안 as { 초안id: number; '반려 사유': string }[]).find((d) => d.초안id === rejected.id)?.['반려 사유']).toBe(`${TAG} 중복 요청`);

    const choiDrafts = await call(choi, 'get_my_action_drafts');
    const choiIds = (choiDrafts.data.초안 as { 초안id: number }[]).map((d) => d.초안id);
    expect(choiIds).toContain(theirs.id);
    expect(choiIds).not.toContain(mine.id);
  });
});

describe('공장 Agent 위험 (get_agent_risks)', () => {
  it('후보는 그 후보가 만드는 업무의 조회 권한이 있는 사원에게만 보인다', async () => {
    const purchase = await agentCandidate('RAW_SHORTAGE', 'PURCHASE_REQUISITION_CREATE', `${TAG} 석회석 원료 부족`);
    const reproduction = await agentCandidate('GOOD_QTY_SHORTAGE', 'REPRODUCTION_PLAN_CREATE', `${TAG} SS275 합격 매수 부족`);
    const closed = await agentCandidate('RAW_SHORTAGE', 'PURCHASE_REQUISITION_CREATE', `${TAG} 이미 반영됨`, DRAFT_STATUS.EXECUTED);
    const idsOf = (data: Record<string, unknown>) => ((data['대응 후보'] ?? []) as { 후보id: number }[]).map((c) => c.후보id);

    const full = await call(jeong, 'get_agent_risks');
    expect(idsOf(full.data)).toEqual(expect.arrayContaining([purchase, reproduction]));
    expect(idsOf(full.data)).not.toContain(closed);
    expect(full.sourceId).toBe('get_agent_risks');
    expect((full.data['대응 후보'] as Record<string, unknown>[]).find((c) => c.후보id === purchase)).toMatchObject({ 위험: '원료 부족', '대응 업무': '구매요청 생성', 상태: '확인 대기', 요약: `${TAG} 석회석 원료 부족` });
    expect(idsOf((await call(jeong, 'get_agent_risks', { includeClosed: true })).data)).toContain(closed);
    expect(idsOf((await call(jeong, 'get_agent_risks', { riskType: 'GOOD_QTY_SHORTAGE' })).data)).toContain(reproduction);
    expect(idsOf((await call(jeong, 'get_agent_risks', { riskType: 'GOOD_QTY_SHORTAGE' })).data)).not.toContain(purchase);

    // 생산계획·히트 편성 조회 권한만 있는 사원은 재생산 후보만 본다
    const onlyProduction: AuthUser = { ...jeong, permissions: { PRODUCTION_PLAN_CONFIRM: 'VIEW' } };
    const partial = await call(onlyProduction, 'get_agent_risks');
    expect(idsOf(partial.data)).toContain(reproduction);
    expect(idsOf(partial.data)).not.toContain(purchase);

    // 후보를 만드는 업무의 조회 권한이 하나도 없으면 후보 칸 없이 안내만
    const nobody = await call(withoutAccess(jeong), 'get_agent_risks');
    expect(nobody.data).not.toHaveProperty('대응 후보');
    expect(nobody.data['대응 후보 안내']).toContain('조회 권한이 있는 사원만');
    expect(nobody.raw).not.toContain(`${TAG} 석회석 원료 부족`);
  });

  it('Agent 알림은 내 알림 중 대응 후보·납기 위험·불합격률 상승만 준다', async () => {
    const due = await notify(park.employeeId, 'DUE_RISK', '납기 위험 수주');
    const mention = await notify(park.employeeId, 'MENTION', '멘션');
    const others = await notify(choi.employeeId, 'QUALITY_RATE_RISE', '최준혁의 불합격률 알림');
    const result = await call(park, 'get_agent_risks', { riskType: 'DUE_RISK' });
    const ids = (result.data['Agent 알림'] as { 알림id: number }[]).map((n) => n.알림id);
    expect(ids).toContain(due);
    expect(ids).not.toContain(mention);
    expect(ids).not.toContain(others);
    expect(result.data['안 읽은 Agent 알림 수']).toBeGreaterThanOrEqual(1);
    // 알림형 위험은 후보 없이 알림만
    expect(result.data['열린 대응 후보 수']).toBe(0);
  });
});

describe('기준정보 (get_master_data)', () => {
  it('기준정보 관리 조회 권한이 있으면 고객사·공급업체·강종·규격 매핑을 준다', async () => {
    const customers = await call(kim, 'get_master_data', { kind: 'customers' });
    expect((customers.data.목록 as { 고객사: string }[]).map((c) => c.고객사)).toContain('가람중공업');
    expect(customers.sourceId).toBe('get_master_data');
    const suppliers = await call(kim, 'get_master_data', { kind: 'suppliers', keyword: '가온' });
    expect(suppliers.data.목록).toEqual([{ 공급업체코드: 'SUP-01', 공급업체: '가온광업' }]);
    const grades = await call(kim, 'get_master_data', { kind: 'steel_grades', keyword: 'ss275' });
    expect(grades.data.목록).toEqual([{ 강종코드: 'SS275', 강종: 'SS275', '적용 규격 번호': 'KS D 3503:2026' }]);
    const mappings = await call(kim, 'get_master_data', { kind: 'spec_mappings', keyword: 'SS275' });
    const mapping = (mappings.data.목록 as Record<string, unknown>[])[0];
    expect(mapping).toMatchObject({ 강종: 'SS275', '슬래브 치수(두께×너비×길이 mm)': '250×1200×10000' });
    expect(String(mapping['열연 계획 수율'])).toMatch(/^\d+\.\d%$/);
  });

  it('권한이 없으면 아무 기준정보도 주지 않고 조회할 수 있는 역할을 알려 준다', async () => {
    const denied = await call(withoutAccess(kim), 'get_master_data', { kind: 'customers' });
    expect(denied.data.오류).toBe('권한 없음');
    expect(denied.data.안내).toContain("'기준정보 관리'");
    expect(denied.data['조회할 수 있는 역할']).toEqual(expect.arrayContaining(['영업', '관리자']));
    expect(denied.sourceId).toBeNull();
    expect(denied.raw).not.toContain('가람중공업');
  });
});

describe('지난 회의 검색 (search_meeting_minutes)', () => {
  it('제목·요약·결정사항의 낱말로 찾고 회의일·상태로 좁힌다 (전 역할이 열람)', async () => {
    const decided = await meeting(choi.employeeId, { title: '구매 단가 협의', date: plusDays(-5), summary: '석회석 납품 일정을 논의했어요', decisions: ['석회석 F2단가협상은 11월에 다시 한다', '월간 입고 일정표를 만든다'] });
    const planning = await meeting(kim.employeeId, { title: '영업 F2계획 회의', date: plusDays(-40), status: 'REVIEW', summary: null });

    const byDecision = await call(jeong, 'search_meeting_minutes', { keyword: 'F2단가협상' });
    const rows = byDecision.data.회의록 as { 회의록id: number; 제목: string; 요약: string; 결정사항: string[] }[];
    expect(rows.map((r) => r.회의록id)).toEqual([decided]);
    expect(rows[0]).toMatchObject({ 제목: `${TAG} 구매 단가 협의`, 요약: '석회석 납품 일정을 논의했어요', 결정사항: ['석회석 F2단가협상은 11월에 다시 한다', '월간 입고 일정표를 만든다'] });
    expect(byDecision.sourceId).toBe('search_meeting_minutes');

    // 권한 코드와 상관없이 같은 결과 (회의록은 전 역할이 열람)
    const noAccess = await call(withoutAccess(jeong), 'search_meeting_minutes', { keyword: 'F2단가협상' });
    expect((noAccess.data.회의록 as { 회의록id: number }[]).map((r) => r.회의록id)).toEqual([decided]);

    const byTitle = await call(jeong, 'search_meeting_minutes', { keyword: 'F2계획' });
    expect((byTitle.data.회의록 as { 회의록id: number }[]).map((r) => r.회의록id)).toEqual([planning]);

    const recent = await call(jeong, 'search_meeting_minutes', { keyword: TAG, from: plusDays(-10), to: plusDays(0) });
    const recentIds = (recent.data.회의록 as { 회의록id: number }[]).map((r) => r.회의록id);
    expect(recentIds).toContain(decided);
    expect(recentIds).not.toContain(planning);
    const reviewing = await call(jeong, 'search_meeting_minutes', { keyword: TAG, status: 'REVIEW' });
    expect((reviewing.data.회의록 as { 회의록id: number }[]).map((r) => r.회의록id)).toEqual([planning]);
    const none = await call(jeong, 'search_meeting_minutes', { keyword: '존재하지않는낱말xyz' });
    expect(none.data['회의록 수']).toBe(0);
  });

  it('meetingMinutesId로 한 회의를 자세히 읽고, 없는 id는 이유를 알린다. 전사 원문은 주지 않는다', async () => {
    const id = await meeting(choi.employeeId, { title: '상세 회의', date: plusDays(-2), summary: '검토한 요약', decisions: ['열연 라인 점검'] });
    await prisma.meetingMinutes.update({ where: { id }, data: { transcript: '비밀 전사 원문 문장', transcriptSegments: [{ start: null, end: null, text: '비밀 전사 원문 문장' }] } });
    const detail = await call(jeong, 'search_meeting_minutes', { meetingMinutesId: id });
    expect(detail.data).toMatchObject({ 회의록id: id, 요약: '검토한 요약', 결정사항: ['열연 라인 점검'] });
    expect(detail.raw).not.toContain('비밀 전사 원문 문장');
    const missing = await call(jeong, 'search_meeting_minutes', { meetingMinutesId: 99999999 });
    expect(missing.data.오류).toContain('회의록 id 99999999가 없어요');
  });
});

describe('내 심층 조사 (get_my_research)', () => {
  it('내 조사만 진행 상태와 함께 준다. 남의 조사는 오지 않는다', async () => {
    const run = async (employeeId: number, status: string, question: string) => {
      const row = await prisma.aiResearchRun.create({ data: { employeeId, question: `${TAG} ${question}`, status, budget: { maxSteps: 8, maxSources: 12 }, stepsUsed: status === AI_RESEARCH_STATUS.RUNNING ? 3 : 8, ...(status === AI_RESEARCH_STATUS.COMPLETED ? { finishedAt: new Date() } : {}) } });
      created.runs.push(row.id);
      return row.id;
    };
    const running = await run(jeong.employeeId, AI_RESEARCH_STATUS.RUNNING, '철강 시황 조사');
    const done = await run(jeong.employeeId, AI_RESEARCH_STATUS.COMPLETED, '합금철 가격 조사');
    const theirs = await run(choi.employeeId, AI_RESEARCH_STATUS.RUNNING, '최준혁의 비밀 조사');

    const mine = await call(jeong, 'get_my_research');
    const rows = mine.data.조사 as { 조사id: number; 상태: string; '진행 단계': string }[];
    expect(rows.map((r) => r.조사id)).toEqual(expect.arrayContaining([running, done]));
    expect(rows.map((r) => r.조사id)).not.toContain(theirs);
    expect(mine.raw).not.toContain('최준혁의 비밀 조사');
    expect(rows.find((r) => r.조사id === running)).toMatchObject({ 상태: '조사 중', '진행 단계': '3/8' });
    expect(rows.find((r) => r.조사id === done)?.상태).toBe('완료');
    expect(mine.data['끝나지 않은 조사 수']).toBeGreaterThanOrEqual(1);

    const onlyDone = await call(jeong, 'get_my_research', { status: 'COMPLETED' });
    expect((onlyDone.data.조사 as { 조사id: number }[]).map((r) => r.조사id)).toContain(done);
    expect((onlyDone.data.조사 as { 조사id: number }[]).map((r) => r.조사id)).not.toContain(running);
    expect((await call(choi, 'get_my_research')).raw).not.toContain('철강 시황 조사');
  });
});

describe('아침 브리핑 (get_my_briefing)', () => {
  it('부서장이면 일정·업무·결재·알림·Agent 위험을 한 번에 모으고, 다른 사원의 것은 섞지 않는다', async () => {
    const today = seoulToday();
    const overdue = await prisma.task.create({ data: { taskTitle: `${TAG} 지난 업무`, assigneeId: choi.employeeId, creatorId: kim.employeeId, dueDate: new Date(`${plusDays(-2)}T00:00:00.000Z`) } });
    const soon = await prisma.task.create({ data: { taskTitle: `${TAG} 임박 업무`, assigneeId: choi.employeeId, creatorId: kim.employeeId, dueDate: new Date(`${plusDays(2)}T00:00:00.000Z`) } });
    const later = await prisma.task.create({ data: { taskTitle: `${TAG} 먼 업무`, assigneeId: choi.employeeId, creatorId: kim.employeeId, dueDate: new Date(`${plusDays(30)}T00:00:00.000Z`) } });
    const done = await prisma.task.create({ data: { taskTitle: `${TAG} 끝난 업무`, assigneeId: choi.employeeId, creatorId: kim.employeeId, dueDate: new Date(`${plusDays(-1)}T00:00:00.000Z`), taskStatus: 'DONE' } });
    const jeongTask = await prisma.task.create({ data: { taskTitle: `${TAG} 정다은 업무`, assigneeId: jeong.employeeId, creatorId: kim.employeeId, dueDate: new Date(`${plusDays(-3)}T00:00:00.000Z`) } });
    created.tasks.push(overdue.id, soon.id, later.id, done.id, jeongTask.id);
    const event = await prisma.scheduleEvent.create({ data: { scheduleEventTitle: `${TAG} 구매 협의`, startAt: new Date(`${today}T05:00:00.000Z`), endAt: new Date(`${today}T06:00:00.000Z`), creatorId: choi.employeeId, attendees: { create: [{ employeeId: choi.employeeId }] } } });
    created.events.push(event.id);
    const pending = await requisition(jeong.employeeId);
    await notify(choi.employeeId, 'APPROVAL_REQUESTED', '승인 요청 알림');
    await notify(choi.employeeId, 'DUE_RISK', '납기 위험 알림');
    await agentCandidate('RAW_SHORTAGE', 'PURCHASE_REQUISITION_CREATE', `${TAG} 브리핑 후보`);

    const brief = await call(choi, 'get_my_briefing');
    const data = brief.data;
    expect(brief.sourceId).toBe('get_my_briefing');
    expect(data.기준일).toBe(today);
    // 먼저 할 일 후보는 급한 순서로 읽을 것이 있는 묶음의 한 줄 (지난 업무가 맨 앞)
    const top = data['먼저 할 일 후보(급한 순서, 최대 3)'] as string[];
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top[0]).toContain('마감이 지난 내 업무');
    const titles = (group: unknown) => ((group as { 업무?: { 제목: string }[] }).업무 ?? []).map((t) => t.제목);
    expect(titles(data['마감이 지난 내 업무'])).toContain(`${TAG} 지난 업무`);
    expect(titles(data['마감이 지난 내 업무'])).not.toContain(`${TAG} 끝난 업무`);
    expect(titles(data['마감이 지난 내 업무'])).not.toContain(`${TAG} 정다은 업무`);
    expect(titles(data['마감 임박 내 업무 (3일 안)'])).toContain(`${TAG} 임박 업무`);
    expect(titles(data['마감 임박 내 업무 (3일 안)'])).not.toContain(`${TAG} 먼 업무`);
    expect(JSON.stringify(data['오늘 내 일정'])).toContain(`${TAG} 구매 협의`);
    expect(JSON.stringify(data['오늘 내 일정'])).toContain('14:00~15:00');
    expect((data['내 결재 대기'] as { 구매요청: { 구매요청번호: string }[] }).구매요청.map((r) => r.구매요청번호)).toContain(pending.no);
    // 납기 위험 알림은 Agent 묶음에서 세므로 알림 묶음에는 승인 요청 알림만 센다
    expect((data['안 읽은 알림'] as { '안 읽은 알림 수(Agent 알림 제외)': number })['안 읽은 알림 수(Agent 알림 제외)']).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(data['안 읽은 알림'])).not.toContain('납기 위험 알림');
    const agent = data['열린 Agent 위험'] as { '열린 대응 후보 수': number; '안 읽은 Agent 알림 수': number };
    expect(agent['열린 대응 후보 수']).toBeGreaterThanOrEqual(1);
    expect(agent['안 읽은 Agent 알림 수']).toBeGreaterThanOrEqual(1);
    // 구매부장도 수주 조회 권한(VIEW)이 있어 납기 묶음이 들어간다
    expect(Object.keys(data)).toContain('납기 위험 수주');
    expect(data).not.toHaveProperty('제외한 묶음');
  });

  it('납기 위험 수주는 진행 중 수주에서 읽고 수주 조회 권한이 있는 사원에게만 준다 (아주 오래된 위험 수주도 빠지지 않는다)', async () => {
    const customer = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB' }, orderBy: { id: 'asc' } });
    const salesOrderNo = `${TAG}-SO-${Date.now() % 1000000}`;
    const overdue = await prisma.salesOrder.create({
      data: { salesOrderNo, customerId: customer.id, ownerEmployeeId: kim.employeeId, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 2, dueDate: new Date(`${plusDays(-2000)}T00:00:00.000Z`) }] } },
    });
    created.salesOrders.push(overdue.id);

    const withView = (await call(kim, 'get_my_briefing')).data;
    const section = withView['납기 위험 수주'] as { 수주: { 수주번호: string; '납기까지 남은 일수': number }[] };
    expect(section.수주.map((o) => o.수주번호)).toContain(salesOrderNo);
    expect(section.수주.find((o) => o.수주번호 === salesOrderNo)?.['납기까지 남은 일수']).toBe(-2000);
    expect((withView['먼저 할 일 후보(급한 순서, 최대 3)'] as string[]).some((line) => line.includes('납기 위험 수주'))).toBe(true);

    const withoutView = await call(withoutAccess(kim), 'get_my_briefing');
    expect(withoutView.raw).not.toContain(salesOrderNo);
  });

  it('부서장도 수주 조회 권한도 없는 사원에게는 결재·납기 묶음을 빼고 이유를 알린다', async () => {
    const pending = await requisition(jeong.employeeId);
    const brief = (await call(withoutAccess(choi), 'get_my_briefing')).data;
    expect(brief).not.toHaveProperty('내 결재 대기');
    expect(brief).not.toHaveProperty('납기 위험 수주');
    expect((brief['제외한 묶음'] as { 묶음: string }[]).map((g) => g.묶음)).toEqual(['내 결재 대기', '납기 위험 수주']);
    expect(JSON.stringify(brief)).not.toContain(pending.no);
    expect(Object.keys(brief)).toEqual(expect.arrayContaining(['오늘 내 일정', '마감이 지난 내 업무', '안 읽은 알림', '열린 Agent 위험']));
  });

  it('묶음은 먼저 할 일 후보 → 지난 업무 → (납기) → Agent → (결재) → 일정 → 임박 업무 → 알림 → 제외한 묶음 순서다', async () => {
    const brief = (await call(withoutAccess(jeong), 'get_my_briefing')).data;
    expect(Object.keys(brief)).toEqual(['기준일', '먼저 할 일 후보(급한 순서, 최대 3)', '마감이 지난 내 업무', '열린 Agent 위험', '오늘 내 일정', '마감 임박 내 업무 (3일 안)', '안 읽은 알림', '제외한 묶음']);
    // 후보를 볼 권한이 없으면 Agent 묶음에는 알림 칸만 있다
    const agent = brief['열린 Agent 위험'];
    expect(agent === '없음' || (typeof agent === 'object' && agent !== null && !('대응 후보' in agent))).toBe(true);
  });
});

describe('대시보드 위젯별 권한 (get_dashboard_summary)', () => {
  it('출하 실적 권한만 있는 사원은 공정별 수율을 받지 못한다', async () => {
    const shipmentOnly: AuthUser = { ...kim, permissions: { GOODS_ISSUE_CONFIRM: 'VIEW' } };
    const denied = await call(shipmentOnly, 'get_dashboard_summary', { widget: 'process_yield' });
    expect(denied.data.오류).toBe('권한 없음');
    expect(denied.sourceId).toBeNull();
    const allowed = await call(shipmentOnly, 'get_dashboard_summary', { widget: 'shipment_result' });
    expect(allowed.data.오류).toBeUndefined();
    expect(allowed.sourceId).toBe('get_dashboard_summary:shipment_result');
  });

  it('공정 흐름 현황은 권한이 없어도 받는다', async () => {
    const result = await call(withoutAccess(kim), 'get_dashboard_summary', { widget: 'process_flow' });
    expect(result.data.오류).toBeUndefined();
    expect(result.sourceId).toBe('get_dashboard_summary:process_flow');
    expect(toolbox.canViewAll(withoutAccess(kim), [result.sourceId ?? ''])).toBe(true);
    expect(toolbox.canViewAll(withoutAccess(kim), ['get_dashboard_summary:process_yield'])).toBe(false);
  });
});

describe('KS 규격 읽기 (read_knowledge)', () => {
  it('강종 이름으로 KS 규격 절을 읽는다 (전 역할, 출처는 답의 [KS-8] 표시가 된다)', async () => {
    const result = await call(withoutAccess(kim), 'read_knowledge', { kind: 'ks', id: 'SS275' });
    expect(result.sourceId).toBeNull();
    expect(result.data).toMatchObject({ 종류: 'ks', id: 'KS-8' });
    expect(String(result.data.내용)).toContain('410–550');
  });
});
