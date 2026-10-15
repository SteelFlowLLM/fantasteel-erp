// Agent 감지·대응 후보·확정을 실제 DB(fs_prod)로 확인한다 (REQ-AGT-001~003·005·006).
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { addDays } from './agent-rules';
import { FactoryAgentService } from './factory-agent.service';

let moduleRef: TestingModule;
let prisma: PrismaService;
let agent: FactoryAgentService;
let salesOrders: SalesOrderService;
let purchaser: AuthUser;
let sales: AuthUser;
let producer: AuthUser;
let customerId: number;
let slabItemId: number;
let seq = 0;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AppException) return e.code;
    throw e;
  }
  throw new Error('오류가 나지 않았습니다');
}

/** 가까운 필요일의 큰 계획 → 원료 순소요가 남는다 */
async function shortPlan() {
  seq += 1;
  const slab = await prisma.item.findFirstOrThrow({ where: { itemType: 'SLAB', steelGrade: { steelGradeCode: 'SM355A' } }, orderBy: { id: 'asc' } });
  const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
  const salesOrder = await prisma.salesOrder.create({
    data: { salesOrderNo: `T-SO-AGT-${seq}`, customerId, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slab.id, orderedQty: 4, dueDate: new Date(`${addDays(seoulToday(), 5)}T00:00:00.000Z`) }] } },
    include: { salesOrderItems: true },
  });
  return prisma.productionPlan.create({ data: { productionPlanNo: `T-PP-AGT-${seq}`, salesOrderItemId: salesOrder.salesOrderItems[0].id, itemId: slab.id, shortageQty: 4, heatCount: 400 } });
}

const draftsOf = (planId: number) =>
  prisma.actionDraft.findMany({ where: { messageId: null, payload: { path: ['agent', 'targetKey'], string_starts_with: `RAW_SHORTAGE:plan:${planId}:` } }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  agent = moduleRef.get(FactoryAgentService);
  salesOrders = moduleRef.get(SalesOrderService);
  const authUsers = moduleRef.get(AuthUserService);
  const load = async (employeeNo: string) => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNo } });
    const user = await authUsers.load(employee.id);
    if (!user) throw new Error(employeeNo);
    return user;
  };
  purchaser = await load('2207005');
  sales = await load('2103003');
  producer = await load('1401006');
  customerId = (await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
  const base = await prisma.item.findUniqueOrThrow({ where: { itemCode: 'SL-SS275-250x1200x10000' } });
  const item = await prisma.item.upsert({
    where: { itemCode: 'SL-AGT-TEST' },
    update: {},
    create: { itemCode: 'SL-AGT-TEST', itemName: 'Agent 테스트 슬래브', itemType: 'SLAB', unitType: 'QTY', steelGradeId: base.steelGradeId, thicknessMm: '250', widthMm: '1200', lengthMm: '10004', theoreticalWeightTon: calcTheoreticalWeightTon('250', '1200', '10004'), defaultYardId: base.defaultYardId },
  });
  slabItemId = item.id;
}, 60_000);

afterAll(async () => {
  await moduleRef?.close();
});

describe('원료 부족 감지 (REQ-AGT-001·002·005)', () => {
  it('순소요가 있는 계획·원료마다 구매요청 후보를 만들고, 다시 돌려도 미처리 초안은 하나뿐이다', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const first = await draftsOf(plan.id);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((d) => d.draftStatus === DRAFT_STATUS.WAITING_APPROVAL && d.requesterId === null)).toBe(true);

    await agent.scanAll();
    expect((await draftsOf(plan.id)).length).toBe(first.length);
  });

  it('구매 부서원이 확정하면 구매요청이 부서장 승인 대기로 만들어진다 (확정자가 요청자)', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);

    const result = await agent.confirm(purchaser, draft.id);

    expect(result).toMatchObject({ executed: true, errorCode: null });
    expect(result.draft).toMatchObject({ draftStatus: DRAFT_STATUS.EXECUTED, confirmerId: purchaser.employeeId });
    const requisition = await prisma.purchaseRequisition.findUniqueOrThrow({ where: { actionDraftId: draft.id } });
    expect(requisition).toMatchObject({ purchaseRequisitionStatus: 'WAITING_APPROVAL', requesterId: purchaser.employeeId, productionPlanId: plan.id });
    const types = (await prisma.businessEvent.findMany({ where: { actionDraftId: draft.id } })).map((e) => e.businessEventType);
    expect(types).toEqual(expect.arrayContaining([BUSINESS_EVENT_TYPE.DRAFT_CREATED, BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED, BUSINESS_EVENT_TYPE.DRAFT_EXECUTED]));
  });

  it('후보 업무의 권한이 없는 사원은 확정할 수 없다 (COM-002)', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    expect(await codeOf(agent.confirm(sales, draft.id))).toBe('COM-002');
  });

  it('위험이 해소됐으면(계획 취소) 확정해도 실행하지 않고 후보를 닫는다', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'CANCELLED' } });

    const result = await agent.confirm(purchaser, draft.id);

    expect(result).toMatchObject({ executed: false, errorCode: 'COM-001' });
    expect(result.draft.draftStatus).toBe(DRAFT_STATUS.REJECTED);
    expect(await prisma.purchaseRequisition.count({ where: { actionDraftId: draft.id } })).toBe(0);
  });

  it('반려하면 사유가 남고, 같은 대상은 다음 감지에서 새 후보가 생긴다', async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    expect(await codeOf(agent.reject(purchaser, draft.id, '  '))).toBe('COM-004');

    const rejected = await agent.reject(purchaser, draft.id, '이미 다른 경로로 조달 중');
    expect(rejected).toMatchObject({ draftStatus: DRAFT_STATUS.REJECTED, rejectReason: '이미 다른 경로로 조달 중' });

    await agent.scanAll();
    const open = (await draftsOf(plan.id)).filter((d) => d.draftStatus === DRAFT_STATUS.WAITING_APPROVAL);
    expect(open.some((d) => d.id === draft.id)).toBe(false);
    expect(open.length).toBeGreaterThan(0);
  });
});

describe('합격 매수 부족 감지 (REQ-AGT-001·003, 이벤트 트리거)', () => {
  it('검사 등록 이벤트로 재생산 후보를 만들고, 생산 부서원이 확정하면 재생산 계획이 생긴다', async () => {
    const created = await salesOrders.create(sales, { customerId, items: [{ itemId: slabItemId, orderedQty: 4, dueDate: '2026-12-31' }] });
    const plan = await prisma.productionPlan.findUniqueOrThrow({ where: { productionPlanNo: created.items[0].productionPlanNo ?? '' } });
    const salesOrderItemId = plan.salesOrderItemId ?? 0;
    // 합격 매수가 모자란 상태: 계획은 닫히고 확보한 매수가 없다
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: 'CANCELLED' } });
    const now = new Date();
    const result = await prisma.productionResult.create({ data: { processType: 'STEELMAKING', converterCode: 'BOF5', productionPlanId: plan.id, startedAt: now, completedAt: now } });
    const heat = await prisma.lot.create({ data: { lotNo: `T-HT-AGT-${plan.id}`, lotType: 'HEAT', steelGradeId: (await prisma.item.findUniqueOrThrow({ where: { id: slabItemId } })).steelGradeId, productionResultId: result.id, initialTon: '250' } });

    await agent.onInspectionRegistered(heat.id);
    await agent.onInspectionRegistered(heat.id);

    const drafts = await prisma.actionDraft.findMany({ where: { messageId: null, payload: { path: ['agent', 'targetKey'], equals: `GOOD_QTY_SHORTAGE:soItem:${salesOrderItemId}` } } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].actionType).toBe('REPRODUCTION_PLAN_CREATE');

    expect(await codeOf(agent.confirm(purchaser, drafts[0].id))).toBe('COM-002');
    const confirmed = await agent.confirm(producer, drafts[0].id);

    expect(confirmed.executed).toBe(true);
    expect(await prisma.productionPlan.count({ where: { salesOrderItemId, isReproduction: true } })).toBe(1);
  });

  it('상황 설명은 LLM 설정이 없으면 규칙 요약을 그대로 돌려준다 (후보는 바뀌지 않는다)', async () => {
    // 개발 PC의 LLM 설정과 관계없이 설정이 없는 경우를 본다
    jest.spyOn(moduleRef.get(LlmSettingsStore), 'read').mockResolvedValue({ baseUrl: 'http://localhost:1', model: null, apiKey: null });
    const [view] = await agent.list(purchaser);
    const explained = await agent.explain(purchaser, view.id);
    expect(explained.draftId).toBe(view.id);
    expect(explained.explanation.length).toBeGreaterThan(0);
    expect((await agent.list(purchaser)).find((v) => v.id === view.id)?.updatedAt).toBe(view.updatedAt);
  });
});
