// 검사 입력 API (REQ-QC-001·003, REQ-INV-004·007, BP-QC-01, 14.1 4~6단계).
// 권한은 이 층이 먼저 확인하고(requireActor), 판정·자동 예약·여재·히트 불합격 연쇄·작업 로그는 핵심 서비스(registerInspection)가 한다.
import { requireActor } from '@/api/actor';
import { mockMutation, mockQuery } from '@/api/client';
import { PERMISSION, type InspectionResult, type SalesOrderItemStatus } from '@/codes';
import type { MockTables } from '@/mock/schema';
import {
  findById,
  inspectionFormOf,
  inspectionQueue,
  itemShortageOf,
  lotTimeline,
  registerInspection,
  userActor,
  type InspectionFormView,
  type InspectionQueueRow,
  type ItemShortage,
  type RegisterInspectionInput,
  type TimelineEvent,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

export const inspectionKeys = {
  all: ['quality-inspections'] as const,
  queue: () => ['quality-inspections', 'queue'] as const,
  detail: (lotId: number) => ['quality-inspections', 'detail', lotId] as const,
};

/** 검사 대상 LOT이 만들어진 계획의 수주 품목과 그 부족 (4.5). 재생산 필요 = 14.1-6 */
export interface LinkedSalesOrderItem {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderItemId: number;
  lineNo: number;
  customerName: string;
  itemCode: string;
  orderedQty: number;
  dueDate: string;
  salesOrderItemStatus: SalesOrderItemStatus;
  shortage: ItemShortage;
}

export interface InspectionDetail extends InspectionFormView {
  productionPlanId: number | null;
  heatLotId: number | null;
  salesOrderItem: LinkedSalesOrderItem | null;
  /** 이 LOT의 작업 로그 (시간순) */
  history: TimelineEvent[];
}

export interface RegisterInspectionOutcome {
  lotId: number;
  lotNo: string;
  inspectionResult: InspectionResult;
  /** 원래 수주 품목에 자동 예약한 매수 (SYSTEM) */
  autoReservedQty: number;
  /** 여재로 표시한 LOT 번호 */
  surplusLotNos: string[];
  /** 불합격으로 적격에서 빠진 LOT 수 (히트면 하위 슬래브·코일 포함) */
  excludedLotQty: number;
  salesOrderItem: LinkedSalesOrderItem | null;
}

/** LOT을 만든 생산계획의 수주 품목 (연결이 없으면 null) */
export function linkedSalesOrderItemOf(tables: Tables, productionPlanId: number | null): LinkedSalesOrderItem | null {
  const plan = findById(tables, 'productionPlan', productionPlanId);
  const soItem = findById(tables, 'salesOrderItem', plan?.salesOrderItemId);
  if (!soItem) return null;
  const so = findById(tables, 'salesOrder', soItem.salesOrderId);
  if (!so) return null;
  return {
    salesOrderId: so.id,
    salesOrderNo: so.salesOrderNo,
    salesOrderItemId: soItem.id,
    lineNo: soItem.lineNo,
    customerName: findById(tables, 'customer', so.customerId)?.customerName ?? '',
    itemCode: findById(tables, 'item', soItem.itemId)?.itemCode ?? '',
    orderedQty: soItem.orderedQty,
    dueDate: soItem.dueDate,
    salesOrderItemStatus: soItem.salesOrderItemStatus,
    shortage: itemShortageOf(tables, soItem),
  };
}

const READ_RULE = { view: [PERMISSION.INSPECTION_REGISTER] } as const;

export const inspectionApi = {
  /** 검사 대상 목록: 판정 대기 먼저(생산완료일 → LOT 번호), 그다음 최근 판정 */
  queue: (): Promise<InspectionQueueRow[]> =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return inspectionQueue(tables);
    }),

  /** 입력 폼: 판정에 쓰는 기준 버전, 두께 구간으로 거른 항목, 현재 값, 잠금, 연결 수주의 부족, 작업 로그 */
  detail: (lotId: number): Promise<InspectionDetail> =>
    mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      const form = inspectionFormOf(tables, lotId);
      const lot = findById(tables, 'lot', lotId);
      return {
        ...form,
        productionPlanId: lot?.productionPlanId ?? null,
        heatLotId: form.lot.heatLotId,
        salesOrderItem: linkedSalesOrderItemOf(tables, lot?.productionPlanId ?? null),
        history: lotTimeline(tables, lotId),
      };
    }),

  /**
   * 측정값 등록·수정 (같은 검사 기록). 필수 누락이면 판정 대기, 밀시트 발행 뒤에는 막힌다.
   * 오류: COM-002(검사 입력 사용 권한), COM-003(LOT 없음), COM-001(연 뒤 바뀜), MST-001(검사 기준 없음), 입력 오류(형식·기준에 없는 항목·잠금)
   */
  register: (input: RegisterInspectionInput): Promise<RegisterInspectionOutcome> =>
    mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.INSPECTION_REGISTER] });
      const result = registerInspection(tx, userActor(actor.employee.id), input);
      const lot = findById(tx.tables, 'lot', input.lotId);
      return {
        lotId: input.lotId,
        lotNo: lot?.lotNo ?? '',
        inspectionResult: result.inspection.inspectionResult,
        autoReservedQty: result.autoReservedQty,
        surplusLotNos: result.surplusLotNos,
        excludedLotQty: result.excludedLotQty,
        salesOrderItem: linkedSalesOrderItemOf(tx.tables, lot?.productionPlanId ?? null),
      };
    }),
};
