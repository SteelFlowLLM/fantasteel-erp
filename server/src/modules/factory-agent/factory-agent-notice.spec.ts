// 대응 후보 알림(AGENT_CANDIDATE)과 같은 대상 미처리 후보 DB 중복 방지를 실제 DB(fs_prod)로 확인한다 (REQ-AGT-004·005, 이슈 #464).
import { Test, type TestingModule } from '@nestjs/testing';
import { ACTION_TYPE, DRAFT_STATUS, NOTIFICATION_TYPE, PERMISSION, PERMISSION_LEVEL, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { seoulToday } from '../../common/time/seoul-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays } from './agent-rules';
import { FactoryAgentRepository } from './factory-agent.repository';
import { AGENT_QUIET_DAYS, FactoryAgentService } from './factory-agent.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let agent: FactoryAgentService;
let repository: FactoryAgentRepository;
let purchaser: AuthUser;
let customerId: number;
let seq = 0;

/** 가까운 필요일의 큰 계획 → 원료 순소요가 남아 구매요청 후보가 생긴다 */
async function shortPlan() {
  seq += 1;
  const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB', steelGrade: { steelGradeCode: 'SM355A' } }, orderBy: { id: 'asc' } });
  const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
  const salesOrder = await prisma.salesOrder.create({
    data: { salesOrderNo: `T-SO-NTC-${seq}`, customerId, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 4, dueDate: new Date(`${addDays(seoulToday(), 5)}T00:00:00.000Z`) }] } },
    include: { salesOrderItems: true },
  });
  return prisma.productionPlan.create({ data: { productionPlanNo: `T-PP-NTC-${seq}`, salesOrderItemId: salesOrder.salesOrderItems[0].id, itemId: slab.id, shortageQty: 4, heatCount: 400 } });
}

/** 후보 하나(원료마다 하나씩 생긴다)에 대한 알림 */
const noticesOf = (draft: { payload: unknown }) => {
  const { summary } = (draft.payload as { agent: { summary: string } }).agent;
  return prisma.notification.findMany({ where: { notificationType: NOTIFICATION_TYPE.AGENT_CANDIDATE, notificationContent: `[Agent 대응 후보] 원료 부족: ${summary}` }, orderBy: { id: 'asc' } });
};
const draftsOf = (planId: number) =>
  prisma.actionDraft.findMany({ where: { messageId: null, payload: { path: ['agent', 'targetKey'], string_starts_with: `RAW_SHORTAGE:plan:${planId}:` } }, orderBy: { id: 'asc' } });

/** 확정 권한(USE)이 있는 재직 사원 */
const confirmers = async (permission: string) =>
  (await prisma.employee.findMany({ where: { isActive: true, role: { rolePermissions: { some: { permission, permissionLevel: PERMISSION_LEVEL.USE } } } }, select: { id: true } })).map((e) => e.id);

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  agent = moduleRef.get(FactoryAgentService);
  repository = moduleRef.get(FactoryAgentRepository);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2207005' } });
  const loaded = await moduleRef.get(AuthUserService).load(employee.id);
  if (!loaded) throw new Error('2207005');
  purchaser = loaded;
  customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('대응 후보 알림 (AGENT_CANDIDATE)', () => {
  it('후보가 생기면 그 업무의 확정 권한이 있는 사원에게만 알리고, 다시 감지해도 같은 알림을 또 보내지 않는다', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    const expected = await confirmers(PERMISSION.PURCHASE_REQUISITION_CREATE);
    expect(expected).toContain(purchaser.employeeId);

    const first = await noticesOf(draft);
    expect(first.map((n) => n.recipientId).sort()).toEqual([...expected].sort());
    const created = await prisma.businessEvent.findFirstOrThrow({ where: { actionDraftId: draft.id, businessEventType: 'DRAFT_CREATED' } });
    expect(first[0]).toMatchObject({ linkPath: '/agent', businessEventId: created.id, readAt: null });
    expect(first[0].notificationContent).toContain('[Agent 대응 후보] 원료 부족');
    // 영업 사원은 구매요청을 만들 권한이 없어 받지 않는다
    const sales = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    expect(first.some((n) => n.recipientId === sales.id)).toBe(false);

    await agent.scanAll();
    expect(await noticesOf(draft)).toHaveLength(first.length);
  });

  it('반려한 후보는 쉬는 기간 동안 다시 알리지 않고, 기간이 지나 새 후보가 생기면 안 읽은 같은 알림이 없는 사원에게만 보낸다', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    const before = await noticesOf(draft);
    const mine = before.find((n) => n.recipientId === purchaser.employeeId);
    if (!mine) throw new Error('구매 사원의 알림이 없어요');
    await prisma.notification.update({ where: { id: mine.id }, data: { readAt: new Date() } });

    await agent.reject(purchaser, draft.id, '이미 조달 중');
    await agent.scanAll();
    // 반려 뒤 다음 감지(24시간 뒤·재시작)에는 같은 대상의 후보도 알림도 다시 생기지 않는다 (#496)
    expect(await noticesOf(draft)).toHaveLength(before.length);

    await prisma.actionDraft.update({ where: { id: draft.id }, data: { updatedAt: new Date(Date.now() - (AGENT_QUIET_DAYS + 1) * 86_400_000) } });
    await agent.scanAll();

    const after = await noticesOf(draft);
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((n) => !before.some((b) => b.id === n.id));
    expect(added.map((n) => n.recipientId)).toEqual([purchaser.employeeId]);
    expect(added[0].businessEventId).not.toBe(mine.businessEventId);
  });
});

describe('같은 대상 미처리 후보 DB unique (REQ-AGT-005)', () => {
  const targetKey = () => `RAW_SHORTAGE:test:${Date.now()}-${seq++}`;
  const payload = (key: string) => ({ itemId: 1, agent: { riskType: 'RAW_SHORTAGE', targetKey: key, detectedOn: seoulToday(), summary: 'DB unique 시험', evidence: {} } }) as unknown as Prisma.InputJsonValue;
  const data = (key: string) => ({ actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE, payload: payload(key) });

  it('같은 대상의 미처리 후보를 직접 또 만들면 DB가 막고, 처리된(반려·실행) 뒤에는 새로 만들 수 있다', async () => {
    const key = targetKey();
    const first = await prisma.actionDraft.create({ data: { ...data(key), draftStatus: DRAFT_STATUS.WAITING_APPROVAL } });
    await expect(prisma.actionDraft.create({ data: { ...data(key), draftStatus: DRAFT_STATUS.AI_GENERATED } })).rejects.toMatchObject({ code: 'P2002' });
    // 다른 대상은 그대로 만들 수 있다
    await expect(prisma.actionDraft.create({ data: data(targetKey()) })).resolves.toBeDefined();

    await prisma.actionDraft.update({ where: { id: first.id }, data: { draftStatus: DRAFT_STATUS.REJECTED } });
    const second = await prisma.actionDraft.create({ data: { ...data(key), draftStatus: DRAFT_STATUS.APPROVED } });
    await prisma.actionDraft.update({ where: { id: second.id }, data: { draftStatus: DRAFT_STATUS.EXECUTED } });
    await expect(prisma.actionDraft.create({ data: data(key) })).resolves.toBeDefined();
  });

  it('메시지 초안·회의록 초안처럼 agent 칸이 없는 초안은 영향받지 않는다', async () => {
    const plain = { actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE, payload: { itemId: 1 } };
    await prisma.actionDraft.create({ data: plain });
    await expect(prisma.actionDraft.create({ data: plain })).resolves.toBeDefined();
  });

  it('후보 저장은 충돌하면 오류 없이 null을 돌려주고, 동시에 만들어도 하나만 남는다', async () => {
    const key = targetKey();
    const results = await Promise.all([1, 2, 3, 4].map(() => prisma.$transaction((tx) => repository.createDraftIfNew(tx, data(key)))));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await prisma.actionDraft.count({ where: { payload: { path: ['agent', 'targetKey'], equals: key } } })).toBe(1);
  });
});
