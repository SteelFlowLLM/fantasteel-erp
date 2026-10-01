// 구매 화면 표시용 순수 함수 (MRP 기간 기본값, 품목 요약, 공급업체 묶음, 진행률, 톤 입력 초기값).
// 업무 규칙(순소요·승인·발주·입고)은 core 서비스가 한다. 여기는 화면에 보이는 값만 만든다.
import { decCmp, decDiv, decIsPositive } from '@/lib/decimal';
import type { RequisitionSource } from '@/api/purchasing';

/** 구매요청 출처 표시명 (계산값: action_draft_id → Message → ERP, production_plan_id → MRP 계획, 그 밖 → 직접) */
export const REQUISITION_SOURCE_LABEL: Record<RequisitionSource, string> = {
  MRP: 'MRP 계획',
  MESSAGE: 'Message → ERP',
  DIRECT: '직접',
};

export const REQUISITION_SOURCES: readonly RequisitionSource[] = ['MRP', 'MESSAGE', 'DIRECT'];

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 그 달의 마지막 날 (month: 1~12, 넘치면 다음 해) */
function lastDayOf(year: number, month: number): string {
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((month - 1) % 12) + 1;
  const days = new Date(Date.UTC(normalizedYear, normalizedMonth, 0)).getUTCDate();
  return `${normalizedYear}-${pad2(normalizedMonth)}-${pad2(days)}`;
}

/** MRP 기본 기간(가정값): 이번 달 1일 ~ 다음 달 마지막 날 */
export function defaultMrpPeriod(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return { from: `${today.slice(0, 7)}-01`, to: lastDayOf(year, month + 1) };
}

/** 원료 줄 요약: "철광석" / "철광석 외 1종" / "-" */
export function summarizeItemNames(items: readonly { itemName: string }[]): string {
  if (items.length === 0) return '-';
  return items.length === 1 ? items[0].itemName : `${items[0].itemName} 외 ${items.length - 1}종`;
}

/** 입력칸 초기값: 끝자리 0을 지운다 ("150.000" → "150", "1.500" → "1.5") */
export function trimTonText(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** part ÷ whole 백분율 (0~100). whole이 0이면 0. 진행 막대 표시용 */
export function ratioPercent(part: string, whole: string): number {
  if (!decIsPositive(whole)) return 0;
  const percent = Number(decDiv(part, whole, 4)) * 100;
  return Math.max(0, Math.min(100, percent));
}

export interface SupplierGroup<T> {
  supplierId: number | null;
  supplierName: string | null;
  items: T[];
}

/** 기본 공급업체별 묶음 (공급업체 1곳 = 발주 1건). 공급업체 없는 묶음은 맨 뒤 */
export function groupBySupplier<T extends { supplierId: number | null; supplierName: string | null }>(items: readonly T[]): SupplierGroup<T>[] {
  const groups = new Map<number | null, SupplierGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.supplierId) ?? { supplierId: item.supplierId, supplierName: item.supplierName, items: [] };
    group.items.push(item);
    groups.set(item.supplierId, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.supplierId === null) return 1;
    if (b.supplierId === null) return -1;
    return (a.supplierName ?? '').localeCompare(b.supplierName ?? '', 'ko');
  });
}

/** 가장 이른 날짜 (없으면 null) */
export function earliestDate(dates: readonly (string | null)[]): string | null {
  return dates.filter((d): d is string => d !== null && d !== '').sort()[0] ?? null;
}

/** 원료 LOT 번호 형식 미리보기 (9.2: RM-원료코드-YYMMDD-NNN, 번호는 확정할 때 매긴다) */
export const rawMaterialLotNoPattern = (itemCode: string): string => `RM-${itemCode}-YYMMDD-NNN`;

/** 납기가 지났고 아직 입고예정이 남았는지 */
export function isOverdue(dueDate: string | null, today: string, scheduledReceiptTon: string): boolean {
  return dueDate !== null && dueDate < today && decCmp(scheduledReceiptTon, 0) > 0;
}

/** MRP에서 만드는 구매요청의 요청 근거 기본 문구 */
export function mrpRequestReason(line: { productionPlanNo: string; itemName: string; netTon: string; needDate: string }, period: { from: string; to: string }): string {
  return `MRP ${period.from} ~ ${period.to} · ${line.productionPlanNo} ${line.itemName} 순소요 ${line.netTon} t · 필요일 ${line.needDate}`;
}
