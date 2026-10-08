// 시연 시나리오(업무 프로세스 14.1·14.2·14.3) 시험 도우미: 화면 api 함수만 부르고, 사원은 actAs로 바꾼다.
// 테스트 파일에서만 쓴다 (화면 코드는 쓰지 않는다). 시각은 Date만 가짜로 돌려 업무 번호·납기 계산을 고정한다.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { actingEmployeeId } from '@/api/actor';
import { mockMutation } from '@/api/client';
import { inspectionApi, type RegisterInspectionOutcome } from '@/api/inspections';
import type { MrpPeriod, MrpRequirementsView } from '@/api/mrp';
import { readDb } from '@/api/productionTestKit';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import {
  approvePurchaseRequisition,
  checkInvariants,
  computeMrpForPeriod,
  createPurchaseOrdersBySupplier,
  createPurchaseRequisition,
  receiveGoods,
  userActor,
  type PersonActor,
} from '@/mock/services';
import type { MockTx } from '@/mock/store';
import { actAs, employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

export { itemIdOf, lotOf, lotsOfPlan, planIdOf, readDb } from '@/api/productionTestKit';

/** 시드 사원 (actors.ts 12명 + 제선·열연 파트장) */
export const EMP = {
  ...SEED_EMPLOYEE_NO,
  /** 윤성호 · 제선파트 부서장 · 생산 */
  ironmakingHead: '1709007',
  /** 한승우 · 열연파트 부서장 · 생산 */
  hotRollingHead: '2001010',
} as const;

export type EmpKey = keyof typeof EMP;

/** 이 사원으로 요청한다 */
export const as = (key: EmpKey): number => actAs(EMP[key]);
export const idOf = (key: EmpKey): number => employeeIdOf(EMP[key]);

/**
 * MRP: 화면 API는 두 모드 모두 서버가 계산해서, 가짜 DB 시나리오는 core 계산을 서버 응답 모양으로 옮겨 본다
 * (이유별 공급 내역·예상 여재는 서버에 없어 뺀다)
 */
export function mockMrp(period: MrpPeriod): MrpRequirementsView {
  const view = readDb((t) => computeMrpForPeriod(t, period));
  return {
    from: view.from,
    to: view.to,
    heatCapacityTon: view.heatCapacityTon,
    plans: view.plans.map(({ needDate, beforePeriod, expectedSurplusSlabQty: _surplus, materials, ...plan }) => ({
      ...plan,
      requiredDate: needDate,
      isBeforePeriod: beforePeriod,
      materials: materials.map((m) => ({ itemId: m.itemId, itemCode: m.itemCode, requiredTon: m.grossTon, netRequirementTon: m.netTon })),
    })),
    materials: view.materials.map((m) => ({
      itemId: m.itemId,
      itemCode: m.itemCode,
      itemName: m.itemName,
      rawMaterialType: m.rawMaterialType,
      requiredTon: m.grossTon,
      remainingTon: m.onHandTon,
      scheduledReceiptTon: m.scheduledReceiptTon,
      usedRemainingTon: m.coveredOnHandTon,
      usedScheduledReceiptTon: m.coveredScheduledTon,
      netRequirementTon: m.netTon,
      firstShortageDate: m.firstShortageDate,
    })),
    requisitionLines: view.requisitionLines.map(({ netTon, needDate, ...line }) => ({ ...line, netRequirementTon: netTon, requiredDate: needDate })),
  };
}

/** 이 describe 안에서 Date만 가짜로 돌린다 (응답 지연용 setTimeout은 그대로) */
export function useScenarioClock(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** 지금을 이 시각으로 (Asia/Seoul 표기 가능) */
export const at = (iso: string): void => {
  vi.setSystemTime(new Date(iso));
};

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`테스트 참조 없음: ${what}`);
  return value;
}

export const customerIdOf = (customerCode: string): number => must(readDb((t) => t.customer.find((c) => c.customerCode === customerCode)), customerCode).id;
export const salesOrderIdOf = (salesOrderNo: string): number => must(readDb((t) => t.salesOrder.find((s) => s.salesOrderNo === salesOrderNo)), salesOrderNo).id;
export const soItemIdsOf = (salesOrderId: number): number[] =>
  readDb((t) => t.salesOrderItem.filter((i) => i.salesOrderId === salesOrderId).sort((a, b) => a.lineNo - b.lineNo).map((i) => i.id));

/** 모든 불변조건(예약·재고·배정·밀시트·LOT 번호)이 지켜지는지 */
export const expectClean = (): void => {
  expect(readDb((t) => checkInvariants(t))).toEqual([]);
};

/** 품질 담당이 대표값(기준 안)으로 검사하고 overrides(항목 코드 → 값)로 일부를 바꾼다 */
export async function inspectViaApi(lotId: number, overrides: Record<string, string> = {}): Promise<RegisterInspectionOutcome> {
  as('quality');
  const form = await inspectionApi.detail(lotId);
  return inspectionApi.register({
    lotId,
    values: form.items.map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: overrides[i.inspectionItemCode] ?? typicalPassValue(i) })),
    expectedUpdatedAt: form.updatedAt,
  });
}

/** 원료를 넉넉히 들여온다: 구매 담당 요청 → 구매 부서장 승인 → 공급업체별 발주 → 전량 입고 (core 서비스) */
export async function stockRawMaterials(receiptDate: string, tons: Partial<Record<'ORE01' | 'COL01' | 'LIM01' | 'SMN01', string>> = {}): Promise<void> {
  const amounts = { ORE01: '2000.000', COL01: '800.000', LIM01: '200.000', SMN01: '30.000', ...tons };
  const purchase = userActor(idOf('purchase'));
  const head = userActor(idOf('purchaseHead'));
  await mockMutation((tx) => {
    // 구매요청 1건 = 원료 1품목이라 원료마다 요청한다
    const requisitions = Object.entries(amounts).map(([code, ton]) =>
      createPurchaseRequisition(tx, purchase, { itemId: must(tx.tables.item.find((i) => i.itemCode === code), code).id, requestedTon: ton, desiredReceiptDate: receiptDate, requestReason: '시연 원료 확보' }),
    );
    for (const pr of requisitions) approvePurchaseRequisition(tx, head, { purchaseRequisitionId: pr.id });
    createPurchaseOrdersBySupplier(tx, purchase, requisitions.map((pr) => pr.id));
    for (const pr of requisitions) {
      const line = must(tx.tables.purchaseOrderItem.find((l) => l.purchaseRequisitionId === pr.id), `발주 품목 ${pr.purchaseRequisitionNo}`);
      receiveGoods(tx, purchase, { purchaseOrderItemId: line.id, receivedTon: line.orderedTon, receivedDate: receiptDate });
    }
  });
}

/** 구매(요청·승인·발주·입고) 화면 API는 서버만 불러서, 가짜 DB 시나리오는 지금 사원(as)으로 core 서비스를 바로 부른다 */
export const asPurchaseCore = <T>(work: (tx: MockTx, actor: PersonActor) => T): Promise<T> =>
  mockMutation((tx) => work(tx, userActor(must(actingEmployeeId(), '로그인 사원'))));
