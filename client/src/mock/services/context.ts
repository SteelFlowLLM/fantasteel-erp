// 가짜 서버 서비스의 공통 도우미. 순환 참조를 피하려고 @/api/* 대신 @/api/errors만 쓴다.
// - 쓰기 서비스: fn(tx, actor, input). 읽기: fn(tables, input). 역할 권한은 확인하지 않는다(각 화면 api가 requireActor로 먼저 확인).
import type { ProcessType, ProductItemType } from '@/codes';
import { ApiError, FieldErrors, InputError } from '@/api/errors';
import { decCmp, isDecimalText } from '@/lib/decimal';
import { pickCurrentStandard } from '@/lib/inspectionJudgment';
import { withEulReul, withEunNeun, withIGa } from '@/lib/josa';
import { toSeoulDateString } from '@/lib/seoulDate';
import { calcHotRollingYieldRate } from '@/lib/weight';
import type { BusinessEventActor } from '@/mock/businessEvents';
import type { ItemRow, LotRow, MockTables, ProductionPlanRow, RowOf, TableName } from '@/mock/schema';
import { insertRow, updateRow, type MockTx } from '@/mock/store';

export { ApiError, FieldErrors, InputError };

/** 사람이 실행한 변경의 주체 (api 층이 requireActor로 확인한 사원) */
export type PersonActor = Extract<BusinessEventActor, { actorType: 'USER' }>;
export const userActor = (employeeId: number): PersonActor => ({ actorType: 'USER', employeeId });
export const SYSTEM_ACTOR: BusinessEventActor = { actorType: 'SYSTEM' };

/** 메시지 보낸 사람이 '시스템'인 메시지의 sender_id (ERD에 시스템 표시 칸이 없어 0으로 둔다 — 가정값, core-domain.md) */
export const SYSTEM_SENDER_ID = 0;

type Tables = Readonly<MockTables>;

/** id로 행을 찾는다. 없으면 COM-003 (참조 대상이 없습니다) */
export function mustGet<K extends TableName>(tables: Tables, table: K, id: number | null | undefined, label: string): RowOf<K> {
  const row = id === null || id === undefined ? undefined : (tables[table] as RowOf<K>[]).find((r) => r.id === id);
  if (!row) throw new ApiError('COM-003', id === null || id === undefined ? label : `${label} ${id}`);
  return row;
}

export function findById<K extends TableName>(tables: Tables, table: K, id: number | null | undefined): RowOf<K> | undefined {
  if (id === null || id === undefined) return undefined;
  return (tables[table] as RowOf<K>[]).find((r) => r.id === id);
}

/** 화면이 본 수정 시각과 지금이 다르면 COM-001 (검토 이후 데이터 변경) */
export function assertNotChanged(currentUpdatedAt: string, expectedUpdatedAt: string | null | undefined, label: string): void {
  if (expectedUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) throw new ApiError('COM-001', `${withIGa(label)} 다른 곳에서 먼저 바뀌었어요`);
}

/** 입력 오류 하나를 바로 던진다 */
export function inputError(field: string, message: string): never {
  throw new InputError(message, { [field]: message });
}

/** 1 이상 정수 매수. 아니면 SO-002 (수량은 1 이상의 정수로 입력해 주세요). 글자는 지우지 않고 그대로 거부한다. */
export function requirePositiveQty(value: unknown, detail?: string): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) throw new ApiError('SO-002', detail ?? null);
  const qty = Number(text);
  if (!Number.isSafeInteger(qty) || qty < 1) throw new ApiError('SO-002', detail ?? null);
  return qty;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isDateText(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function checkDate(errors: FieldErrors, field: string, value: string | null | undefined, label: string, required: boolean): string | null {
  const text = (value ?? '').trim();
  if (!text) {
    if (required) errors.add(field, `${withEulReul(label)} 입력해 주세요`);
    return null;
  }
  if (!isDateText(text)) {
    errors.add(field, `${withEunNeun(label)} YYYY-MM-DD 형식의 날짜로 입력해 주세요`);
    return null;
  }
  return text;
}

export function checkDateTime(errors: FieldErrors, field: string, value: string | null | undefined, label: string): string | null {
  const text = (value ?? '').trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    errors.add(field, `${withEulReul(label)} 입력해 주세요`);
    return null;
  }
  return new Date(text).toISOString();
}

/** 톤(decimal(12,3)) 같은 십진수. positive면 0보다 커야 한다. */
export function checkDecimal(
  errors: FieldErrors,
  field: string,
  value: string | number | null | undefined,
  rule: { label: string; scale: number; integerDigits: number; positive?: boolean; allowNegative?: boolean; required?: boolean },
): string | null {
  const text = (value === null || value === undefined ? '' : String(value)).trim().replace(/,/g, '');
  if (!text) {
    if (rule.required) errors.add(field, `${withEulReul(rule.label)} 입력해 주세요`);
    return null;
  }
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || !isDecimalText(text)) {
    errors.add(field, `${withEunNeun(rule.label)} 숫자로 입력해 주세요`);
    return null;
  }
  const [, sign = '', integerPart = '', fraction = ''] = match;
  if (sign === '-' && !rule.allowNegative) {
    errors.add(field, `${withEunNeun(rule.label)} 0 이상으로 입력해 주세요`);
    return null;
  }
  if (fraction.length > rule.scale) {
    errors.add(field, `${withEunNeun(rule.label)} 소수 ${rule.scale}자리까지 입력할 수 있어요`);
    return null;
  }
  if (integerPart.replace(/^0+(?=\d)/, '').length > rule.integerDigits) {
    errors.add(field, `${withIGa(rule.label)} 너무 커요`);
    return null;
  }
  const normalized = `${sign === '-' ? '-' : ''}${integerPart.replace(/^0+(?=\d)/, '')}${fraction ? `.${fraction}` : ''}`;
  if (rule.positive && decCmp(normalized, 0) <= 0) {
    errors.add(field, `${withEunNeun(rule.label)} 0보다 커야 해요`);
    return null;
  }
  return normalized;
}

export function checkText(errors: FieldErrors, field: string, value: string | null | undefined, label: string, maxLength: number, required: boolean): string | null {
  const text = (value ?? '').trim();
  if (!text) {
    if (required) errors.add(field, `${withEulReul(label)} 입력해 주세요`);
    return null;
  }
  if (text.length > maxLength) {
    errors.add(field, `${withEunNeun(label)} ${maxLength}자까지 입력할 수 있어요`);
    return null;
  }
  return text;
}

/** 이 tx 시각의 서울 날짜 */
export const txDate = (tx: MockTx): string => toSeoulDateString(tx.now);
export const seoulDateOf = (iso: string): string => toSeoulDateString(new Date(iso));

// ── 기준정보 조회 ─────────────────────────────────────────

export function productionSettingOf(tables: Tables): { heatCapacityTon: string; deliveryRiskDays: number } {
  const row = tables.productionSetting[0];
  if (!row) throw new ApiError('MST-001', '생산 설정값(히트 용량)');
  return { heatCapacityTon: row.heatCapacityTon, deliveryRiskDays: row.deliveryRiskDays };
}

export function productItemTypeOf(item: ItemRow): ProductItemType {
  if (item.itemType === 'RAW_MATERIAL') throw new ApiError('SO-001', item.itemCode);
  return item.itemType;
}

/** 제품 규격 1매(1개) 이론중량 */
export function unitWeightOf(item: ItemRow): string {
  if (!item.theoreticalWeightTon) throw new ApiError('MST-001', `${item.itemCode} 이론중량`);
  return item.theoreticalWeightTon;
}

/** 라우팅 계획 수율 (공정별). 없으면 MST-001. */
export function routingYieldOf(tables: Tables, itemType: ProductItemType, processType: ProcessType): string {
  const row = tables.routing.find((r) => r.itemType === itemType && r.processType === processType);
  if (!row || !row.plannedYieldRate) throw new ApiError('MST-001', `라우팅 계획 수율(${itemType === 'SLAB' ? '슬래브' : '코일'} ${processType})`);
  return row.plannedYieldRate;
}

/** 코일 규격에 대응하는 슬래브 규격 (규격 매핑). 없으면 MST-001. */
export function slabSpecOfCoil(tables: Tables, coilItem: ItemRow): ItemRow {
  const mapping = tables.specMapping.find((m) => m.coilItemId === coilItem.id);
  const slab = mapping ? tables.item.find((i) => i.id === mapping.slabItemId) : undefined;
  if (!slab) throw new ApiError('MST-001', `규격 매핑(${coilItem.itemCode})`);
  return slab;
}

/** 슬래브 규격에 대응하는 코일 규격 (없으면 undefined) */
export function coilSpecOfSlab(tables: Tables, slabItemId: number): ItemRow | undefined {
  const mapping = tables.specMapping.find((m) => m.slabItemId === slabItemId);
  return mapping ? tables.item.find((i) => i.id === mapping.coilItemId) : undefined;
}

/** 열연 계획 수율 = 코일 이론중량 ÷ 대응 슬래브 이론중량 (저장 안 함) */
export function hotRollingYieldOf(tables: Tables, coilItem: ItemRow): string {
  return calcHotRollingYieldRate(unitWeightOf(coilItem), unitWeightOf(slabSpecOfCoil(tables, coilItem)));
}

/** 생산계획의 연주 대상 슬래브 규격 (슬래브 계획 = 그 규격, 코일 계획 = 매핑된 슬래브) */
export function castingSlabSpecOf(tables: Tables, plan: ProductionPlanRow): ItemRow {
  const item = mustGet(tables, 'item', plan.itemId, '생산 대상 규격');
  return item.itemType === 'COIL' ? slabSpecOfCoil(tables, item) : item;
}

export function steelGradeCodeOf(tables: Tables, steelGradeId: number | null): string | null {
  return tables.steelGrade.find((g) => g.id === steelGradeId)?.steelGradeCode ?? null;
}

export function employeeNameOf(tables: Tables, employeeId: number | null | undefined): string | null {
  if (employeeId === SYSTEM_SENDER_ID) return '시스템';
  return tables.employee.find((e) => e.id === employeeId)?.employeeName ?? null;
}

// ── 수주 연결 (작업 로그 sales_order_id) ─────────────────────

export function salesOrderIdOfItem(tables: Tables, salesOrderItemId: number | null | undefined): number | null {
  return tables.salesOrderItem.find((i) => i.id === salesOrderItemId)?.salesOrderId ?? null;
}

export function salesOrderIdOfPlan(tables: Tables, plan: ProductionPlanRow | undefined): number | null {
  return plan ? salesOrderIdOfItem(tables, plan.salesOrderItemId) : null;
}

export function salesOrderIdOfLot(tables: Tables, lot: LotRow): number | null {
  return salesOrderIdOfPlan(tables, findById(tables, 'productionPlan', lot.productionPlanId));
}

// ── 재고 행 (inventory) ──────────────────────────────────

/**
 * 제품 재고 행을 LOT·예약에서 다시 맞춘다 (BP-INV-02: 예약과 같은 트랜잭션에서 갱신).
 * on_hand_qty = 미소진(AVAILABLE) LOT 매수, reserved_qty = ACTIVE 예약 매수 합계.
 */
export function refreshInventory(tx: MockTx, itemId: number): void {
  const item = tx.tables.item.find((i) => i.id === itemId);
  if (!item || item.itemType === 'RAW_MATERIAL') return;
  const onHandQty = tx.tables.lot.filter((l) => l.itemId === itemId && l.lotStatus === 'AVAILABLE').length;
  const reservedQty = tx.tables.reservation.filter((r) => r.itemId === itemId && r.reservationStatus === 'ACTIVE').reduce((sum, r) => sum + r.reservedQty, 0);
  const row = tx.tables.inventory.find((i) => i.itemId === itemId);
  if (!row) {
    insertRow(tx, 'inventory', { itemId, onHandQty, reservedQty });
    return;
  }
  if (row.onHandQty !== onHandQty || row.reservedQty !== reservedQty) updateRow(tx, 'inventory', row.id, { onHandQty, reservedQty });
}

/** 제품 규격마다 재고 행을 만든다 (0/0) — 시드용 */
export function ensureInventoryRows(tx: MockTx): void {
  for (const item of tx.tables.item) if (item.itemType !== 'RAW_MATERIAL') refreshInventory(tx, item.id);
}

/** 검사 공정: 히트 = 제강(성분), 슬래브 = 연주(표면·치수), 코일 = 열연(치수·기계적 성질) (REQ-QC-001) */
export function inspectionProcessOf(lotType: LotRow['lotType']): ProcessType | null {
  if (lotType === 'HEAT') return 'STEELMAKING';
  if (lotType === 'SLAB') return 'CONTINUOUS_CASTING';
  if (lotType === 'COIL') return 'HOT_ROLLING';
  return null;
}

/** 공정·강종의 현재 검사 기준 (강종 기준이 없으면 공통 기준) */
export function currentStandardOf(tables: Tables, processType: ProcessType, steelGradeId: number | null) {
  return pickCurrentStandard(tables.inspectionStandard, processType, steelGradeId);
}

/** 정렬된 고유 숫자 */
export const uniqueIds = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);
