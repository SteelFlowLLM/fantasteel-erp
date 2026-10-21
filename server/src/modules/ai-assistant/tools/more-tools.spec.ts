import {
  ROLE,
  SHIPMENT_REQUEST_STATUS_LABEL,
  type AuthUser,
  type GoodsReceiptView,
  type MillSheetSummary,
  type PageResult,
  type ProductionPlanSummary,
  type ProductionResultView,
  type PurchaseOrderView,
  type PurchaseRequisitionSummary,
  type QualityInspectionListItem,
  type RejectedLotListItem,
  type ShipmentRequestSummary,
} from '@fantasteel/shared';
import { AppException } from '../../../common/errors/app.exception';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ProductionResultService } from '../../production/production-result.service';
import type { ProductionService } from '../../production/production.service';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import type { QualityService } from '../../quality/quality.service';
import type { RejectedLotService } from '../../quality/rejected-lot.service';
import type { ShipmentService } from '../../shipment/shipment.service';
import type { AiActionCardService } from '../ai-action-card.service';
import type { AiOpsCardService } from '../ai-ops-card.service';
import type { AiAssistantRepository } from '../ai-assistant.repository';
import { codeLabelList, ToolArgumentError } from './assistant-tool';
import { AssistantToolbox, type AssistantToolServices } from './assistant-toolbox';
import { productionPlanTool, productionResultTool } from './production.tool';
import { goodsReceiptTool, purchaseOrderTool, purchaseRequisitionTool } from './purchasing.tool';
import { qualityInspectionTool, rejectedLotTool } from './quality.tool';
import { millSheetTool, shipmentRequestTool } from './shipment.tool';

const page = <T>(items: T[], total = items.length): PageResult<T> => ({ items, page: 1, size: 20, total });
const user = (roleCode: AuthUser['roleCode'], permissions: AuthUser['permissions'] = {}, headDepartmentIds: number[] = []): AuthUser => ({
  employeeId: 1,
  employeeNo: '0000001',
  employeeName: '사원',
  roleCode,
  departmentId: 1,
  jobGradeId: 1,
  headDepartmentIds,
  permissions,
});
const PRODUCTION = user(ROLE.PRODUCTION, { PRODUCTION_PLAN_CONFIRM: 'USE', PRODUCTION_RESULT_CONFIRM: 'USE' });

const plan = (id: number, productionPlanNo: string, salesOrderNo: string | null): ProductionPlanSummary => ({
  id,
  productionPlanNo,
  productionPlanStatus: 'IN_PROGRESS',
  isReproduction: false,
  itemId: 1,
  itemCode: 'SL-SS275-250x1200x10000',
  itemName: 'SS275 슬래브',
  itemType: 'SLAB',
  steelGradeCode: 'SS275',
  theoreticalWeightTon: '23.550',
  shortageQty: 10,
  heatCount: 1,
  salesOrderId: 1,
  salesOrderNo,
  salesOrderItemId: 1,
  customerName: '가람중공업',
  dueDate: '2026-10-27',
  requiredMoltenSteelTon: '250.000',
  heatsMadeQty: 1,
  heatsCastQty: 0,
  passedQty: 0,
  remainingTargetQty: 10,
  createdAt: '2026-10-13T05:00:00.000Z',
});
const plans = [plan(1, 'PP-2610-0001', 'SO-2610-001'), plan(2, 'PP-2610-0002', 'SO-2610-002')];
const planService = { listPlans: async () => page(plans), planIdByNo: async (no: string) => plans.find((p) => p.productionPlanNo === no.toUpperCase())?.id ?? null } as unknown as ProductionService;

const result: ProductionResultView = {
  id: 9,
  productionPlanId: 2,
  productionPlanNo: 'PP-2610-0002',
  processType: 'STEELMAKING',
  blastFurnaceCode: null,
  converterCode: 'BOF1',
  startedAt: '2026-10-13T05:00:00.000Z',
  completedAt: '2026-10-13T05:30:00.000Z',
  simulatedLossRate: null,
  inputs: [],
  outputs: [{ lotId: 1, lotNo: 'HT-BOF1-261013-001', lotType: 'HEAT', itemCode: null, initialTon: '250.000' }],
  inputTon: '277.778',
  outputQty: 1,
  outputTon: '250.000',
  startedHeatLotId: null,
  operatorName: '강민석',
  isSimulated: true,
  simulation: null,
};

describe('생산계획·작업 실적 도구', () => {
  it('생산계획: 번호·수주번호 일부로 거르고 히트 진행을 한글 이름으로', async () => {
    const output = await productionPlanTool(planService).run({ keyword: 'so-2610-002' }, PRODUCTION);
    expect(output.data).toMatchObject({ '생산계획 수': 1, 생산계획: [{ '생산계획 번호': 'PP-2610-0002', 상태: '진행중', '제강 마친 히트 수': 1, '남은 목표 매수': 10 }] });
  });

  it('작업 실적: 생산계획 번호를 id로 바꿔 부르고, 없는 번호는 인자 오류', async () => {
    const queries: unknown[] = [];
    const tool = productionResultTool(planService, {
      listResults: async (query: unknown) => {
        queries.push(query);
        return page([result]);
      },
    } as unknown as ProductionResultService);

    const output = await tool.run({ productionPlanNo: 'PP-2610-0002', processType: 'STEELMAKING' }, PRODUCTION);
    expect(queries[0]).toMatchObject({ productionPlanId: 2, processType: 'STEELMAKING' });
    expect(output.label).toBe('작업 실적 · PP-2610-0002 · 제강');
    expect((output.data as { 안내: string }).안내).toContain('제선 실적은 생산계획에 묶이지 않아');
    expect(output.data).toMatchObject({ '최신 작업 실적': [{ 공정: '제강', 설비: 'BOF1', 시작: '2026-10-13 14:00', '산출 LOT': ['HT-BOF1-261013-001'] }] });
    await expect(tool.run({ productionPlanNo: 'PP-2610-9999' }, PRODUCTION)).rejects.toBeInstanceOf(ToolArgumentError);
    expect(JSON.stringify(output)).not.toContain('공정 실적');
  });

  it('작업 실적: 산출 LOT은 앞 5개만 보내고 생략한 수를 함께 준다', async () => {
    const outputs = Array.from({ length: 8 }, (_, i) => ({ lotId: i + 1, lotNo: `SL-261013-00${i + 1}`, lotType: 'SLAB', itemCode: null, initialTon: '29.438' }));
    const cast = { ...result, processType: 'CONTINUOUS_CASTING', converterCode: null, outputs, outputQty: 8 } as ProductionResultView;
    const tool = productionResultTool(planService, { listResults: async () => page([cast]) } as unknown as ProductionResultService);

    const output = await tool.run({}, PRODUCTION);
    const row = (output.data as { '최신 작업 실적': Record<string, unknown>[] })['최신 작업 실적'][0];
    expect(row['산출 LOT']).toHaveLength(5);
    expect(row).toMatchObject({ '산출 LOT 수': 8, '생략한 산출 LOT 수': 3 });
    expect(output.data).not.toHaveProperty('안내');
  });
});

const inspected = {
  lotId: 5,
  lotNo: 'HT-BOF1-261013-001-01',
  lotType: 'SLAB',
  lotStatus: 'AVAILABLE',
  processType: 'CONTINUOUS_CASTING',
  steelGradeId: 1,
  steelGradeCode: 'SS275',
  thicknessMm: '250',
  itemId: 1,
  itemCode: 'SL-SS275-250x1200x10000',
  itemName: null,
  producedDate: '2026-10-13',
  productionPlanId: 1,
  productionPlanNo: 'PP-2610-0001',
  heatLotId: 1,
  heatLotNo: 'HT-BOF1-261013-001',
  heatInspectionResult: 'PASS',
} as const;

describe('검사 결과·불합격 LOT 도구', () => {
  it('검사 결과: 거르기 조건을 service에 넘기고, 판정이 없으면 검사 대기', async () => {
    const queries: unknown[] = [];
    const item: QualityInspectionListItem = { ...inspected, qualityInspectionId: null, inspectionStandardId: null, inspectionStandardCode: null, versionNo: null, inspectionResult: null, inspectedAt: null, isLocked: false };
    const tool = qualityInspectionTool({
      listQualityInspections: async (query: unknown) => {
        queries.push(query);
        return page([item]);
      },
    } as unknown as QualityService);
    const output = await tool.run({ status: 'pending', lotNo: 'HT-BOF1' }, user(ROLE.QUALITY));
    expect(queries[0]).toMatchObject({ status: 'pending', lotNo: 'HT-BOF1', page: 1 });
    expect(output.label).toBe('검사 결과 · 검사 대기 · HT-BOF1');
    expect(output.data).toMatchObject({ 검사: [{ 'LOT 번호': 'HT-BOF1-261013-001-01', 공정: '연주', 판정: '검사 대기', '상위 히트 판정': '합격' }] });
  });

  it('불합격 LOT: 사용자를 service에 넘기고, 기준을 벗어난 항목만 보인다', async () => {
    const users: AuthUser[] = [];
    const failed = { inspectionStandardItemId: 1, inspectionItemCode: 'C', inspectionItemName: 'C', unit: '%', minValue: null, maxValue: '0.18', thicknessOverMm: null, thicknessUptoMm: null, isRequired: true, measuredValue: '0.21', isPassed: false };
    const item: RejectedLotListItem = {
      ...inspected,
      qualityInspectionId: 3,
      inspectionResult: 'FAIL',
      dispositionStatus: 'HOLD',
      dispositionReason: '재검 대기',
      updatedAt: '2026-10-13T05:00:00.000Z',
      evidence: { qualityInspectionId: 3, lotId: 5, inspectedAt: '2026-10-13T05:00:00.000Z', failedItems: [failed, { ...failed, inspectionItemName: 'Mn', isPassed: true }] },
    };
    const tool = rejectedLotTool({
      listRejectedLots: async (_query: unknown, u: AuthUser) => {
        users.push(u);
        return page([item]);
      },
    } as unknown as RejectedLotService);
    const quality = user(ROLE.QUALITY, { DISPOSITION_SET: 'USE' });
    const output = await tool.run({}, quality);
    expect(users).toEqual([quality]);
    expect(output.data).toMatchObject({ '불합격 LOT': [{ 판정: '불합격', '불합격 상태': '보류', '기준을 벗어난 항목': ['C 0.21% (기준 ~0.18)'] }] });
  });
});

describe('구매·입고·출하·밀시트 도구', () => {
  const requisition = (no: string, itemCode: string): PurchaseRequisitionSummary => ({
    id: 1,
    purchaseRequisitionNo: no,
    purchaseRequisitionStatus: 'WAITING_APPROVAL',
    itemId: 1,
    itemCode,
    itemName: '석회석',
    defaultSupplierId: null,
    defaultSupplierName: null,
    requestedTon: '120.000',
    desiredReceiptDate: '2026-10-20',
    requesterId: 5,
    requesterName: '정다은',
    departmentId: 2,
    departmentName: '구매부',
    approverId: 4,
    approverName: '최준혁',
    approvedAt: null,
    productionPlanId: null,
    productionPlanNo: null,
    actionDraftId: null,
    purchaseOrderNo: null,
    rejectedAt: null,
    createdAt: '2026-10-13T05:00:00.000Z',
    updatedAt: '2026-10-13T05:00:00.000Z',
  });

  it('구매요청: 사용자를 service에 넘겨 부서장 범위를 그대로 따르고, 원료로 거른다', async () => {
    const calls: [AuthUser, unknown][] = [];
    const tool = purchaseRequisitionTool({
      listRequisitions: async (u: AuthUser, query: unknown) => {
        calls.push([u, query]);
        return page([requisition('PR-2610-0001', 'LIM01'), requisition('PR-2610-0002', 'COL01')]);
      },
    } as unknown as PurchasingService);
    const head = user(ROLE.SALES, {}, [1]);
    const output = await tool.run({ status: 'WAITING_APPROVAL', keyword: 'lim01' }, head);
    expect(calls[0]).toEqual([head, { purchaseRequisitionStatus: 'WAITING_APPROVAL', page: 1, size: 100 }]);
    expect(output.data).toMatchObject({ '구매요청 수': 1, 구매요청: [{ '구매요청 번호': 'PR-2610-0001', 상태: '승인 대기', '요청 톤': '120.000', '승인·반려한 부서장': '최준혁' }] });
  });

  it('발주: 품목별 입고예정일·미입고 톤을 주고, 원료 이름으로도 거른다', async () => {
    const order: PurchaseOrderView = {
      id: 1,
      purchaseOrderNo: 'PO-2610-0009',
      purchaseOrderStatus: 'PARTIALLY_RECEIVED',
      supplierId: 1,
      supplierName: '한국광물',
      orderedEmployeeName: '정다은',
      totalOrderedTon: '8.000',
      totalReceivedTon: '5.000',
      totalRemainingTon: '3.000',
      createdAt: '2026-10-13T05:00:00.000Z',
      updatedAt: '2026-10-13T05:00:00.000Z',
      items: [{ purchaseOrderItemId: 1, purchaseRequisitionId: 1, purchaseRequisitionNo: 'PR-2610-0005', itemId: 4, itemCode: 'SMN01', itemName: '망간 합금철', orderedTon: '8.000', expectedReceiptDate: '2026-10-15', receivedTon: '5.000', remainingTon: '3.000' }],
    };
    const tool = purchaseOrderTool({ listPurchaseOrders: async () => page([order]) } as unknown as PurchasingService);
    const output = await tool.run({ keyword: '망간' }, user(ROLE.PURCHASE));
    expect(output.label).toBe('발주·입고예정 · 망간');
    expect(output.data).toMatchObject({ 발주: [{ '발주 번호': 'PO-2610-0009', '미입고 톤': '3.000', 품목: [{ 입고예정일: '2026-10-15', '미입고 톤': '3.000' }] }] });
  });

  it('입고·밀시트: 거를 말이 있으면 100건을 읽어 거르고, 없으면 최신 15건만', async () => {
    const sizes: number[] = [];
    const receipt = { goodsReceiptNo: 'GR-2610-0001', purchaseOrderNo: 'PO-2610-0009', itemCode: 'SMN01', itemName: '망간 합금철', receivedTon: '5.000', receivedDate: '2026-10-13' } as GoodsReceiptView;
    const receipts = goodsReceiptTool({
      listGoodsReceipts: async (query: { size: number }) => {
        sizes.push(query.size);
        return page([receipt], 30);
      },
    } as unknown as PurchasingService);
    expect((await receipts.run({}, user(ROLE.PURCHASE))).data).toMatchObject({ '입고 수': 30, '생략 줄 수': 29 });
    expect((await receipts.run({ keyword: 'PO-2610-0009' }, user(ROLE.PURCHASE))).data).toMatchObject({ '입고 수': 1, '생략 줄 수': 0 });
    expect(sizes).toEqual([15, 100]);

    const sheet: MillSheetSummary = { id: 1, millSheetNo: 'MS-2610-0001', shipmentRequestId: 1, shipmentRequestNo: 'SR-2610-0001', salesOrderId: 1, salesOrderNo: 'SO-2610-001', issuedAt: '2026-10-13T05:00:00.000Z', pdfPath: null };
    const sheets = millSheetTool({ listMillSheets: async () => page([sheet]) } as unknown as ShipmentService);
    expect((await sheets.run({ keyword: 'so-2610-001' }, user(ROLE.QUALITY))).data).toMatchObject({ 밀시트: [{ '밀시트 번호': 'MS-2610-0001', '발행 시각': '2026-10-13 14:00' }] });
  });

  it('출하요청: 사용자와 거르기 조건을 service에 넘긴다', async () => {
    const calls: [AuthUser, unknown][] = [];
    const request: ShipmentRequestSummary = { id: 1, shipmentRequestNo: 'SR-2610-0001', customerId: 1, customerName: '가람중공업', shipDate: '2026-10-20', shipmentRequestStatus: 'REQUESTED', totalRequestQty: 2, issuedAt: null, createdAt: '', updatedAt: '' };
    const tool = shipmentRequestTool({
      list: async (u: AuthUser, query: unknown) => {
        calls.push([u, query]);
        return page([request]);
      },
    } as unknown as ShipmentService);
    const logistics = user(ROLE.LOGISTICS, { SHIPMENT_REQUEST_MANAGE: 'USE' });
    const output = await tool.run({ shipmentRequestNo: 'SR-2610' }, logistics);
    expect(calls[0]).toEqual([logistics, { shipmentRequestStatus: undefined, shipmentRequestNo: 'SR-2610', page: 1, size: 15 }]);
    expect(output.data).toMatchObject({ 출하요청: [{ '출하요청 번호': 'SR-2610-0001', '요청 매수': 2, '출고 확정 시각': null }] });
  });

  it('출하요청: 고객사 이름은 100건을 읽어 거르고, 건수는 거른 뒤의 수', async () => {
    const queries: unknown[] = [];
    const request = (id: number, customerName: string): ShipmentRequestSummary => ({ id, shipmentRequestNo: `SR-2610-000${id}`, customerId: id, customerName, shipDate: '2026-10-20', shipmentRequestStatus: 'REQUESTED', totalRequestQty: 2, issuedAt: null, createdAt: '', updatedAt: '' });
    const tool = shipmentRequestTool({
      list: async (_u: AuthUser, query: unknown) => {
        queries.push(query);
        return page([request(1, '가람중공업'), request(2, '누리조선')]);
      },
    } as unknown as ShipmentService);
    const output = await tool.run({ customerName: '가람' }, user(ROLE.LOGISTICS, { SHIPMENT_REQUEST_MANAGE: 'USE' }));
    expect(queries[0]).toMatchObject({ page: 1, size: 100 });
    expect(output.label).toBe('출하요청 · 가람');
    expect(output.data).toMatchObject({ '출하요청 수': 1, 출하요청: [{ '출하요청 번호': 'SR-2610-0001' }], '생략 줄 수': 0 });
  });
});

describe('도구 모음: service가 확인하는 권한', () => {
  let listRequisitions: () => Promise<PageResult<PurchaseRequisitionSummary>>;
  const rolesAsked: unknown[] = [];
  const services = { purchasing: { listRequisitions: () => listRequisitions() } } as unknown as AssistantToolServices;
  const toolbox = new AssistantToolbox(
    {} as PrismaService,
    {
      findRoleCodesWithAnyPermission: async (_tx: unknown, permissions: unknown) => {
        rolesAsked.push(permissions);
        return [ROLE.PURCHASE, ROLE.ADMIN];
      },
    } as unknown as AiAssistantRepository,
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
    {} as AiActionCardService,
    {} as AiOpsCardService,
    services.dashboard,
    services.mrp,
    // 일정·업무 고치기 카드와 내 일정·업무 조회 (이슈 #398): 이 시험에서는 부르지 않는다
    {} as never,
    {} as never,
    {} as never,
    // 알림·Agent·초안·기준정보·회의 검색·심층 조사 조회와 브리핑 (이슈 #506): 이 시험에서는 부르지 않는다
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('미리 막지 않고 service에 맡긴다 (부서장은 권한 코드 없이도 자기 부서 구매요청을 본다)', async () => {
    listRequisitions = async () => page([]);
    const result = await toolbox.run(user(ROLE.SALES, {}, [1]), { id: 'c1', name: 'get_purchase_requisitions', arguments: '{}' });
    expect(result.source).toEqual({ kind: 'DATA', id: 'get_purchase_requisitions', label: '구매요청' });
  });

  it('service가 COM-002를 던지면 권한 없음과 담당 역할·안내 문구를 돌려준다', async () => {
    listRequisitions = async () => {
      throw new AppException('COM-002');
    };
    const result = await toolbox.run(user(ROLE.SALES), { id: 'c1', name: 'get_purchase_requisitions', arguments: '{}' });
    expect(result.source).toBeNull();
    expect(rolesAsked.at(-1)).toEqual(['PURCHASE_REQUISITION_CREATE']);
    expect(JSON.parse(result.content)).toEqual({
      오류: '권한 없음',
      안내: expect.stringContaining('부서장은 자기 부서 사원의 구매요청을 볼 수 있어요'),
      '조회할 수 있는 역할': ['구매', '관리자'],
    });
  });

  it('도구 모음이 확인하는 권한은 하나도 없으면 service를 부르지 않는다', async () => {
    const result = await toolbox.run(user(ROLE.SALES), { id: 'c1', name: 'get_production_plans', arguments: '{}' });
    expect(JSON.parse(result.content).오류).toBe('권한 없음');
  });
});

describe('상태 코드 설명', () => {
  it('상태 코드를 공통 코드 표시명과 함께 적는다 (코드만 적으면 모델이 표시명을 지어낸다)', () => {
    expect(codeLabelList(SHIPMENT_REQUEST_STATUS_LABEL)).toBe('REQUESTED(배정 대기), ALLOCATED(배정 확정), ISSUED(출고 완료), CANCELLED(취소)');
    const shipment = shipmentRequestTool({} as ShipmentService).definition;
    const properties = shipment.parameters.properties as Record<string, { description: string }>;
    expect(properties.status.description).toContain('REQUESTED(배정 대기)');
  });
});
