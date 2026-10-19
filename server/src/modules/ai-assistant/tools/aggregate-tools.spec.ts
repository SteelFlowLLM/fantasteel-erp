import { ROLE, type AuthUser, type MrpRequirementsView, type PageResult, type ProcessFlowWidget, type ProcessYieldWidget, type QualityInspectionListItem, type ShipmentResultWidget } from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import { seoulToday } from '../../../common/time/seoul-date';
import type { DashboardService } from '../../dashboard/dashboard.service';
import type { MrpService } from '../../mrp/mrp.service';
import type { QualityService } from '../../quality/quality.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { ToolArgumentError } from './assistant-tool';
import { AssistantToolbox, type AssistantToolServices } from './assistant-toolbox';
import { dashboardTool } from './dashboard.tool';
import { mrpTool } from './mrp.tool';
import { qualityRejectRateTool } from './quality.tool';

const DAY_MS = 86_400_000;
const user = (roleCode: AuthUser['roleCode'], permissions: AuthUser['permissions'] = {}): AuthUser => ({
  employeeId: 1,
  employeeNo: '0000001',
  employeeName: '사원',
  roleCode,
  departmentId: 1,
  jobGradeId: 1,
  headDepartmentIds: [],
  permissions,
});
const QUALITY = user(ROLE.QUALITY, { INSPECTION_REGISTER: 'USE' });

/** daysAgo일 전 판정 (서울 정오 무렵이 되게 현재 시각 기준) */
const judged = (lotId: number, steelGradeCode: string, processType: 'STEELMAKING' | 'CONTINUOUS_CASTING' | 'HOT_ROLLING', result: 'PASS' | 'FAIL', daysAgo: number): QualityInspectionListItem =>
  ({
    lotId,
    lotNo: `LOT-${lotId}`,
    lotType: processType === 'STEELMAKING' ? 'HEAT' : processType === 'CONTINUOUS_CASTING' ? 'SLAB' : 'COIL',
    lotStatus: 'AVAILABLE',
    processType,
    steelGradeId: 1,
    steelGradeCode,
    thicknessMm: null,
    itemId: null,
    itemCode: null,
    itemName: null,
    producedDate: null,
    productionPlanId: null,
    productionPlanNo: null,
    heatLotId: null,
    heatLotNo: null,
    heatInspectionResult: null,
    qualityInspectionId: lotId,
    inspectionStandardId: 1,
    inspectionStandardCode: 'QS',
    versionNo: 1,
    inspectionResult: result,
    inspectedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
    isLocked: false,
  }) as QualityInspectionListItem;

/** 판정 시각 최신순 목록을 size씩 나눠 주는 가짜 검사 목록 */
function fakeQuality(rows: QualityInspectionListItem[]) {
  const pages: number[] = [];
  const service = {
    listQualityInspections: async (query: { status: string; page: number; size: number }): Promise<PageResult<QualityInspectionListItem>> => {
      expect(query.status).toBe('done');
      pages.push(query.page);
      const start = (query.page - 1) * query.size;
      return { items: rows.slice(start, start + query.size), page: query.page, size: query.size, total: rows.length };
    },
  } as unknown as QualityService;
  return { service, pages };
}

describe('강종별 불합격률 도구 (get_quality_reject_rate)', () => {
  const rows = [
    judged(1, 'SM355A', 'STEELMAKING', 'FAIL', 1),
    judged(2, 'SM355A', 'CONTINUOUS_CASTING', 'PASS', 2),
    judged(3, 'SM355A', 'CONTINUOUS_CASTING', 'FAIL', 3),
    judged(4, 'SS275', 'HOT_ROLLING', 'PASS', 4),
    judged(5, 'SS275', 'HOT_ROLLING', 'PASS', 5),
    judged(6, 'SS275', 'CONTINUOUS_CASTING', 'FAIL', 40),
  ];

  it('기본 30일 안의 판정만 강종별로 세고, 불합격률이 높은 강종부터 공정별 비율과 함께 준다', async () => {
    const { service } = fakeQuality(rows);
    const output = await qualityRejectRateTool(service).run({}, QUALITY);
    expect(output.label).toBe('강종별 불합격률 · 최근 30일');
    const data = output.data as { 기간: string; 전체: unknown; 강종별: { 강종: string; 공정별: unknown[] }[] };
    expect(data.기간).toContain(`~ ${seoulToday()} (판정 시각 기준, 30일)`);
    expect(data.전체).toEqual({ '판정 수': 5, '불합격 수': 2, 불합격률: '40.0%' });
    expect(data.강종별).toEqual([
      {
        강종: 'SM355A',
        '판정 수': 3,
        '불합격 수': 2,
        불합격률: '66.7%',
        공정별: [
          { 공정: '제강', '판정 수': 1, '불합격 수': 1, 불합격률: '100.0%' },
          { 공정: '연주', '판정 수': 2, '불합격 수': 1, 불합격률: '50.0%' },
        ],
      },
      { 강종: 'SS275', '판정 수': 2, '불합격 수': 0, 불합격률: '0.0%', 공정별: [{ 공정: '열연', '판정 수': 2, '불합격 수': 0, 불합격률: '0.0%' }] },
    ]);
  });

  it('기간을 넓히면 오래된 판정도 세고, 강종 코드로 거른다', async () => {
    const { service } = fakeQuality(rows);
    const output = await qualityRejectRateTool(service).run({ days: 60, steelGradeCode: 'ss275' }, QUALITY);
    expect(output.label).toBe('강종별 불합격률 · 최근 60일 · SS275');
    expect((output.data as { 전체: unknown }).전체).toEqual({ '판정 수': 3, '불합격 수': 1, 불합격률: '33.3%' });
  });

  it('판정 시각이 기간 시작일보다 앞선 쪽이 나오면 다음 쪽을 읽지 않는다', async () => {
    const many = [...Array.from({ length: 100 }, (_, i) => judged(i + 1, 'SS275', 'HOT_ROLLING', 'PASS', 40)), judged(101, 'SS275', 'HOT_ROLLING', 'FAIL', 41)];
    const { service, pages } = fakeQuality(many);
    const output = await qualityRejectRateTool(service).run({}, QUALITY);
    expect(pages).toEqual([1]);
    expect(output.data).toMatchObject({ 전체: { '판정 수': 0, 불합격률: null }, 강종별: [], 안내: '기간 안에 판정한 검사가 없어요' });
  });

  it('days는 1~365 정수만 받는다', async () => {
    const { service } = fakeQuality(rows);
    await expect(qualityRejectRateTool(service).run({ days: 400 }, QUALITY)).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(qualityRejectRateTool(service).run({ days: 0 }, QUALITY)).rejects.toBeInstanceOf(ToolArgumentError);
  });
});

describe('대시보드 현황 도구 (get_dashboard_summary)', () => {
  const flow: ProcessFlowWidget = {
    today: '2026-10-19',
    salesOrders: { openCount: 4, dueRiskCount: 1 },
    productionPlans: { plannedCount: 1, inProgressCount: 2 },
    inspections: { pendingCount: 9, heatCount: 1, slabCount: 8, coilCount: 0 },
    inventories: { slabAvailableQty: 2, coilAvailableQty: 0 },
    shipmentRequests: { requestedCount: 0, allocatedCount: 1 },
    goodsIssues: { issuedRequestCount: 0, issuedLotCount: 0 },
  };
  const yieldWidget: ProcessYieldWidget = {
    processes: [
      { processType: 'IRONMAKING', resultCount: 1, inputTon: '1000.000', outputTon: '900.000', actualYieldRate: null, plannedYieldRate: null },
      { processType: 'CONTINUOUS_CASTING', resultCount: 2, inputTon: '500.000', outputTon: '471.000', actualYieldRate: '0.9420', plannedYieldRate: '0.9500' },
    ],
  };
  const shipment: ShipmentResultWidget = {
    from: '2026-09-20',
    to: '2026-10-19',
    days: 30,
    issuedRequestCount: 1,
    totalSlabQty: 3,
    totalCoilQty: 0,
    totalTon: '70.650',
    series: [
      { date: '2026-10-18', slabQty: 3, coilQty: 0, ton: '70.650' },
      { date: '2026-10-19', slabQty: 0, coilQty: 0, ton: '0.000' },
    ],
  };
  const users: AuthUser[] = [];
  const dashboard = {
    processFlow: async () => flow,
    processYield: async (u: AuthUser) => {
      users.push(u);
      return yieldWidget;
    },
    shipmentResult: async (u: AuthUser) => {
      users.push(u);
      return shipment;
    },
    surplusAge: async () => ({ today: '2026-10-19', totalQty: 0, totalTon: '0.000', maxAgeDays: null, items: [] }),
  } as unknown as DashboardService;

  it('공정 흐름 현황을 상태 표시명이 붙은 한글 이름으로 준다', async () => {
    const output = await dashboardTool(dashboard).run({ widget: 'process_flow' }, user(ROLE.SALES));
    expect(output.label).toBe('대시보드 · 공정 흐름 현황');
    expect(output.data).toMatchObject({
      수주: { '진행 중 수주 수': 4, '납기 위험 수주 수': 1 },
      생산계획: { '계획 수': 1, '진행중 수': 2 },
      검사: { '판정 대기 LOT 수': 9 },
      재고: { '슬래브 가용 매수': 2 },
      출하요청: { '배정 대기 수': 0 },
    });
  });

  it('공정별 수율은 사용자를 service에 넘기고 수율을 %로 바꾼다', async () => {
    const quality = user(ROLE.PRODUCTION, { PRODUCTION_RESULT_CONFIRM: 'VIEW' });
    const output = await dashboardTool(dashboard).run({ widget: 'process_yield' }, quality);
    expect(users.at(-1)).toBe(quality);
    expect((output.data as { 공정: unknown[] }).공정).toEqual([
      { 공정: '제선', '완료 실적 수': 1, '투입 톤': '1000.000', '산출 톤': '900.000', '실적 수율': null, '계획 수율': null },
      { 공정: '연주', '완료 실적 수': 2, '투입 톤': '500.000', '산출 톤': '471.000', '실적 수율': '94.2%', '계획 수율': '95.0%' },
    ]);
  });

  it('출하 실적은 출고가 있었던 날만 최신순으로 준다', async () => {
    const output = await dashboardTool(dashboard).run({ widget: 'shipment_result' }, user(ROLE.LOGISTICS));
    expect(output.data).toMatchObject({ '출고 톤': '70.650', '출고한 날(최신순)': [{ 날짜: '2026-10-18', '슬래브 매수': 3 }], '생략 줄 수': 0 });
  });

  it('widget이 없거나 모르는 값이면 인자 오류', async () => {
    await expect(dashboardTool(dashboard).run({}, user(ROLE.SALES))).rejects.toBeInstanceOf(ToolArgumentError);
    await expect(dashboardTool(dashboard).run({ widget: 'order_fulfillment' }, user(ROLE.SALES))).rejects.toBeInstanceOf(ToolArgumentError);
  });
});

describe('MRP 원료 소요 도구 (get_mrp_requirements)', () => {
  const view: MrpRequirementsView = {
    from: '2026-10-19',
    to: '2026-11-18',
    heatCapacityTon: '250.000',
    plans: [{ isBeforePeriod: true } as MrpRequirementsView['plans'][number], { isBeforePeriod: false } as MrpRequirementsView['plans'][number]],
    materials: [
      { itemId: 1, itemCode: 'ORE01', itemName: '철광석', rawMaterialType: 'IRON_ORE', requiredTon: '444.444', remainingTon: '2466.665', scheduledReceiptTon: '0.000', usedRemainingTon: '444.444', usedScheduledReceiptTon: '0.000', netRequirementTon: '0.000', firstShortageDate: null },
      { itemId: 2, itemCode: 'LIM01', itemName: '석회석', rawMaterialType: null, requiredTon: '41.667', remainingTon: '20.000', scheduledReceiptTon: '0.000', usedRemainingTon: '20.000', usedScheduledReceiptTon: '0.000', netRequirementTon: '21.667', firstShortageDate: '2026-10-28' },
    ],
    requisitionLines: [{ productionPlanId: 1, productionPlanNo: 'PP-2610-0001', itemId: 2, itemCode: 'LIM01', itemName: '석회석', netRequirementTon: '21.667', requiredDate: '2026-10-28', existingPurchaseRequisitionNo: null }],
  };
  const queries: unknown[] = [];
  const mrp = {
    requirements: async (query: unknown) => {
      queries.push(query);
      return view;
    },
  } as unknown as MrpService;

  it('기간을 말하지 않으면 오늘부터 30일을 보고, 원료별 순소요와 구매요청으로 이어질 줄을 준다', async () => {
    const output = await mrpTool(mrp).run({}, user(ROLE.PURCHASE));
    const today = seoulToday();
    expect(queries.at(-1)).toEqual({ from: today, to: seoulToday(new Date(Date.parse(`${today}T00:00:00+09:00`) + 30 * DAY_MS)) });
    expect(output.data).toMatchObject({
      '보이는 생산계획 수': 2,
      '밀린 소요 생산계획 수': 1,
      원료: [{ '원료 코드': 'ORE01', '원료 유형': '철광석', '순소요 톤': '0.000' }, { '원료 코드': 'LIM01', '원료 유형': null, '순소요 톤': '21.667', '처음 부족한 필요일': '2026-10-28' }],
      '순소요가 있는 원료 수': 1,
      '구매요청으로 이어질 줄': [{ '생산계획 번호': 'PP-2610-0001', '이미 있는 구매요청': null }],
    });
  });

  it('기간을 넘기면 그대로 쓰고, 끝이 시작보다 앞서면 인자 오류', async () => {
    await mrpTool(mrp).run({ from: '2026-10-01', to: '2026-11-30' }, user(ROLE.PURCHASE));
    expect(queries.at(-1)).toEqual({ from: '2026-10-01', to: '2026-11-30' });
    await expect(mrpTool(mrp).run({ from: '2026-11-30', to: '2026-10-01' }, user(ROLE.PURCHASE))).rejects.toBeInstanceOf(ToolArgumentError);
  });
});

describe('도구 모음: 묶은 숫자 도구의 권한', () => {
  const toolbox = (s: Partial<AssistantToolServices>, roles: AuthUser['roleCode'][]) => {
    const services = s as AssistantToolServices;
    return new AssistantToolbox(
      {} as PrismaService,
      { findRoleCodesWithAnyPermission: async () => roles } as unknown as AiAssistantRepository,
      services.inventory,
      services.salesOrders,
      services.lots,
      services.events,
      services.plans,
      services.results,
      services.quality,
      services.rejectedLots,
      services.purchasing,
      services.shipments,
      services.pastCases,
      services.actionCards,
      services.opsCards,
      services.dashboard,
      services.mrp,
    );
  };

  it('불합격률은 검사 등록 조회 권한이 없으면 검사 목록을 읽지 않는다', async () => {
    const box = toolbox(
      {
        quality: {
          listQualityInspections: async () => {
            throw new Error('불리면 안 돼요');
          },
        } as unknown as QualityService,
      },
      [ROLE.QUALITY, ROLE.ADMIN],
    );
    const result = await box.run(user(ROLE.SALES), { id: 'c1', name: 'get_quality_reject_rate', arguments: '{}' });
    expect(JSON.parse(result.content)).toMatchObject({ 오류: '권한 없음', '조회할 수 있는 역할': ['품질', '관리자'] });
  });

  it('대시보드 현황은 service가 COM-002를 던지면 위젯별 권한 안내를 함께 돌려준다', async () => {
    const box = toolbox(
      {
        dashboard: {
          processYield: async () => {
            throw new AppException('COM-002');
          },
        } as unknown as DashboardService,
      },
      [ROLE.LOGISTICS, ROLE.PRODUCTION, ROLE.ADMIN],
    );
    const result = await box.run(user(ROLE.SALES), { id: 'c1', name: 'get_dashboard_summary', arguments: '{"widget":"process_yield"}' });
    expect(result.source).toBeNull();
    expect(JSON.parse(result.content)).toMatchObject({ 오류: '권한 없음', 안내: expect.stringContaining('공정별 수율은 작업 실적 확정 조회 권한') });
  });
});
