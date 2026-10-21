import { PERMISSION, ROLE, type AuthUser, type HotRollingDetail, type PastCaseDraftView, type Permission } from '@fantasteel/shared';
import { isInAiAssistedRun } from '../../common/business-event/ai-assisted.context';
import { seoulToday } from '../../common/time/seoul-date';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PastCaseService } from '../past-case/past-case.service';
import type { HotRollingService } from '../production/hot-rolling.service';
import type { ProductionService } from '../production/production.service';
import type { SalesOrderService } from '../sales-order/sales-order.service';
import type { AiAssistantRepository } from './ai-assistant.repository';
import { AiOpsCardService } from './ai-ops-card.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { ToolArgumentError } from './tools/assistant-tool';

const userWith = (...permissions: Permission[]): AuthUser => ({
  employeeId: 1,
  employeeNo: '2205013',
  employeeName: '서민지',
  roleCode: ROLE.SALES,
  departmentId: 1,
  jobGradeId: 1,
  headDepartmentIds: [],
  permissions: Object.fromEntries(permissions.map((p) => [p, 'USE'])) as AuthUser['permissions'],
});
const all = userWith(PERMISSION.SALES_ORDER_CREATE, PERMISSION.HOT_ROLLING_ALLOCATE, PERMISSION.PRODUCTION_PLAN_CONFIRM, PERMISSION.DISPOSITION_SET);
const nobody = userWith();
const plusDays = (days: number): string => new Date(Date.parse(`${seoulToday()}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dto = (over: Partial<ExecuteAiActionCardDto>): ExecuteAiActionCardDto => ({ kind: 'SALES_ORDER', ...over }) as ExecuteAiActionCardDto;

function setup(options: { rollable?: boolean; neededQty?: number; recommended?: number; planStatus?: string; heatCount?: number; draftError?: boolean } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  /** 사례 등록을 부를 때 AI 경유 표시가 켜져 있었는지 (작업 로그 is_ai_assisted) */
  const aiAssistedFlags: boolean[] = [];
  const record = <T>(name: string, result: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return result;
  };
  const repository = {
    findCustomers: async () => [
      { id: 4, customerCode: 'C01', customerName: '한강철강' },
      { id: 5, customerCode: 'C02', customerName: '한강중공업' },
    ],
    findProducts: async () => [
      { id: 9, itemCode: 'CL-SS275-3x1500', itemName: 'SS275 코일' },
      { id: 10, itemCode: 'SL-SS275-250x1500', itemName: 'SS275 슬래브' },
    ],
    findProductionPlanByNo: async (_tx: unknown, no: string) => (no === 'PP-2610-0001' ? { id: 7 } : null),
    findLotByNo: async (_tx: unknown, no: string) => (no === 'HT-1' ? { id: 5 } : null),
  } as unknown as AiAssistantRepository;
  const lots = Array.from({ length: options.recommended ?? 2 }, (_, i) => ({ lotId: 11 + i, lotNo: `L${11 + i}`, producedDate: '2026-10-01', heatNo: null, isRecommended: true }));
  const detail = {
    plan: { productionPlanNo: 'PP-2610-0001' },
    slabItem: { itemCode: 'SL-1', itemName: '슬래브' },
    slabItemCode: 'SL-1',
    neededQty: options.neededQty ?? 2,
    slabPool: { availableQty: 5 },
    isRollable: options.rollable ?? true,
    notRollableReason: '수주에 연결된 계획만 열연해요',
    candidates: lots,
  } as unknown as HotRollingDetail;
  const hotRolling = { detail: async () => detail, confirm: record('hotConfirm', detail) } as unknown as HotRollingService;
  const production = {
    getPlanDetail: async () => ({ productionPlanNo: 'PP-2610-0001', productionPlanStatus: options.planStatus ?? 'PLANNED', itemCode: 'SL-1', itemName: '슬래브', shortageQty: 10, heatCount: options.heatCount ?? 1 }),
    previewHeatPlan: async () => ({ heatCount: 2, heatTon: '30.000', requiredMoltenSteelTon: '40.000' }),
    confirmHeatPlan: record('heatConfirm', { productionPlanNo: 'PP-2610-0001' }),
  } as unknown as ProductionService;
  const draft: PastCaseDraftView = {
    lot: { lotId: 5, lotNo: 'HT-1', lotType: 'HEAT', steelGradeCode: 'SS275' },
    caseCategory: 'QUALITY',
    title: '성분 불합격',
    phenomenon: '규소 초과',
    cause: '',
    actionTaken: '',
    equipmentText: '',
    occurredDate: '2026-10-10',
    aiWritten: false,
    aiNotice: 'AI 초안을 만들지 못해 검사 결과로 초안을 채웠어요.',
    referenceCaseNos: ['CASE-0001'],
  };
  const pastCases = {
    createDraft: async () => {
      if (options.draftError) throw Object.assign(new Error('불합격 판정된 LOT만 사례로 등록할 수 있어요'), { name: 'AppException' });
      return draft;
    },
    create: async (...args: unknown[]) => {
      calls.push({ name: 'pastCreate', args });
      aiAssistedFlags.push(isInAiAssistedRun());
      return { id: 6, caseNo: 'CASE-0006' };
    },
  } as unknown as PastCaseService;
  const salesOrders = { create: record('salesCreate', { salesOrderId: 41, salesOrderNo: 'SO-261016-001', items: [] }) } as unknown as SalesOrderService;
  const prisma = {} as PrismaService;
  return { service: new AiOpsCardService(prisma, repository, salesOrders, hotRolling, production, pastCases), calls, aiAssistedFlags };
}

describe('수주 등록 카드 제안', () => {
  it('고객사·규격 이름을 id로 맞추고 매수·납기를 규칙으로 거른다', async () => {
    const { service } = setup();
    const card = await service.proposeSalesOrder(all, { customerName: '한강철강', lines: [{ itemName: 'SS275 코일', orderedQty: 12, dueDate: plusDays(20) }] });
    expect(card).toMatchObject({ kind: 'SALES_ORDER', customerId: 4, lines: [{ itemId: 9, itemLabel: 'CL-SS275-3x1500 · SS275 코일', orderedQty: 12, dueDate: plusDays(20) }], issues: [] });
  });

  it('여럿에 맞는 이름·정수가 아닌 매수·지난 납기는 비워 두고 사유를 붙인다', async () => {
    const { service } = setup();
    const card = await service.proposeSalesOrder(all, { customerName: '한강', lines: [{ itemName: 'SS275', orderedQty: 1.5, dueDate: plusDays(-2) }] });
    expect(card.customerId).toBeNull();
    expect(card.lines[0]).toMatchObject({ itemId: null, orderedQty: null, dueDate: null });
    expect(card.issues).toEqual(['고객사 "한강"을(를) 찾지 못했어요', '1번째 줄의 규격을 정해 주세요', '1번째 줄의 매수는 1 이상의 정수여야 해요', '1번째 줄의 납기를 확인해 주세요 (오늘부터 1년 안)']);
  });

  it('수주 등록 권한이 없으면 카드를 만들지 않는다', async () => {
    const { service } = setup();
    await expect(service.proposeSalesOrder(nobody, { lines: [] })).rejects.toThrow(ToolArgumentError);
  });
});

describe('열연 배정·히트 편성 카드 제안', () => {
  it('열연 배정: FIFO 추천 슬래브를 카드에 담는다', async () => {
    const { service } = setup();
    const card = await service.proposeHotRolling(all, { productionPlanNo: 'pp-2610-0001' });
    expect(card).toMatchObject({ kind: 'HOT_ROLLING', productionPlanId: 7, neededQty: 2, availableQty: 5, lots: [{ lotId: 11 }, { lotId: 12 }] });
  });

  it('열연 배정: 없는 계획·열연 불가·배정할 것 없음·추천 슬래브 없음은 카드 없이 이유를 돌려준다', async () => {
    await expect(setup().service.proposeHotRolling(all, { productionPlanNo: 'PP-0000-0000' })).rejects.toThrow('찾을 수 없어요');
    await expect(setup({ rollable: false }).service.proposeHotRolling(all, { productionPlanNo: 'PP-2610-0001' })).rejects.toThrow('수주에 연결된');
    await expect(setup({ neededQty: 0 }).service.proposeHotRolling(all, { productionPlanNo: 'PP-2610-0001' })).rejects.toThrow('더 배정할 슬래브가 없어요');
    await expect(setup({ recommended: 0 }).service.proposeHotRolling(all, { productionPlanNo: 'PP-2610-0001' })).rejects.toThrow('가용 재고가 없어요');
    await expect(setup().service.proposeHotRolling(nobody, { productionPlanNo: 'PP-2610-0001' })).rejects.toThrow('사용 권한이 없어요');
  });

  it('히트 편성: 현재 히트 수와 다시 계산한 히트 수를 보이고, 시작한 계획은 거절한다', async () => {
    const card = await setup().service.proposeHeatPlan(all, { productionPlanNo: 'PP-2610-0001' });
    expect(card).toMatchObject({ kind: 'HEAT_PLAN', currentHeatCount: 1, newHeatCount: 2, heatTon: '30.000', issues: [] });
    expect((await setup({ heatCount: 2 }).service.proposeHeatPlan(all, { productionPlanNo: 'PP-2610-0001' })).issues).toEqual(['히트 수는 그대로예요. 확정하면 확정 이력만 남아요']);
    await expect(setup({ planStatus: 'IN_PROGRESS' }).service.proposeHeatPlan(all, { productionPlanNo: 'PP-2610-0001' })).rejects.toThrow('작업을 시작한 계획');
  });
});

describe('과거 사례 카드 제안', () => {
  it('불합격 LOT의 초안을 카드로 만들고, 비어 있는 원인·조치와 AI 실패를 사유로 알린다', async () => {
    const card = await setup().service.proposePastCase(all, { lotNo: 'HT-1' });
    expect(card).toMatchObject({ kind: 'PAST_CASE', lotId: 5, lotNo: 'HT-1', phenomenon: '규소 초과', referenceCaseNos: ['CASE-0001'] });
    expect(card.issues).toEqual(['AI 초안을 만들지 못해 검사 결과로 초안을 채웠어요.', '원인을 확인해 주세요', '조치를 확인해 주세요']);
  });

  it('없는 LOT·권한 없음은 카드 없이 이유를 돌려준다', async () => {
    await expect(setup().service.proposePastCase(all, { lotNo: 'NOPE' })).rejects.toThrow('찾을 수 없어요');
    await expect(setup().service.proposePastCase(nobody, { lotNo: 'HT-1' })).rejects.toThrow('사용 권한이 없어요');
  });
});

describe('운영 카드 실행 (같은 API의 권한을 사용자 기준으로 확인하고 기존 service를 부른다)', () => {
  it('수주 등록: 필수 칸이 비면 ACT-001, 있으면 수주 등록 service를 부른다', async () => {
    const { service, calls } = setup();
    await expect(service.execute(all, dto({ lines: [{ itemId: 9 }] }))).rejects.toMatchObject({ code: 'ACT-001' });
    expect(calls).toEqual([]);
    const due = plusDays(30);
    const result = await service.execute(all, dto({ customerId: 4, lines: [{ itemId: 9, orderedQty: 12, dueDate: due }] }));
    expect(result).toEqual({ kind: 'SALES_ORDER', registered: { type: 'sales_order', id: 41, no: 'SO-261016-001' } });
    expect(calls[0].args[1]).toEqual({ customerId: 4, items: [{ itemId: 9, orderedQty: 12, dueDate: due }] });
  });

  it('수주 등록: 납기가 범위 밖이면 거절한다', async () => {
    await expect(setup().service.execute(all, dto({ customerId: 4, lines: [{ itemId: 9, orderedQty: 1, dueDate: plusDays(-1) }] }))).rejects.toMatchObject({ code: 'COM-004' });
  });

  it('권한이 없으면 어떤 service도 부르지 않고 COM-002', async () => {
    const { service, calls } = setup();
    for (const kind of ['SALES_ORDER', 'HOT_ROLLING', 'HEAT_PLAN', 'PAST_CASE'] as const) {
      await expect(service.execute(nobody, dto({ kind, customerId: 4, productionPlanId: 7, lotIds: [1], lotId: 5 }))).rejects.toMatchObject({ code: 'COM-002' });
    }
    expect(calls).toEqual([]);
  });

  it('열연 배정·히트 편성: 확정 service를 계획·슬래브와 함께 부른다', async () => {
    const { service, calls } = setup();
    expect(await service.execute(all, dto({ kind: 'HOT_ROLLING', productionPlanId: 7, lotIds: [11, 12, 11] }))).toEqual({ kind: 'HOT_ROLLING', registered: { type: 'hot_rolling', id: 7, no: 'PP-2610-0001' } });
    expect(calls[0].args.slice(1)).toEqual([7, { lotIds: [11, 12] }]);
    expect(await service.execute(all, dto({ kind: 'HEAT_PLAN', productionPlanId: 7 }))).toEqual({ kind: 'HEAT_PLAN', registered: { type: 'heat_plan', id: 7, no: 'PP-2610-0001' } });
    await expect(service.execute(all, dto({ kind: 'HOT_ROLLING', productionPlanId: 7, lotIds: [] }))).rejects.toMatchObject({ code: 'ACT-001' });
  });

  it('과거 사례: 사용자가 고친 값으로 등록한다', async () => {
    const { service, calls, aiAssistedFlags } = setup();
    const result = await service.execute(all, dto({ kind: 'PAST_CASE', lotId: 5, caseCategory: 'EQUIPMENT', title: ' 성분 불합격 ', phenomenon: '규소 초과', cause: '용선 규소', occurredDate: '2026-10-10' }));
    expect(result).toEqual({ kind: 'PAST_CASE', registered: { type: 'past_case', id: 6, no: 'CASE-0006' } });
    expect(calls[0].args[1]).toEqual({ caseCategory: 'EQUIPMENT', title: '성분 불합격', phenomenon: '규소 초과', cause: '용선 규소', actionTaken: '', equipmentText: '', occurredDate: '2026-10-10', lotIds: [5] });
    await expect(service.execute(all, dto({ kind: 'PAST_CASE', lotId: 5, title: 'x' }))).rejects.toMatchObject({ code: 'ACT-001' });
    // 사례 등록 작업 로그(CASE_REGISTERED)가 AI 경유로 남는다 (REQ-AST-010)
    expect(aiAssistedFlags).toEqual([true]);
  });
});
