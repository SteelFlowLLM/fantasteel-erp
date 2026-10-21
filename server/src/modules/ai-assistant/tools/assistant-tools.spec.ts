import {
  PAST_CASE_EXAMPLES,
  ROLE,
  searchPastCases,
  type AuthUser,
  type BusinessEventView,
  type InventoryOverview,
  type LotSummary,
  type LotTrace,
  type PageResult,
  type PastCaseSearchInput,
  type SalesOrderFulfillment,
  type SalesOrderSummary,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { BusinessEventService } from '../../business-event/business-event.service';
import type { DashboardService } from '../../dashboard/dashboard.service';
import type { InventoryService } from '../../inventory/inventory.service';
import type { LotService } from '../../lot/lot.service';
import type { MrpService } from '../../mrp/mrp.service';
import type { PastCaseService } from '../../past-case/past-case.service';
import type { ProductionResultService } from '../../production/production-result.service';
import type { ProductionService } from '../../production/production.service';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import type { QualityService } from '../../quality/quality.service';
import type { RejectedLotService } from '../../quality/rejected-lot.service';
import type { SalesOrderService } from '../../sales-order/sales-order.service';
import type { ShipmentService } from '../../shipment/shipment.service';
import type { AiActionCardService } from '../ai-action-card.service';
import type { AiOpsCardService } from '../ai-ops-card.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { daysUntil, ToolArgumentError } from './assistant-tool';
import { AssistantToolbox, MAX_TOOL_RESULT_LENGTH } from './assistant-toolbox';
import { businessEventTool } from './business-event.tool';
import { inventoryTool } from './inventory.tool';
import { lotTraceTool } from './lot-trace.tool';
import { salesOrderTool } from './sales-order.tool';

const page = <T>(items: T[], total = items.length): PageResult<T> => ({ items, page: 1, size: 20, total });
const SALES_USER: AuthUser = { employeeId: 3, employeeNo: '2103003', employeeName: '박서영', roleCode: ROLE.SALES, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions: { SALES_ORDER_CREATE: 'USE' } };

const overview: InventoryOverview = {
  products: [
    { itemId: 1, itemCode: 'C-SS275-2.0', itemName: 'SS275 코일 2.0t', itemType: 'COIL', steelGradeCode: 'SS275', onHandQty: 20, reservedQty: 6, rollingAllocatedQty: 0, availableQty: 14, onHandTon: '400.000', availableTon: '280.000', unallocatedPassedQty: 20 },
    { itemId: 2, itemCode: 'S-SM355A-250', itemName: 'SM355A 슬래브 250', itemType: 'SLAB', steelGradeCode: 'SM355A', onHandQty: 8, reservedQty: 0, rollingAllocatedQty: 2, availableQty: 6, onHandTon: '160.000', availableTon: '120.000', unallocatedPassedQty: 8 },
  ],
  rawMaterials: [{ itemId: 9, itemCode: 'ORE01', itemName: '철광석', remainingTon: '1600.000', lotCount: 3 }],
  surplus: [
    { itemId: 2, itemCode: 'S-SM355A-250', itemName: 'SM355A 슬래브 250', steelGradeCode: 'SM355A', theoreticalWeightTon: '20.000', unallocatedPassedQty: 8, reservedQty: 0, availableQty: 6, surplusQty: 2, lots: [{ lotId: 5, lotNo: 'SBOF1-260929-015-01', producedDate: '2026-09-29', heatNo: null, yardName: null, productionPlanId: null, productionPlanNo: null }] },
    { itemId: 3, itemCode: 'S-SS275-250', itemName: 'SS275 슬래브 250', steelGradeCode: 'SS275', theoreticalWeightTon: '20.000', unallocatedPassedQty: 0, reservedQty: 0, availableQty: 0, surplusQty: 0, lots: [] },
  ],
};

describe('재고 도구 (get_inventory)', () => {
  const tool = inventoryTool({ listInventories: async () => overview } as unknown as InventoryService);

  it('규격·이름·강종 일부로 거르고 한글 이름으로 돌려준다 (띄어쓰기·대소문자 무시)', async () => {
    const output = await tool.run({ keyword: 'ss 275' }, SALES_USER);
    expect(output.label).toBe('재고 · ss 275');
    expect(output.data).toMatchObject({
      제품: [{ 규격: 'C-SS275-2.0', 품목유형: '코일', '합격 재고 매수': 20, '예약 매수': 6, '가용재고 매수': 14, '가용재고 톤': '280.000' }],
      원료: [],
      여재: [],
    });
  });

  it('category로 한 갈래만, 여재는 여재 매수가 있는 규격만', async () => {
    const output = await tool.run({ category: 'SURPLUS' }, SALES_USER);
    expect(Object.keys(output.data as object)).toEqual(['여재', '여재 생략 줄 수']);
    expect((output.data as { 여재: unknown[] }).여재).toEqual([{ 규격: 'S-SM355A-250', 품목: 'SM355A 슬래브 250', 강종: 'SM355A', '여재 매수': 2, '여재 LOT': ['SBOF1-260929-015-01 (생산 2026-09-29)'], '생략한 여재 LOT 수': 0 }]);
  });

  it('없는 category는 인자 오류', async () => {
    await expect(tool.run({ category: 'ALL' }, SALES_USER)).rejects.toBeInstanceOf(ToolArgumentError);
  });

  it('줄 수 상한을 넘으면 재고 있는 제품을 먼저 넣고 재고 0인 제품을 자른다', async () => {
    const empty = (id: number) => ({ ...overview.products[0], itemId: id, itemCode: `C-EMPTY-${id}`, onHandQty: 0, reservedQty: 0, availableQty: 0, onHandTon: '0.000', availableTon: '0.000', unallocatedPassedQty: 0 });
    const products = [...Array.from({ length: 15 }, (_, i) => empty(100 + i)), overview.products[1], empty(200), overview.products[0]];
    const crowded = inventoryTool({ listInventories: async () => ({ ...overview, products }) } as unknown as InventoryService);
    const data = (await crowded.run({ category: 'PRODUCT' }, SALES_USER)).data as { 제품: { 규격: string }[]; '제품 생략 줄 수': number; '재고 있는데 생략한 제품 줄 수': number };
    expect(data.제품.slice(0, 3).map((r) => r.규격)).toEqual(['C-SS275-2.0', 'S-SM355A-250', 'C-EMPTY-100']);
    expect(data['제품 생략 줄 수']).toBe(3);
    expect(data['재고 있는데 생략한 제품 줄 수']).toBe(0);
  });

  it('재고 있는 제품만으로 상한을 넘으면 재고 많은 순으로 남기고 재고 있는데 생략한 줄 수를 알린다', async () => {
    const stocked = (id: number, qty: number) => ({ ...overview.products[0], itemId: id, itemCode: `C-STOCK-${id}`, onHandQty: qty });
    const products = [overview.products[1], ...Array.from({ length: 16 }, (_, i) => stocked(300 + i, 10 + i)), { ...overview.products[0], onHandQty: 0 }];
    const crowded = inventoryTool({ listInventories: async () => ({ ...overview, products }) } as unknown as InventoryService);
    const data = (await crowded.run({ category: 'PRODUCT' }, SALES_USER)).data as { 제품: { 규격: string; '합격 재고 매수': number }[]; '제품 생략 줄 수': number; '재고 있는데 생략한 제품 줄 수': number };
    expect(data.제품).toHaveLength(15);
    expect(data.제품[0]).toMatchObject({ 규격: 'C-STOCK-315', '합격 재고 매수': 25 });
    expect(data.제품.every((r) => r['합격 재고 매수'] >= 11)).toBe(true);
    expect(data['제품 생략 줄 수']).toBe(3);
    expect(data['재고 있는데 생략한 제품 줄 수']).toBe(2);
  });
});

describe('수주 도구 (get_sales_orders)', () => {
  const summary = (id: number, salesOrderNo: string, isDueRisk: boolean): SalesOrderSummary => ({
    id,
    salesOrderNo,
    customerId: 1,
    customerName: '한빛건설',
    ownerEmployeeId: 3,
    ownerEmployeeName: '박서영',
    salesOrderStatus: 'PARTIALLY_SHIPPED',
    itemCount: 1,
    totalOrderedQty: 10,
    totalOrderedTon: '200.000',
    totalShippedQty: 5,
    totalActiveReservedQty: 3,
    hasReproductionNeed: false,
    earliestDueDate: '2026-10-15',
    isDueRisk,
    progress: { qty: 5, denominatorQty: 10, ratio: 0.5 },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    items: [],
  });
  const fulfillment = (id: number, salesOrderNo: string): SalesOrderFulfillment => ({ salesOrderId: id, salesOrderNo, salesOrderStatus: 'PARTIALLY_SHIPPED', progress: { qty: 5, denominatorQty: 10, ratio: 0.5 }, items: [] });
  const orders = [summary(1, 'SO-2610-001', true), summary(2, 'SO-2610-002', false), summary(3, 'SO-2610-0021', false)];
  const fulfillmentIds: number[] = [];
  const tool = salesOrderTool({
    list: async (query: { salesOrderNo?: string }) => page(orders.filter((o) => !query.salesOrderNo || o.salesOrderNo.toLowerCase().includes(query.salesOrderNo.toLowerCase()))),
    fulfillment: async (id: number) => {
      fulfillmentIds.push(id);
      const found = orders.find((o) => o.id === id);
      if (!found) throw new AppException('COM-003');
      return fulfillment(id, found.salesOrderNo);
    },
    detail: async (id: number) => orders.find((o) => o.id === id),
  } as unknown as SalesOrderService, () => '2026-10-13');

  beforeEach(() => fulfillmentIds.splice(0));

  it('수주 등록 조회 권한이 필요하다 (GET /sales-orders와 같음)', () => {
    expect(tool.access).toEqual({ checkedBy: 'TOOLBOX', permissions: ['SALES_ORDER_CREATE'] });
  });

  it('납기 위험만 고를 수 있고 진행률은 %로', async () => {
    const output = await tool.run({ dueRiskOnly: true }, SALES_USER);
    expect(output.label).toBe('수주 · 납기 위험');
    expect(output.data).toMatchObject({ 수주: [{ 수주번호: 'SO-2610-001', 진행률: '50%', '납기 위험': true, 상태: '부분출하', '가장 이른 납기까지 남은 일수': 2 }] });
  });

  it('건수는 거른 뒤의 수만 준다 (거르기 전 전체 수를 모델이 납기 위험 건수로 말한 적이 있다)', async () => {
    const output = await tool.run({ dueRiskOnly: true }, SALES_USER);
    expect(output.data).toMatchObject({ '납기 위험 수주 수': 1 });
    expect(Object.keys(output.data as object)).toEqual(['납기 위험 수주 수', '수주', '생략 줄 수']);
  });

  it('납기까지 남은 일수는 서버가 서울 날짜로 계산한다 (지난 납기는 음수)', () => {
    expect(daysUntil('2026-10-15', '2026-10-13')).toBe(2);
    expect(daysUntil('2026-10-13', '2026-10-13')).toBe(0);
    expect(daysUntil('2026-10-10', '2026-10-13')).toBe(-3);
    expect(daysUntil('2026-11-02', '2026-10-30')).toBe(3);
  });

  it('수주번호가 정확히 맞으면(여러 개가 일부 맞아도) 그 수주의 충족 현황을 준다', async () => {
    const output = await tool.run({ salesOrderNo: 'so-2610-002' }, SALES_USER);
    expect(fulfillmentIds).toEqual([2]);
    expect(output.label).toBe('수주 충족 현황 · SO-2610-002');
  });

  it('한 건의 충족 현황에도 고객사·담당을 준다 (SO-… 담당 누구야?에 답하게)', async () => {
    const byNo = await tool.run({ salesOrderNo: 'SO-2610-002' }, SALES_USER);
    expect(byNo.data).toMatchObject({ 수주번호: 'SO-2610-002', 고객사: '한빛건설', 담당: '박서영' });
    const byId = await tool.run({ salesOrderId: 1 }, SALES_USER);
    expect(byId.data).toMatchObject({ 수주번호: 'SO-2610-001', 고객사: '한빛건설', 담당: '박서영' });
  });

  it('보고 있는 화면의 수주 id로 바로 찾고, 없는 id는 인자 오류', async () => {
    await tool.run({ salesOrderId: 3 }, SALES_USER);
    expect(fulfillmentIds).toEqual([3]);
    await expect(tool.run({ salesOrderId: 99 }, SALES_USER)).rejects.toThrow('수주 id 99가 없어요');
  });
});

describe('LOT 추적 도구 (trace_lot)', () => {
  const lot = (id: number, lotNo: string): LotSummary => ({ id, lotNo, lotType: 'COIL', lotStatus: 'AVAILABLE', itemId: 1, itemCode: 'C-SS275-2.0', itemName: null, steelGradeCode: 'SS275', yardName: null, producedDate: '2026-09-30', initialTon: null, remainingTon: null, inspectionResult: 'PASS' });
  const lots = [lot(1, 'CBOF1-260929-015-01'), lot(2, 'CBOF1-260929-015-02')];
  const traced: [number, string | undefined][] = [];
  const tool = lotTraceTool({
    list: async (query: { lotNo?: string }) => page(lots.filter((l) => l.lotNo.startsWith(query.lotNo ?? ''))),
    trace: async (id: number, direction?: string): Promise<LotTrace> => {
      traced.push([id, direction]);
      const start = lots.find((l) => l.id === id) ?? lots[0];
      return { start, direction: 'backward', nodes: [{ ...start, depth: 0, isStart: true, rawMaterialType: null, blastFurnaceCode: null, converterCode: null }], edges: [], shipments: [], impact: null };
    },
  } as unknown as LotService);

  it('정확한 LOT 번호면 추적하고 한글 이름으로 돌려준다', async () => {
    const output = await tool.run({ lotNo: 'CBOF1-260929-015-02', direction: 'backward' }, SALES_USER);
    expect(traced.at(-1)).toEqual([2, 'backward']);
    expect(output.label).toBe('LOT 역추적 · CBOF1-260929-015-02');
    expect(output.data).toMatchObject({ 'LOT 관계': [{ 단계: 0, 'LOT 번호': 'CBOF1-260929-015-02', 유형: '코일', '검사 판정': '합격' }] });
  });

  it('앞부분이 여러 LOT에 맞으면 추적하지 않고 후보를 준다, 없으면 인자 오류', async () => {
    const before = traced.length;
    const output = await tool.run({ lotNo: 'CBOF1-260929' }, SALES_USER);
    expect(traced).toHaveLength(before);
    expect(output.data).toMatchObject({ 후보: ['CBOF1-260929-015-01', 'CBOF1-260929-015-02'] });
    await expect(tool.run({ lotNo: 'HT-X' }, SALES_USER)).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({}, SALES_USER)).rejects.toThrow('lotNo가 필요해요');
  });
});

describe('작업 로그 도구 (get_business_events)', () => {
  const event: BusinessEventView = {
    id: 1,
    businessEventNo: 'EV-261001-001',
    businessEventType: 'SALES_ORDER_CREATED',
    businessEventTypeLabel: '수주 등록',
    actorType: 'USER',
    actorEmployeeId: 3,
    actorEmployeeNo: '2103003',
    actorEmployeeName: '박서영',
    targetType: 'sales_order',
    targetId: 1,
    salesOrderId: 1,
    salesOrderNo: 'SO-2610-001',
    beforeData: null,
    afterData: { secret: '변경 전후 원본은 넘기지 않는다' },
    reason: null,
    isAiAssisted: false,
    actionDraftId: null,
    messageId: null,
    chatRoomId: null,
    occurredAt: '2026-10-01T00:30:00.000Z',
    lots: [],
  };
  const queries: Record<string, unknown>[] = [];
  const tool = businessEventTool(
    {
      list: async (query: Record<string, unknown>) => {
        queries.push(query);
        return page([event], 40);
      },
    } as unknown as BusinessEventService,
    { list: async () => page([{ id: 7, salesOrderNo: 'SO-2610-007' }]) } as unknown as SalesOrderService,
    { list: async () => page([{ id: 8, lotNo: 'HT-BOF1-260929-015' }]) } as unknown as LotService,
  );

  it('수주번호·LOT 번호를 id로 바꿔 최신순으로 읽고, 시각은 서울 기준', async () => {
    const output = await tool.run({ salesOrderNo: 'SO-2610-007', lotNo: 'HT-BOF1-260929-015', from: '2026-10-01' }, SALES_USER);
    expect(queries.at(-1)).toMatchObject({ salesOrderId: 7, lotId: 8, from: '2026-10-01', sort: 'desc', page: 1 });
    expect(output.data).toMatchObject({ '전체 건수': 40, '최신순 작업 로그': [{ 시각: '2026-10-01 09:30', 유형: '수주 등록', 주체: '박서영' }] });
    expect(JSON.stringify(output.data)).not.toContain('secret');
  });

  it('없는 번호·뒤바뀐 기간은 인자 오류', async () => {
    await expect(tool.run({ salesOrderNo: 'SO-2610-999' }, SALES_USER)).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({ from: '2026-10-05', to: '2026-10-01' }, SALES_USER)).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(tool.run({ from: '10/01' }, SALES_USER)).rejects.toBeInstanceOf(ToolArgumentError);
  });
});

describe('도구 모음 (권한·실패 처리)', () => {
  const user = (permissions: AuthUser['permissions']): AuthUser => ({ employeeId: 1, employeeNo: '2205013', employeeName: '서민지', roleCode: ROLE.QUALITY, departmentId: 1, jobGradeId: 1, headDepartmentIds: [], permissions });
  let inventory: () => Promise<InventoryOverview>;
  let salesOrderCalls = 0;
  const toolbox = new AssistantToolbox(
    {} as PrismaService,
    { findRoleCodesWithAnyPermission: async () => [ROLE.SALES, ROLE.ADMIN] } as unknown as AiAssistantRepository,
    { listInventories: () => inventory() } as unknown as InventoryService,
    {
      list: async () => {
        salesOrderCalls += 1;
        return page([]);
      },
    } as unknown as SalesOrderService,
    {} as LotService,
    {} as BusinessEventService,
    {} as ProductionService,
    {} as ProductionResultService,
    {} as QualityService,
    {} as RejectedLotService,
    {} as PurchasingService,
    {} as ShipmentService,
    { search: async (input: PastCaseSearchInput) => searchPastCases(PAST_CASE_EXAMPLES, input, '2026-10-16') } as unknown as PastCaseService,
    {} as AiActionCardService,
    {} as AiOpsCardService,
    {} as DashboardService,
    {} as MrpService,
    // 일정·업무 고치기 카드와 내 일정·업무 조회 (이슈 #398): 이 시험에서는 부르지 않는다
    {} as never,
    {} as never,
    {} as never,
  );
  const run = (name: string, args: string, permissions: AuthUser['permissions'] = {}) => toolbox.run(user(permissions), { id: 'c1', name, arguments: args });

  beforeEach(() => {
    inventory = async () => overview;
    salesOrderCalls = 0;
  });

  it('과거 사례 검색은 전 역할이 쓰고, 사례 번호를 출처에 남기며 예시 사례임을 모델에 알린다 (REQ-AST-006)', async () => {
    const result = await run('search_past_cases', JSON.stringify({ query: 'SM355A 히트 성분 불합격' }));
    expect(result.source).toMatchObject({ kind: 'DATA', id: 'search_past_cases' });
    expect(result.source?.label).toContain('CASE-0005');
    const data = JSON.parse(result.content) as { 사례: { 사례번호: string; 예시: string }[] };
    expect(data.사례[0]).toMatchObject({ 사례번호: 'CASE-0005', 예시: '예시 사례(실제 사례 아님)' });
    expect((await run('search_past_cases', JSON.stringify({ category: 'X' }))).content).toContain('category는 QUALITY, EQUIPMENT 중 하나예요');
  });

  it('모델에 조회 도구 18개를 알린다 (REQ-AST-004 조회 대상 전부 + 묶은 숫자 3개 + REQ-AST-006 과거 사례 + REQ-AST-003 지식 읽기)', () => {
    expect(toolbox.definitions().map((d) => d.name)).toEqual([
      'get_inventory',
      'get_sales_orders',
      'get_production_plans',
      'get_production_results',
      'trace_lot',
      'get_quality_inspections',
      'get_rejected_lots',
      'get_quality_reject_rate',
      'get_purchase_requisitions',
      'get_purchase_orders',
      'get_goods_receipts',
      'get_mrp_requirements',
      'get_shipment_requests',
      'get_mill_sheets',
      'get_dashboard_summary',
      'get_business_events',
      'search_past_cases',
      'read_knowledge',
    ]);
  });

  it('권한 밖이면 조회하지 않고 조회할 수 있는 역할을 알려 준다 (REQ-AST-009)', async () => {
    const result = await run('get_sales_orders', '{}');
    expect(salesOrderCalls).toBe(0);
    expect(result.source).toBeNull();
    expect(JSON.parse(result.content)).toEqual({ 오류: '권한 없음', 안내: expect.stringContaining('품질'), '조회할 수 있는 역할': ['영업', '관리자'] });

    const allowed = await run('get_sales_orders', '{}', { SALES_ORDER_CREATE: 'VIEW' });
    expect(salesOrderCalls).toBe(1);
    expect(allowed.source).toEqual({ kind: 'DATA', id: 'get_sales_orders', label: '수주' });
  });

  it('없는 도구·JSON이 아닌 인자·인자 오류·업무 오류는 이유를 결과로 돌려준다', async () => {
    expect(JSON.parse((await run('drop_table', '{}')).content).오류).toContain('없는 도구');
    expect(JSON.parse((await run('get_inventory', '{keyword')).content).오류).toBe('인자가 JSON이 아니에요');
    expect(JSON.parse((await run('get_inventory', '[]')).content).오류).toBe('인자는 객체여야 해요');
    expect(JSON.parse((await run('get_inventory', '{"category":"ALL"}')).content).오류).toContain('category');
    inventory = async () => {
      throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
    };
    expect(JSON.parse((await run('get_inventory', '{}')).content).오류).toBe('LOT을 찾을 수 없어요');
  });

  it('예상하지 못한 오류는 자세한 내용을 모델에 넘기지 않는다', async () => {
    inventory = async () => {
      throw new Error('connection string postgres://…');
    };
    const result = await run('get_inventory', '{}');
    expect(result).toEqual({ content: JSON.stringify({ 오류: '조회 중 서버 오류가 났어요' }), source: null });
  });

  it(`결과가 ${MAX_TOOL_RESULT_LENGTH}자를 넘으면 자르고 알린다`, async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...overview.products[0], itemCode: `C-SS275-${i}-${'X'.repeat(600)}` }));
    inventory = async () => ({ ...overview, products: many });
    const result = await run('get_inventory', '{}');
    expect(result.content.length).toBeLessThan(MAX_TOOL_RESULT_LENGTH + 100);
    expect(result.content).toContain('잘렸어요');
  });
});
