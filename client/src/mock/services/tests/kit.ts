// 서비스 테스트 도우미: 새 시드 위에서 tx를 직접 만들어 서비스를 부른다 (가짜 서버 단위 테스트).
import { expect } from 'vitest';
import type { LotType } from '@/codes';
import { typicalPassValue } from '@/lib/inspectionJudgment';
import { createSeedTables } from '@/mock/seed';
import type { LotRow, MockTables } from '@/mock/schema';
import type { MockTx } from '@/mock/store';
import {
  approvePurchaseRequisition,
  checkInvariants,
  createPurchaseOrdersBySupplier,
  createPurchaseRequisition,
  inspectionFormOf,
  receiveGoods,
  registerInspection,
  userActor,
  type PersonActor,
} from '@/mock/services';

export const EMPLOYEE_NO = {
  admin: '1503001',
  salesHead: '1608002',
  sales: '2103003',
  purchaseHead: '1702004',
  purchase: '2207005',
  productionHead: '1401006',
  ironmakingHead: '1709007',
  steelmakingHead: '1804008',
  hotRollingHead: '2001010',
  steelmaking: '2402011',
  qualityHead: '1802012',
  quality: '2205013',
  logisticsHead: '1610014',
  logistics: '2304015',
} as const;

export interface Kit {
  tables: MockTables;
  /** 이 시각(Asia/Seoul 표기 가능)의 tx */
  at: (iso: string) => MockTx;
  actor: (key: keyof typeof EMPLOYEE_NO) => PersonActor;
  itemId: (itemCode: string) => number;
  customerId: (customerCode: string) => number;
  lot: (lotNo: string) => LotRow;
  lotsOfPlan: (planId: number, lotType: LotType) => LotRow[];
  /** 대표값(기준 안)으로 검사하고 overrides로 일부 값을 바꾼다 */
  inspect: (iso: string, lotId: number, overrides?: Record<string, string>) => ReturnType<typeof registerInspection>;
  expectClean: () => void;
}

export function createKit(): Kit {
  const tables = createSeedTables();
  const at = (iso: string): MockTx => {
    const now = new Date(iso);
    return { tables, now, nowIso: now.toISOString() };
  };
  const find = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`테스트 참조 없음: ${what}`);
    return value;
  };
  return {
    tables,
    at,
    actor: (key) => userActor(find(tables.employee.find((e) => e.employeeNo === EMPLOYEE_NO[key]), key).id),
    itemId: (code) => find(tables.item.find((i) => i.itemCode === code), code).id,
    customerId: (code) => find(tables.customer.find((c) => c.customerCode === code), code).id,
    lot: (lotNo) => find(tables.lot.find((l) => l.lotNo === lotNo), lotNo),
    lotsOfPlan: (planId, lotType) => tables.lot.filter((l) => l.productionPlanId === planId && l.lotType === lotType).sort((a, b) => a.id - b.id),
    inspect: (iso, lotId, overrides = {}) => {
      const form = inspectionFormOf(tables, lotId);
      const quality = userActor(find(tables.employee.find((e) => e.employeeNo === EMPLOYEE_NO.quality), 'quality').id);
      return registerInspection(at(iso), quality, {
        lotId,
        values: form.items.map((i) => ({ inspectionStandardItemId: i.inspectionStandardItemId, measuredValue: overrides[i.inspectionItemCode] ?? typicalPassValue(i) })),
      });
    },
    expectClean: () => expect(checkInvariants(tables)).toEqual([]),
  };
}

/** 오류 코드로 거부되는지 */
export function expectCode(work: () => unknown, code: string): void {
  let caught: unknown = null;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}`).toMatchObject({ code });
}

/** 입력 오류(InputError)로 거부되는지 */
export function expectInputError(work: () => unknown, field?: string): void {
  let caught: unknown = null;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ name: 'InputError' });
  if (field) expect(Object.keys((caught as { fieldErrors: Record<string, string> }).fieldErrors)).toContain(field);
}

/** 원료를 넉넉히 들여온다: 구매요청 → 부서장 승인 → 발주 → 전량 입고 (시드 잔량이 모자란 시나리오용) */
export function stockRawMaterials(k: Kit, iso: string, tons: { ORE01?: string; COL01?: string; LIM01?: string; SMN01?: string } = {}): void {
  const amounts = { ORE01: '2000.000', COL01: '800.000', LIM01: '200.000', SMN01: '30.000', ...tons };
  const purchase = k.actor('purchase');
  const date = new Date(iso);
  const receiptDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
  // 구매요청 1건 = 원료 1품목이라 원료마다 요청한다
  const prs = Object.entries(amounts).map(([code, ton]) =>
    createPurchaseRequisition(k.at(iso), purchase, { itemId: k.itemId(code), requestedTon: ton, desiredReceiptDate: receiptDate, requestReason: '테스트 원료 확보' }),
  );
  for (const pr of prs) approvePurchaseRequisition(k.at(iso), k.actor('purchaseHead'), { purchaseRequisitionId: pr.id });
  createPurchaseOrdersBySupplier(k.at(iso), purchase, prs.map((pr) => pr.id));
  for (const pr of prs) {
    const line = k.tables.purchaseOrderItem.find((l) => l.purchaseRequisitionId === pr.id);
    if (line) receiveGoods(k.at(iso), purchase, { purchaseOrderItemId: line.id, receivedTon: line.orderedTon, receivedDate: receiptDate });
  }
}
