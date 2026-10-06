// 시연 시나리오(업무 프로세스 14.1·14.2·14.3) 시험 도우미: 화면 api 함수만 부르고, 사원은 actAs로 바꾼다.
// 테스트 파일에서만 쓴다 (화면 코드는 쓰지 않는다). 시각은 Date만 가짜로 돌려 업무 번호·납기 계산을 고정한다.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { approvalApi } from '@/api/approvals';
import { goodsReceiptApi } from '@/api/goodsReceipts';
import { inspectionApi, type RegisterInspectionOutcome } from '@/api/inspections';
import { purchaseOrderApi, purchaseRequisitionApi } from '@/api/purchasing';
import { readDb } from '@/api/productionTestKit';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import { checkInvariants } from '@/mock/services';
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

/** 원료를 넉넉히 들여온다: 구매 담당 요청 → 구매 부서장 승인 → 발주 → 전량 입고 (모두 화면 api) */
export async function stockRawMaterialsViaApi(receiptDate: string, tons: Partial<Record<'ORE01' | 'COL01' | 'LIM01' | 'SMN01', string>> = {}): Promise<void> {
  const amounts = { ORE01: '2000.000', COL01: '800.000', LIM01: '200.000', SMN01: '30.000', ...tons };
  as('purchase');
  // 구매요청 1건 = 원료 1품목이라 원료마다 요청한다
  const requisitionIds: number[] = [];
  for (const [code, ton] of Object.entries(amounts)) {
    const itemId = readDb((t) => must(t.item.find((i) => i.itemCode === code), code).id);
    requisitionIds.push((await purchaseRequisitionApi.create({ desiredReceiptDate: receiptDate, requestReason: '시연 원료 확보', itemId, requestedTon: ton })).id);
  }
  as('purchaseHead');
  for (const id of requisitionIds) await approvalApi.approve({ purchaseRequisitionId: id, expectedUpdatedAt: (await purchaseRequisitionApi.detail(id)).updatedAt });
  as('purchase');
  // 발주는 공급업체 1곳당 1건: 원료마다 기본 공급업체가 달라 후보 요청마다 발주 1건
  const candidates = (await purchaseOrderApi.candidateItems()).filter((i) => requisitionIds.includes(i.id));
  const purchaseOrders = await purchaseOrderApi.create(
    candidates.map((i) => ({ supplierId: i.supplierId ?? 0, items: [{ purchaseRequisitionId: i.id, orderedTon: i.requestedTon, expectedReceiptDate: '' }] })),
  );
  for (const line of purchaseOrders.flatMap((po) => po.items)) {
    await goodsReceiptApi.receive({ purchaseOrderItemId: line.id, receivedTon: line.remainingTon, receivedDate: receiptDate });
  }
}
