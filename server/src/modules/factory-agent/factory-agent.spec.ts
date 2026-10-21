// Agent 감지·대응 후보·확정을 실제 DB(fs_prod)로 확인한다 (REQ-AGT-001~003·005·006).
import { Test, type TestingModule } from '@nestjs/testing';
import { BUSINESS_EVENT_TYPE, DRAFT_STATUS, calcTheoreticalWeightTon, type AuthUser } from '@fantasteel/shared';
import { AppModule } from '../../app.module';
import { AuthUserService } from '../../common/auth/auth-user.service';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { seoulToday } from '../../common/time/seoul-date';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmSettingsStore } from '../llm/llm-settings.store';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { addDays } from './agent-rules';
import { FactoryAgentRepository } from './factory-agent.repository';
import { AGENT_QUIET_DAYS, FactoryAgentService } from './factory-agent.service';

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

const targetKeyOf = (draft: { payload: unknown }) => (draft.payload as { agent: { targetKey: string } }).agent.targetKey;

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
    // 후보를 만든 트랜잭션에 위험 감지 작업 로그를 남긴다 (REQ-LOG-002, #496)
    const detected = await prisma.businessEvent.findMany({ where: { businessEventType: BUSINESS_EVENT_TYPE.AGENT_RISK_DETECTED, actionDraftId: { in: first.map((d) => d.id) } } });
    expect(detected).toHaveLength(first.length);
    expect(detected[0]).toMatchObject({ actorType: 'SYSTEM', actorEmployeeId: null, targetType: 'action_draft' });
    expect(detected[0].afterData).toMatchObject({ riskType: 'RAW_SHORTAGE', targetKey: expect.stringContaining(`RAW_SHORTAGE:plan:${plan.id}:`) });

    await agent.scanAll();
    expect((await draftsOf(plan.id)).length).toBe(first.length);
    expect(await prisma.businessEvent.count({ where: { businessEventType: BUSINESS_EVENT_TYPE.AGENT_RISK_DETECTED, actionDraftId: { in: first.map((d) => d.id) } } })).toBe(first.length);
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

    // 시스템이 닫은 후보는 반려 쉬는 기간에 들지 않는다: 위험이 다시 생기면 바로 새 후보를 만든다
    await prisma.productionPlan.update({ where: { id: plan.id }, data: { productionPlanStatus: plan.productionPlanStatus } });
    await agent.scanAll();
    const again = (await draftsOf(plan.id)).filter((d) => targetKeyOf(d) === targetKeyOf(draft) && d.id !== draft.id);
    expect(again.map((d) => d.draftStatus)).toEqual([DRAFT_STATUS.WAITING_APPROVAL]);
  });

  it(`사람이 반려하면 사유가 남고, 같은 대상은 ${AGENT_QUIET_DAYS}일 동안 새 후보를 만들지 않는다 (#496)`, async () => {
    const plan = await shortPlan();
    await agent.scanAll();
    const [draft] = await draftsOf(plan.id);
    expect(await codeOf(agent.reject(purchaser, draft.id, '  '))).toBe('COM-004');

    const rejected = await agent.reject(purchaser, draft.id, '이미 다른 경로로 조달 중');
    expect(rejected).toMatchObject({ draftStatus: DRAFT_STATUS.REJECTED, rejectReason: '이미 다른 경로로 조달 중' });

    // 다음 감지(24시간 뒤·서버 재시작)에도 같은 대상의 후보는 다시 생기지 않는다
    await agent.scanAll();
    expect((await draftsOf(plan.id)).filter((d) => targetKeyOf(d) === targetKeyOf(draft))).toHaveLength(1);

    // 쉬는 기간이 지나면 위험이 남은 대상은 새 후보가 생긴다
    await prisma.actionDraft.update({ where: { id: draft.id }, data: { updatedAt: new Date(Date.now() - (AGENT_QUIET_DAYS + 1) * 86_400_000) } });
    await agent.scanAll();
    const again = (await draftsOf(plan.id)).filter((d) => targetKeyOf(d) === targetKeyOf(draft) && d.id !== draft.id);
    expect(again.map((d) => d.draftStatus)).toEqual([DRAFT_STATUS.WAITING_APPROVAL]);
  });
});

describe('위험 감지 작업 로그와 감지 큐 (#509)', () => {
  it('위험 감지 작업 로그를 남기지 못하면 후보·초안 생성 로그·알림이 모두 롤백된다', async () => {
    const plan = await shortPlan();
    const owner = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: '2103003' } });
    const setting = await prisma.productionSetting.findFirstOrThrow();
    const dueSoon = await prisma.salesOrder.create({
      data: { salesOrderNo: 'T-SO-AGT-LOGFAIL', customerId, ownerEmployeeId: owner.id, salesOrderItems: { create: [{ itemId: slabItemId, orderedQty: 2, dueDate: new Date(`${addDays(seoulToday(), setting.deliveryRiskDays)}T00:00:00.000Z`) }] } },
    });
    const recorder = moduleRef.get(BusinessEventRecorder);
    const record = recorder.record.bind(recorder);
    const spy = jest
      .spyOn(recorder, 'record')
      .mockImplementation((tx, input) => (input.type === BUSINESS_EVENT_TYPE.AGENT_RISK_DETECTED ? Promise.reject(new Error('작업 로그 실패')) : record(tx, input)));
    try {
      const results = await agent.scanAll();
      expect(results.find((r) => r.riskType === 'RAW_SHORTAGE')?.error).toContain('작업 로그 실패');
      expect(results.find((r) => r.riskType === 'DUE_RISK')?.error).toContain('작업 로그 실패');
    } finally {
      spy.mockRestore();
    }
    expect(await draftsOf(plan.id)).toHaveLength(0);
    expect(await prisma.businessEvent.count({ where: { businessEventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED, reason: { contains: `생산계획 ${plan.productionPlanNo} ` } } })).toBe(0);
    expect(await prisma.notification.count({ where: { notificationContent: { contains: dueSoon.salesOrderNo } } })).toBe(0);

    // 기록이 되살아나면 다음 감지에서 후보와 알림이 함께 생긴다
    await agent.scanAll();
    expect((await draftsOf(plan.id)).length).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { notificationContent: { contains: dueSoon.salesOrderNo } } })).toBe(1);
  });

  it('idle()은 줄 선 감지가 모두 끝날 때까지 기다린다 (기다리는 사이 들어온 감지까지)', async () => {
    const repository = moduleRef.get(FactoryAgentRepository);
    const seen: number[] = [];
    const releases: (() => void)[] = [];
    // 두 감지 모두 풀어 줄 때까지 끝나지 않게 한다: 첫 감지만 기다리고 돌아오면(루프 없이 큐를 한 번만 기다리면) 실패한다
    const pendingFind = (_tx: unknown, lotId: number) => {
      seen.push(lotId);
      return new Promise((resolve) => {
        releases.push(() => resolve(null));
      }) as unknown as ReturnType<FactoryAgentRepository['findSalesOrderItemOfLot']>;
    };
    const settle = async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
    };
    const spy = jest.spyOn(repository, 'findSalesOrderItemOfLot').mockImplementationOnce(pendingFind).mockImplementationOnce(pendingFind);
    try {
      void agent.onInspectionRegistered(-1);
      let idled = false;
      void agent.idle().then(() => {
        idled = true;
      });
      void agent.onInspectionRegistered(-2);
      await settle();
      expect(seen).toEqual([-1]);
      expect(idled).toBe(false);

      releases[0]?.();
      await settle();
      // 첫 감지가 끝나 두 번째가 시작됐지만 아직 끝나지 않았다
      expect(seen).toEqual([-1, -2]);
      expect(idled).toBe(false);

      releases[1]?.();
      await settle();
      expect(idled).toBe(true);
    } finally {
      // 단언이 실패해도 큐가 막혀 뒤 시험이 시간 초과로 번지지 않게 남은 감지를 모두 풀어 준다
      for (const release of releases) release();
      spy.mockRestore();
    }
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
    jest.spyOn(moduleRef.get(LlmSettingsStore), 'read').mockResolvedValue({ baseUrl: 'http://localhost:1', model: null, apiKey: null, visionSupport: null, reasoningSupport: null, contextLength: null });
    const [view] = await agent.list(purchaser);
    const explained = await agent.explain(purchaser, view.id);
    expect(explained.draftId).toBe(view.id);
    expect(explained.explanation.length).toBeGreaterThan(0);
    expect((await agent.list(purchaser)).find((v) => v.id === view.id)?.updatedAt).toBe(view.updatedAt);
  });
});
