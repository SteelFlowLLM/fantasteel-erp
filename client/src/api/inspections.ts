// 검사 입력 API (REQ-QC-001·003, REQ-INV-004·007, BP-QC-01, 14.1 4~6단계).
// 권한은 이 층이 먼저 확인하고(requireActor), 판정·자동 예약·여재·히트 불합격 연쇄·작업 로그는 핵심 서비스(registerInspection)가 한다.
// 서버 모드(기본)면 실제 서버를 부른다 (api/server/inspections.ts). 권한·판정·재고 반영은 서버가 한다.
import { requireActor } from '@/api/actor';
import type { TimelineEvent } from '@/api/businessEvents';
import { mockMutation, mockQuery } from '@/api/client';
import { isServerDataSource } from '@/api/http';
import { serverInspectionApi } from '@/api/server/inspections';
import { PERMISSION, type InspectionResult, type LotStatus, type LotType, type SalesOrderItemStatus } from '@/codes';
import { inspectionItemCodesOfHistory } from '@/features/quality/lib/qualityDisplay';
import type { MockTables } from '@/mock/schema';
import {
  findById,
  inspectionFormOf,
  inspectionQueue,
  itemShortageOf,
  lotTimeline,
  registerInspection,
  userActor,
  type ItemShortage,
} from '@/mock/services';

type Tables = Readonly<MockTables>;

/**
 * 서버 모드에서 아직 받아 오지 못하는 값(작업 로그·불합격 지정 시각, api/server 주석 참고)인지.
 * 화면은 실제로 없는 값("없음")과 구분해 "준비 중"으로 보인다
 */
export const isServerPendingValue = (): boolean => isServerDataSource();

export const inspectionKeys = {
  all: ['quality-inspections'] as const,
  queue: () => ['quality-inspections', 'queue'] as const,
  detail: (lotId: number) => ['quality-inspections', 'detail', lotId] as const,
};

export interface InspectionQueueRow {
  lotId: number;
  lotNo: string;
  lotType: LotType;
  lotStatus: LotStatus;
  processType: string;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  steelGradeCode: string | null;
  thicknessMm: string | null;
  producedDate: string;
  heatLotId: number | null;
  heatNo: string | null;
  heatResult: InspectionResult | null;
  productionPlanNo: string | null;
  qualityInspectionId: number | null;
  inspectionResult: InspectionResult;
  inspectionStandardCode: string | null;
  inspectionStandardVersion: number | null;
  inspectedAt: string | null;
  inspectorName: string | null;
  locked: boolean;
}

export interface InspectionFormItem {
  inspectionStandardItemId: number;
  inspectionItemCode: string;
  inspectionItemName: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
  minThicknessMm: string | null;
  maxThicknessMm: string | null;
  isRequired: boolean;
  sortOrder: number;
  measuredValue: string | null;
  isPassed: boolean | null;
}

export interface InspectionFormView {
  lot: InspectionQueueRow;
  qualityInspectionId: number | null;
  /** 이 검사 행의 수정 시각 (registerInspection의 expectedUpdatedAt) */
  updatedAt: string | null;
  inspectionResult: InspectionResult;
  /** 판정에 쓰는(쓴) 기준 버전. 값을 넣은 적이 없으면 현재 버전 */
  standard: { id: number; inspectionStandardCode: string; version: number; isCurrent: boolean } | null;
  currentStandard: { id: number; inspectionStandardCode: string; version: number } | null;
  /** 두께 구간(초과~이하)으로 거른 적용 항목 (샤르피는 SM 강종·6mm 초과 코일만) */
  items: InspectionFormItem[];
  locked: boolean;
  lockedMillSheetNos: string[];
}

export interface RegisterInspectionInput {
  lotId: number;
  /** 입력한 항목 값. 빈 값(null·'')은 지운다. 넘기지 않은 항목은 그대로 둔다. */
  values: readonly { inspectionStandardItemId: number; measuredValue: string | null }[];
  /** 화면을 연 시점의 quality_inspection.updatedAt (없으면 확인 안 함) */
  expectedUpdatedAt?: string | null;
}

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
  /** 작업 로그의 검사 등록에 나온 항목 코드 → 검사 항목명 (inspection_standard_item.inspection_item_name) */
  inspectionItemNames: Record<string, string>;
}

export interface RegisterInspectionOutcome {
  lotId: number;
  lotNo: string;
  inspectionResult: InspectionResult;
  /** 원래 수주 품목에 자동 예약한 매수 (SYSTEM) */
  autoReservedQty: number;
  /** 여재로 표시한 LOT 번호 */
  surplusLotNos: string[];
  /** 여재가 된 매수. 서버 모드는 LOT 번호 없이 매수만 안다 */
  surplusQty: number;
  /** 불합격으로 적격에서 빠진 LOT 수 (히트면 하위 슬래브·코일 포함) */
  excludedLotQty: number;
  /** 적격에서 빠진 LOT의 확정 배정을 해제한 건수 */
  releasedAllocationCount: number;
  /** 가용이 줄어 해제한 예약 매수 */
  releasedReservationQty: number;
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
    isServerDataSource()
      ? serverInspectionApi.queue()
      : mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      return inspectionQueue(tables);
    }),

  /** 입력 폼: 판정에 쓰는 기준 버전, 두께 구간으로 거른 항목, 현재 값, 잠금, 연결 수주의 부족, 작업 로그 */
  detail: (lotId: number): Promise<InspectionDetail> =>
    isServerDataSource()
      ? serverInspectionApi.detail(lotId)
      : mockQuery((tables) => {
      requireActor(tables, READ_RULE);
      const form = inspectionFormOf(tables, lotId);
      const lot = findById(tables, 'lot', lotId);
      return {
        ...form,
        productionPlanId: lot?.productionPlanId ?? null,
        heatLotId: form.lot.heatLotId,
        salesOrderItem: linkedSalesOrderItemOf(tables, lot?.productionPlanId ?? null),
        ...historyWithItemNames(tables, lotId),
      };
    }),

  /**
   * 측정값 등록·수정 (같은 검사 기록). 필수 누락이면 판정 대기, 밀시트 발행 뒤에는 막힌다.
   * 오류: COM-002(검사 입력 사용 권한), COM-003(LOT 없음), COM-001(연 뒤 바뀜), MST-001(검사 기준 없음), 입력 오류(형식·기준에 없는 항목·잠금)
   */
  register: (input: RegisterInspectionInput): Promise<RegisterInspectionOutcome> =>
    isServerDataSource()
      ? serverInspectionApi.register(input)
      : mockMutation((tx) => {
      const actor = requireActor(tx.tables, { use: [PERMISSION.INSPECTION_REGISTER] });
      const result = registerInspection(tx, userActor(actor.employee.id), input);
      const lot = findById(tx.tables, 'lot', input.lotId);
      return {
        lotId: input.lotId,
        lotNo: lot?.lotNo ?? '',
        inspectionResult: result.inspection.inspectionResult,
        autoReservedQty: result.autoReservedQty,
        surplusLotNos: result.surplusLotNos,
        surplusQty: result.surplusLotNos.length,
        excludedLotQty: result.excludedLotQty,
        releasedAllocationCount: result.releasedAllocationCount,
        releasedReservationQty: result.releasedReservationQty,
        salesOrderItem: linkedSalesOrderItemOf(tx.tables, lot?.productionPlanId ?? null),
      };
    }),
};

/**
 * LOT의 작업 로그와, 그 로그의 검사 등록 전후 값에 나온 항목 코드의 검사 항목명.
 * 히트 불합격 하위 LOT처럼 화면의 검사 폼과 로그의 항목이 다를 수 있어서 로그에서 코드를 모은다. 현재 기준의 이름을 먼저 쓴다.
 */
export function historyWithItemNames(tables: Tables, lotId: number): { history: TimelineEvent[]; inspectionItemNames: Record<string, string> } {
  const history = lotTimeline(tables, lotId);
  const currentStandardIds = new Set(tables.inspectionStandard.filter((s) => s.isCurrent).map((s) => s.id));
  const inspectionItemNames: Record<string, string> = {};
  for (const code of inspectionItemCodesOfHistory(history)) {
    const items = tables.inspectionStandardItem.filter((i) => i.inspectionItemCode === code);
    const item = items.find((i) => currentStandardIds.has(i.inspectionStandardId)) ?? items[0];
    if (item) inspectionItemNames[code] = item.inspectionItemName;
  }
  return { history, inspectionItemNames };
}
