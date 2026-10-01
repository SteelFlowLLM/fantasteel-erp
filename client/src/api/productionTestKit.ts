// 생산 영역 api 테스트 도우미: 가짜 DB(시드)에서 번호로 행을 찾고, 시험에 필요한 수주·원료를 core 서비스로 만든다.
// 테스트 파일에서만 쓴다 (화면 코드는 쓰지 않는다).
import { mockMutation } from '@/api/client';
import { getMockDb } from '@/mock/db';
import type { MockTables } from '@/mock/schema';
import {
  approvePurchaseRequisition,
  createPurchaseOrders,
  createPurchaseRequisition,
  createSalesOrder,
  receiveGoods,
  userActor,
} from '@/mock/services';
import { toSeoulDateString } from '@/lib/seoulDate';
import { employeeIdOf, SEED_EMPLOYEE_NO } from '@/test/actors';

export const readDb = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`테스트 참조 없음: ${what}`);
  return value;
}

export const planIdOf = (productionPlanNo: string): number =>
  must(readDb((t) => t.productionPlan.find((p) => p.productionPlanNo === productionPlanNo)), productionPlanNo).id;

export const planOf = (productionPlanId: number) => must(readDb((t) => t.productionPlan.find((p) => p.id === productionPlanId)), `plan ${productionPlanId}`);

export const itemIdOf = (itemCode: string): number => must(readDb((t) => t.item.find((i) => i.itemCode === itemCode)), itemCode).id;

export const lotOf = (lotNo: string) => must(readDb((t) => t.lot.find((l) => l.lotNo === lotNo)), lotNo);

export const lotsOfPlan = (productionPlanId: number, lotType: string) =>
  readDb((t) => t.lot.filter((l) => l.productionPlanId === productionPlanId && l.lotType === lotType).sort((a, b) => a.id - b.id));

export const eventsOf = (businessEventType: string) => readDb((t) => t.businessEvent.filter((e) => e.businessEventType === businessEventType));

/** 영업 사원이 수주를 등록한다 (재고 우선 예약 + 부족분 생산계획). 만들어진 계획 id를 돌려준다. */
export async function createSalesOrderForTest(customerCode: string, items: { itemCode: string; orderedQty: number; dueDate: string }[]): Promise<{ salesOrderId: number; planIds: number[]; salesOrderItemIds: number[] }> {
  const salesId = employeeIdOf(SEED_EMPLOYEE_NO.sales);
  const customerId = must(readDb((t) => t.customer.find((c) => c.customerCode === customerCode)), customerCode).id;
  const result = await mockMutation((tx) =>
    createSalesOrder(tx, userActor(salesId), { customerId, items: items.map((i) => ({ itemId: itemIdOf(i.itemCode), orderedQty: i.orderedQty, dueDate: i.dueDate })) }),
  );
  return { salesOrderId: result.salesOrder.id, planIds: result.productionPlans.map((p) => p.id), salesOrderItemIds: result.items.map((i) => i.id) };
}

/** 원료를 넉넉히 들여온다 (구매요청 → 부서장 승인 → 발주 → 전량 입고, 오늘 입고) */
export async function stockRawMaterialsForTest(): Promise<void> {
  const purchase = userActor(employeeIdOf(SEED_EMPLOYEE_NO.purchase));
  const head = userActor(employeeIdOf(SEED_EMPLOYEE_NO.purchaseHead));
  const amounts: Record<string, string> = { ORE01: '2000.000', COL01: '800.000', LIM01: '200.000', SMN01: '30.000' };
  await mockMutation((tx) => {
    const { purchaseRequisition, items } = createPurchaseRequisition(tx, purchase, {
      requestReason: '테스트 원료 확보',
      items: Object.entries(amounts).map(([code, ton]) => ({ itemId: itemIdOf(code), requiredTon: ton })),
    });
    approvePurchaseRequisition(tx, head, { purchaseRequisitionId: purchaseRequisition.id });
    createPurchaseOrders(tx, purchase, { purchaseRequisitionItemIds: items.map((i) => i.id) });
    for (const item of items) {
      const line = tx.tables.purchaseOrderItem.find((l) => l.purchaseRequisitionItemId === item.id);
      if (line) receiveGoods(tx, purchase, { purchaseOrderItemId: line.id, receivedTon: line.scheduledReceiptTon, receiptDate: toSeoulDateString(tx.now) });
    }
  });
}
