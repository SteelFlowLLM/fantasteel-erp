// 구매 화면 표시용 순수 함수 (MRP 기간 기본값, 품목 요약, 공급업체 묶음, 진행률, 톤 입력 초기값).
// 업무 규칙(순소요·승인·발주·입고)은 core 서비스가 한다. 여기는 화면에 보이는 값만 만든다.
import { PURCHASE_ORDER_STATUS_LABEL } from '@/codes';
import { decCmp, decDiv, decIsPositive, decSum } from '@/lib/decimal';
import { fmtMD, fmtTon } from '@/lib/format';
import type { ReceiptLine } from '@/api/goodsReceipts';
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

/** 입고예정 목록 줄 단추의 이름 (화면 낭독기용): "PO-2609-0001 PR-2609-0001 · 철광석 · 가온광업 · 발주 확정 · 입고예정 500.000 t · 입고 예정 10-10" */
export function receiptRowLabel(
  line: Pick<ReceiptLine, 'purchaseOrderNo' | 'purchaseRequisitionNo' | 'itemName' | 'supplierName' | 'purchaseOrderStatus' | 'isFullyReceived' | 'remainingTon' | 'expectedReceiptDate'>,
): string {
  const parts = [
    `${line.purchaseOrderNo} ${line.purchaseRequisitionNo ?? ''}`.trim(),
    line.itemName,
    line.supplierName,
    PURCHASE_ORDER_STATUS_LABEL[line.purchaseOrderStatus],
    line.isFullyReceived ? '입고 끝' : `입고예정 ${fmtTon(line.remainingTon)}`,
  ];
  if (line.expectedReceiptDate) parts.push(`입고 예정 ${fmtMD(line.expectedReceiptDate)}`);
  return parts.join(' · ');
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

/** 만들어질 발주 1건 미리보기: 공급업체 · 입고 예정일 · 품목 수 · 합계 톤 */
export interface PlannedPurchaseOrder {
  supplierId: number;
  supplierName: string | null;
  /** 입력한 입고 예정일, 비우면 그 공급업체 묶음의 가장 이른 희망 입고일(품목마다 자기 희망 입고일이 들어간다). 둘 다 없으면 null */
  expectedReceiptDate: string | null;
  itemCount: number;
  totalTon: string;
}

/**
 * 고른 품목으로 만들어질 발주 (BP-PUR-01: 기본 공급업체 1곳당 발주 1건).
 * 입고 예정일을 비우면 품목마다 자기 희망 입고일이 들어간다(미리보기는 가장 이른 날). 기본 공급업체가 없는 품목은 발주하지 않는다.
 */
export function plannedPurchaseOrders(
  chosen: readonly { supplierId: number | null; supplierName: string | null; desiredReceiptDate: string | null; requestedTon: string }[],
  expectedReceiptDate: string,
): PlannedPurchaseOrder[] {
  return groupBySupplier(chosen).flatMap((group) =>
    group.supplierId === null
      ? []
      : [
          {
            supplierId: group.supplierId,
            supplierName: group.supplierName,
            expectedReceiptDate: expectedReceiptDate !== '' ? expectedReceiptDate : earliestDate(group.items.map((i) => i.desiredReceiptDate)),
            itemCount: group.items.length,
            totalTon: decSum(group.items.map((i) => i.requestedTon)),
          },
        ],
  );
}

/** 원료 LOT 번호 형식 미리보기 (9.2: RM-원료코드-YYMMDD-NNN, 번호는 확정할 때 매긴다) */
export const rawMaterialLotNoPattern = (itemCode: string): string => `RM-${itemCode}-YYMMDD-NNN`;

/** 입고 예정일이 지났고 아직 미입고량이 남았는지 */
export function isOverdue(expectedReceiptDate: string | null, today: string, remainingTon: string): boolean {
  return expectedReceiptDate !== null && expectedReceiptDate < today && decCmp(remainingTon, 0) > 0;
}

/** MRP에서 만드는 구매요청의 요청 근거 기본 문구 */
export function mrpRequestReason(line: { productionPlanNo: string; itemName: string; netTon: string; needDate: string }, period: { from: string; to: string }): string {
  return `MRP ${period.from} ~ ${period.to} · ${line.productionPlanNo} ${line.itemName} 순소요 ${line.netTon} t · 필요일 ${line.needDate}`;
}

/** MRP 원료 줄에서 이 계획들이 쓰지 않은 공급 (core MrpMaterialRow의 이유별 톤) */
export interface MrpExcludedSupply {
  onHandEarlierPlansTon: string;
  scheduledOtherPlansTon: string;
  scheduledAfterNeedDateTon: string;
  scheduledEarlierPlansTon: string;
  scheduledSpareTon: string;
}

const tonNote = (label: string, ton: string, suffix = ''): string[] => (decIsPositive(ton) ? [`${label} ${fmtTon(ton)}${suffix}`] : []);

/** '원료 LOT 잔량' 칸 아래 작은 글씨: 표에 없는 앞선(필요일이 더 이른) 계획이 먼저 쓴 몫 (없으면 빈 배열) */
export function mrpOnHandNotes(row: Pick<MrpExcludedSupply, 'onHandEarlierPlansTon'>): string[] {
  return tonNote('앞선 계획 몫', row.onHandEarlierPlansTon, ' 제외');
}

/**
 * '입고예정' 칸 아래 작은 글씨: 칸의 숫자(이 계획들이 필요일까지 받아 쓰는 몫)에 넣지 않은 입고예정을 이유별로.
 * 다른 계획 몫(REQ-PRD-005) · 필요일 뒤 도착(4.4) · 앞선 계획 몫 · 남는 몫(소요가 이미 채워짐). 0인 이유는 뺀다.
 */
export function mrpScheduledReceiptNotes(row: Omit<MrpExcludedSupply, 'onHandEarlierPlansTon'>): string[] {
  return [
    ...tonNote('다른 계획 몫', row.scheduledOtherPlansTon, ' 제외'),
    ...tonNote('필요일 뒤 도착', row.scheduledAfterNeedDateTon, ' 제외'),
    ...tonNote('앞선 계획 몫', row.scheduledEarlierPlansTon, ' 제외'),
    ...tonNote('남는 몫', row.scheduledSpareTon),
  ];
}
