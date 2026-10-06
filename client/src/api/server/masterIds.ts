// 서버 모드에서 기준정보 id를 맞춘다.
// 수주·출하 화면만 서버를 쓰고 나머지 화면(기준정보·재고·생산 …)은 아직 가짜 DB를 쓰므로, 화면에 보이는 고객사·규격·사원 id는
// 계속 가짜 DB id로 둔다. 서버에 보낼 때와 서버 응답을 받을 때 코드(고객사 코드·규격 코드·사원번호)나 이름으로 바꿔 끼운다.
// 가짜 DB 시드와 서버 시드는 코드가 같다 (다른 것: 화면 첫 코일 규격 2.3×1200×1,065,000 ↔ 서버 2.5×1200×980,000).
import type { CustomerView, ItemView } from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import { getMockDb } from '@/mock/db';
import type { ItemRow, MockTables, SteelGradeRow } from '@/mock/schema';

let customersPromise: Promise<CustomerView[]> | null = null;
let itemsPromise: Promise<ItemView[]> | null = null;

/** 기준정보는 자주 바뀌지 않아 탭에 한 번만 읽는다. 실패하면 다음에 다시 읽는다 */
function cached<T>(get: () => Promise<T[]>, read: () => Promise<T[]> | null, write: (p: Promise<T[]> | null) => void): Promise<T[]> {
  const found = read();
  if (found) return found;
  const promise = get();
  write(promise);
  promise.catch(() => write(null));
  return promise;
}

const serverCustomers = () =>
  cached(
    () => serverRequest<CustomerView[]>('GET', '/customers'),
    () => customersPromise,
    (p) => (customersPromise = p),
  );

const serverItems = () =>
  cached(
    () => serverRequest<ItemView[]>('GET', '/items'),
    () => itemsPromise,
    (p) => (itemsPromise = p),
  );

const readMock = <T>(reader: (tables: Readonly<MockTables>) => T): T => getMockDb().read(reader);

// ── 화면(가짜 DB) id → 서버 id: 요청 보낼 때 ──────────────────

export async function serverCustomerIdOf(mockCustomerId: number): Promise<number> {
  const code = readMock((t) => t.customer.find((c) => c.id === mockCustomerId)?.customerCode);
  const found = code ? (await serverCustomers()).find((c) => c.customerCode === code) : undefined;
  if (!found) throw new ApiError('COM-003', '서버에 없는 고객사예요');
  return found.id;
}

export async function serverItemIdOf(mockItemId: number): Promise<number> {
  const code = readMock((t) => t.item.find((i) => i.id === mockItemId)?.itemCode);
  const found = code ? (await serverItems()).find((i) => i.itemCode === code) : undefined;
  if (!found) throw new ApiError('SO-001', code ? `서버에 없는 규격이에요 (${code})` : null);
  return found.id;
}

// ── 서버 응답 → 화면(가짜 DB) id: 응답 받을 때 (응답에 코드·이름이 있어 기준정보 권한이 없어도 된다) ─────

/** 고객사: 서버 응답의 고객사 이름으로 찾는다. 없으면 서버 id를 그대로 둔다 */
export function mockCustomerIdOf(customerName: string, serverCustomerId: number): number {
  return readMock((t) => t.customer.find((c) => c.customerName === customerName)?.id) ?? serverCustomerId;
}

export function mockCustomerCodeOf(customerName: string): string {
  return readMock((t) => t.customer.find((c) => c.customerName === customerName)?.customerCode) ?? '';
}

/** 규격: 서버 응답의 규격 코드로 찾는다 */
export function mockItemOf(itemCode: string): ItemRow | undefined {
  return readMock((t) => t.item.find((i) => i.itemCode === itemCode));
}

/** 사원: 이름으로 찾는다 (가짜 DB와 서버 시드의 사원번호·이름이 같다) */
export function mockEmployeeIdOf(employeeName: string, serverEmployeeId: number): number {
  return readMock((t) => t.employee.find((e) => e.employeeName === employeeName)?.id) ?? serverEmployeeId;
}

export function mockSteelGradeCodeOf(itemCode: string): string | null {
  return readMock((t) => {
    const item = t.item.find((i) => i.itemCode === itemCode);
    return t.steelGrade.find((g) => g.id === item?.steelGradeId)?.steelGradeCode ?? null;
  });
}

/** LOT 야드: LOT은 규격의 기본 야드에 생긴다 (REQ-MST-008). 서버 야드 id 대신 화면 규격의 기본 야드를 쓴다 */
export function mockDefaultYardOf(itemCode: string): { yardId: number | null; yardName: string | null } {
  return readMock((t) => {
    const item = t.item.find((i) => i.itemCode === itemCode);
    const yard = t.yard.find((y) => y.id === item?.defaultYardId);
    return { yardId: yard?.id ?? null, yardName: yard?.yardName ?? null };
  });
}

// ── 강종 (검사 기준 화면) ─────────────────────────────────

/** 강종: 서버 응답의 강종 코드로 찾는다 */
export function mockSteelGradeOf(steelGradeCode: string): SteelGradeRow | undefined {
  return readMock((t) => t.steelGrade.find((g) => g.steelGradeCode === steelGradeCode));
}

export function mockSteelGradeIdOf(steelGradeCode: string, serverSteelGradeId: number): number {
  return mockSteelGradeOf(steelGradeCode)?.id ?? serverSteelGradeId;
}

export function mockSteelGradeCodeById(mockSteelGradeId: number): string | null {
  return readMock((t) => t.steelGrade.find((g) => g.id === mockSteelGradeId)?.steelGradeCode) ?? null;
}

/**
 * 화면 강종 id → 서버 강종 id. 서버에 강종 목록 API가 없어(기준정보 모듈 미완성) 이미 받은 행(검사 기준 목록)의 강종 코드·id에서 찾고,
 * 없으면 규격 목록(GET /items, 기준정보 조회 권한 필요)의 강종에서 찾는다. 둘 다 없으면 COM-003.
 */
export async function serverSteelGradeIdOf(mockSteelGradeId: number, known: readonly { steelGradeId: number; steelGradeCode: string }[]): Promise<number> {
  const code = mockSteelGradeCodeById(mockSteelGradeId);
  if (!code) throw new ApiError('COM-003', '강종');
  const fromKnown = known.find((k) => k.steelGradeCode === code);
  if (fromKnown) return fromKnown.steelGradeId;
  let items: ItemView[] = [];
  try {
    items = await serverItems();
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'COM-002')) throw e;
  }
  const fromItems = items.find((i) => i.steelGradeCode === code)?.steelGradeId;
  if (fromItems) return fromItems;
  throw new ApiError('COM-003', `서버에서 강종을 찾을 수 없어요 (${code})`);
}

/** 계정을 바꾸면 권한이 달라질 수 있어 기준정보 캐시를 비운다 (테스트용) */
export function resetMasterIdCacheForTest(): void {
  customersPromise = null;
  itemsPromise = null;
}
