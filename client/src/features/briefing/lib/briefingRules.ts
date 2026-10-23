// 철강맨 아침 브리핑의 규칙 (시안 "철강맨 아침 브리핑" → 화면). AI를 부르지 않고, 정해 둔 조건에 맞는 데이터를 골라
// 정해 둔 문장 틀에 숫자만 채운다. 그래서 같은 데이터면 늘 같은 문장이 나온다.
// 업무 계산(납기 위험·가용·순소요·불합격률)은 다시 만들지 않는다. 대시보드 위젯·목록 조회 결과를 고르기만 한다.
// 문장 안의 **글자**는 강조 표시다 (화면이 굵게 그린다).
import type { AgentRiskData, DeliveryRiskData, ProductionVolumeData, PurchaseProgressData, RawMaterialBalanceData, RejectRateData, SurplusAgeData } from '@/api/dashboard';
import type { RejectedLotListRow } from '@/api/dispositions';
import type { GoodsIssueQueueRow } from '@/api/goodsIssues';
import type { InspectionQueueRow } from '@/api/inspections';
import type { RequisitionView } from '@/api/purchasing';
import type { ShipmentListRow } from '@/api/shipmentRequests';
import type { TaskSummary } from '@/api/tasks';
import { LOT_TYPE_LABEL, PURCHASE_REQUISITION_STATUS_LABEL, type RoleCode } from '@/codes';
import { RISK_NAME } from '@/features/agent/lib/agentDisplay';
import { decCmp, decSum } from '@/lib/decimal';
import { fmtMD, fmtMDdow, fmtNum } from '@/lib/format';
import { addDays, daysBetween } from '@/lib/salesOrderStatus';
import { SEOUL_TIME_ZONE, seoulDateParts, toSeoulDateString } from '@/lib/seoulDate';

/** 카드 심각도. 철강맨 표정과 카드 색이 이것을 따른다 */
export type BriefingSeverity = 'danger' | 'wait' | 'run' | 'ok';

export const BRIEFING_SEVERITY_LABEL: Record<BriefingSeverity, string> = { danger: '위험', wait: '확인 필요', run: '참고', ok: '좋은 소식' };
export const BRIEFING_SEVERITY_ORDER: readonly BriefingSeverity[] = ['danger', 'wait', 'run', 'ok'];

/** 브리핑에 올리는 카드 수 (시안과 같이 4장) */
export const BRIEFING_CARD_LIMIT = 4;
/** 근거 표에 보이는 줄 수 */
export const BRIEFING_DETAIL_ROWS = 8;
/** 여재를 "오래 보유"로 보는 일수. Factory Agent의 여재 장기 보유 기준(AGED_SURPLUS_DAYS)과 같은 값 (가정값) */
export const BRIEFING_AGED_SURPLUS_DAYS = 30;
/** 판정 대기가 이 일수 이상 지난 LOT이 있으면 '위험'으로 올린다 (가정값) */
export const BRIEFING_PENDING_ALERT_DAYS = 1;
/** "곧 출하"로 보는 기간: 오늘부터 7일 (가정값) */
export const BRIEFING_UPCOMING_DAYS = 7;

export type BriefingCell = string | { text: string; tone: BriefingSeverity | 'mute' };

export interface BriefingLink {
  label: string;
  href: string;
}

/** 카드를 눌렀을 때 오른쪽 창에 보이는 근거 */
export interface BriefingDetail {
  crumb: string;
  /** 규칙 조건식 (화면에 그대로 보인다) */
  ruleExpr: string;
  memo: string;
  columns: { label: string; numeric?: boolean }[];
  rows: { cells: BriefingCell[]; highlight?: boolean }[];
  note?: string;
  primary: BriefingLink;
  secondary?: BriefingLink;
}

export interface BriefingCard {
  key: string;
  severity: BriefingSeverity;
  title: string;
  /** 카드 오른쪽 위 큰 숫자 */
  value: string;
  summary: string;
  /** 카드 아래 한 줄 규칙 */
  rule: string;
  /** 철강맨이 말풍선으로 하는 말 */
  say: string;
  detail: BriefingDetail;
}

/**
 * 브리핑이 읽는 자료. null = 이 역할이 읽지 않거나, 볼 권한이 없거나, 읽지 못한 자료.
 * 자료 하나가 없어도 나머지로 브리핑한다.
 */
export interface BriefingSources {
  today: string;
  deliveryRisk: DeliveryRiskData | null;
  surplusAge: SurplusAgeData | null;
  rejectRate: RejectRateData | null;
  rawMaterialBalance: RawMaterialBalanceData | null;
  purchaseProgress: PurchaseProgressData | null;
  productionVolume: ProductionVolumeData | null;
  agentRisk: AgentRiskData | null;
  inspectionQueue: InspectionQueueRow[] | null;
  rejectedLots: RejectedLotListRow[] | null;
  goodsIssueQueue: GoodsIssueQueueRow[] | null;
  shipmentRequests: ShipmentListRow[] | null;
  approvalInbox: RequisitionView[] | null;
  taskSummary: TaskSummary | null;
}

export type BriefingSourceKey = Exclude<keyof BriefingSources, 'today'>;

export const EMPTY_BRIEFING_SOURCES: Omit<BriefingSources, 'today'> = {
  deliveryRisk: null,
  surplusAge: null,
  rejectRate: null,
  rawMaterialBalance: null,
  purchaseProgress: null,
  productionVolume: null,
  agentRisk: null,
  inspectionQueue: null,
  rejectedLots: null,
  goodsIssueQueue: null,
  shipmentRequests: null,
  approvalInbox: null,
  taskSummary: null,
};

// ── 도우미 ──────────────────────────────────────────────

const ton = (value: string): string => `${fmtNum(value, 3)}톤`;
const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

/** 남은 일수 → D-3 · D-day · 납기 2일 지남 */
function dueText(daysToDue: number): string {
  if (daysToDue < 0) return `납기 ${-daysToDue}일 지남`;
  return daysToDue === 0 ? 'D-day' : `D-${daysToDue}`;
}

/** 'YYYY-MM-DD' → 10-23 (금) */
const dayLabel = (date: string): string => fmtMDdow(`${date}T12:00:00+09:00`);

// ── 역할마다 쓰는 규칙 ──────────────────────────────────

/** 납기 위험 수주 (REQ-AGT-004, 납기 위험 = 남은 일수 ≤ 기준일 && 출하 매수 < 수주 매수) */
export function deliveryRiskCard(data: DeliveryRiskData): BriefingCard {
  const days = data.deliveryRiskDays;
  const ruleExpr = `납기일 − 오늘 ≤ ${days} && 출하 매수 < 수주 매수`;
  const items = [...data.items].sort((a, b) => a.daysToDue - b.daysToDue || a.salesOrderNo.localeCompare(b.salesOrderNo));
  const orderCount = new Set(items.map((i) => i.salesOrderId)).size;
  const top = items[0];
  if (!top) {
    return {
      key: 'delivery-risk',
      severity: 'ok',
      title: '납기 위험 수주',
      value: '0건',
      summary: `진행 중 수주 품목 **${data.openItemCount}개** 모두 납기 ${days}일 밖`,
      rule: `납기 ${days}일 이내 · 미출하 남음`,
      say: `좋은 소식! 납기 ${days}일 안에 걸린 수주가 **하나도 없어요**.`,
      detail: {
        crumb: '영업 › 수주 › 납기 위험',
        ruleExpr,
        memo: `진행 중 수주 품목 ${data.openItemCount}개 가운데 납기 위험에 걸린 품목이 없어요.`,
        columns: [{ label: '구분' }, { label: '값', numeric: true }],
        rows: [{ cells: ['진행 중 수주 품목', `${data.openItemCount}개`] }, { cells: ['납기 위험 기준', `${days}일`] }],
        note: `기준일 ${data.today}`,
        primary: { label: '수주 목록 열기', href: '/sales-orders' },
      },
    };
  }
  const severity: BriefingSeverity = items.some((i) => i.isOverdue || i.daysToDue <= 1) ? 'danger' : 'wait';
  return {
    key: 'delivery-risk',
    severity,
    title: '납기 위험 수주',
    value: `${orderCount}건`,
    summary: `**${top.salesOrderNo}**(${top.customerName}) 미출하 **${top.unshippedQty}매** · ${dueText(top.daysToDue)}`,
    rule: `납기 ${days}일 이내 · 미출하 남음`,
    say: `납기 위험 수주가 **${orderCount}건** 있어요! 가장 급한 건 **${top.salesOrderNo}(${top.customerName})**, 미출하 **${top.unshippedQty}매**이고 ${dueText(top.daysToDue)}예요.`,
    detail: {
      crumb: '영업 › 수주 › 납기 위험',
      ruleExpr,
      memo: `**${top.salesOrderNo}**는 ${top.itemCode} 미출하 **${top.unshippedQty}매**(${ton(top.unshippedTon)})가 남았어요. 수주 상세에서 예약·출하요청 상태를 확인해 보세요.`,
      columns: [{ label: '수주번호' }, { label: '고객사' }, { label: '품목' }, { label: '미출하(매)', numeric: true }, { label: '미출하(톤)', numeric: true }, { label: '납기' }, { label: '남은 일' }],
      rows: items.slice(0, BRIEFING_DETAIL_ROWS).map((i, index) => ({
        cells: [
          i.salesOrderNo,
          i.customerName,
          i.itemCode,
          String(i.unshippedQty),
          fmtNum(i.unshippedTon, 3),
          dayLabel(i.dueDate),
          { text: dueText(i.daysToDue), tone: i.isOverdue || i.daysToDue <= 1 ? 'danger' : 'wait' },
        ],
        highlight: index === 0,
      })),
      note: `기준일 ${data.today} · 납기 위험 기준 ${days}일(생산 설정)`,
      primary: { label: `${top.salesOrderNo} 열기`, href: `/sales-orders/${top.salesOrderId}` },
      secondary: { label: '수주 목록 열기', href: '/sales-orders' },
    },
  };
}

/** 판정 대기 LOT (REQ-QC-001). audience에 따라 말을 바꾼다: 생산은 "투입이 막힘", 품질은 "먼저 봐 주세요" */
export function inspectionPendingCard(queue: readonly InspectionQueueRow[], today: string, audience: 'production' | 'quality'): BriefingCard {
  const pending = queue.filter((r) => r.inspectionResult === 'PENDING').sort((a, b) => a.producedDate.localeCompare(b.producedDate) || a.lotNo.localeCompare(b.lotNo));
  const ruleExpr = `검사 판정 = 판정 대기 → 생산일 이른 순`;
  const crumb = '품질 › 검사 입력 › 판정 대기';
  const oldest = pending[0];
  if (!oldest) {
    return {
      key: 'inspection-pending',
      severity: 'ok',
      title: '판정 대기 LOT',
      value: '0개',
      summary: '판정을 기다리는 히트·슬래브·코일이 없음',
      rule: '검사 판정 = 판정 대기',
      say: audience === 'quality' ? '좋은 소식! 판정을 기다리는 LOT이 **하나도 없어요**.' : '좋은 소식! 품질 판정을 기다리는 LOT이 없어서 **막힌 투입이 없어요**.',
      detail: {
        crumb,
        ruleExpr,
        memo: '판정 대기 LOT이 없어요.',
        columns: [{ label: '구분' }, { label: '값', numeric: true }],
        rows: [{ cells: ['판정 대기', '0개'] }],
        primary: { label: '검사 입력 열기', href: '/quality/inspections' },
      },
    };
  }
  const age = daysBetween(oldest.producedDate, today);
  const severity: BriefingSeverity = age >= BRIEFING_PENDING_ALERT_DAYS ? 'danger' : 'wait';
  const byType = (['HEAT', 'SLAB', 'COIL'] as const)
    .map((type) => ({ type, count: pending.filter((r) => r.lotType === type).length }))
    .filter((t) => t.count > 0)
    .map((t) => `${LOT_TYPE_LABEL[t.type]} ${t.count}`)
    .join(' · ');
  const ageText = age <= 0 ? '오늘 생산' : `생산 ${age}일 전`;
  return {
    key: 'inspection-pending',
    severity,
    title: '판정 대기 LOT',
    value: `${pending.length}개`,
    summary: `${byType} · 가장 오래된 **${oldest.lotNo}** (${ageText})`,
    rule: `검사 판정 = 판정 대기 · ${BRIEFING_PENDING_ALERT_DAYS}일 넘으면 위험`,
    say:
      audience === 'quality'
        ? `판정 대기가 **${pending.length}개**예요. 가장 오래된 **${oldest.lotNo}**(${ageText})부터 봐 주세요.`
        : `판정 대기 LOT이 **${pending.length}개**예요. 판정이 나와야 다음 공정 투입과 예약이 돼요. 가장 오래된 건 **${oldest.lotNo}**(${ageText})예요.`,
    detail: {
      crumb,
      ruleExpr,
      memo:
        audience === 'quality'
          ? `**${oldest.lotNo}**가 가장 오래 기다렸어요. 검사 입력에서 바로 측정값을 넣을 수 있어요.`
          : `**${oldest.lotNo}**가 가장 오래 기다렸어요. 품질 담당에게 먼저 봐 달라고 알리면 다음 공정 편성에 넣을 수 있어요.`,
      columns: [{ label: 'LOT 번호' }, { label: '구분' }, { label: '강종' }, { label: '품목' }, { label: '생산일' }, { label: '기다린 날', numeric: true }],
      rows: pending.slice(0, BRIEFING_DETAIL_ROWS).map((r, index) => {
        const days = daysBetween(r.producedDate, today);
        return {
          cells: [r.lotNo, LOT_TYPE_LABEL[r.lotType], r.steelGradeCode ?? '-', r.itemCode ?? '-', fmtMD(r.producedDate), { text: `${Math.max(days, 0)}일`, tone: days >= BRIEFING_PENDING_ALERT_DAYS ? 'danger' : 'mute' }],
          highlight: index === 0,
        };
      }),
      note: `판정 대기 기준 ${BRIEFING_PENDING_ALERT_DAYS}일은 가정값이에요.`,
      primary: { label: `${oldest.lotNo} 검사 입력`, href: `/quality/inspections?lot=${oldest.lotId}` },
      secondary: { label: '검사 입력 열기', href: '/quality/inspections' },
    },
  };
}

/** 처리 상태를 정하지 않은 불합격 LOT (REQ-QC-004) */
export function rejectedLotsCard(rows: readonly RejectedLotListRow[]): BriefingCard {
  const open = rows.filter((r) => r.dispositionStatus === null).sort((a, b) => (b.inspectedAt ?? '').localeCompare(a.inspectedAt ?? '') || a.lotNo.localeCompare(b.lotNo));
  const ruleExpr = 'LOT 판정 = 불합격 && 불합격 상태 없음';
  const crumb = '품질 › 불합격 관리';
  const top = open[0];
  if (!top) {
    return {
      key: 'rejected-lots',
      severity: 'ok',
      title: '불합격 LOT 처리',
      value: '모두 끝',
      summary: `불합격 LOT **${rows.length}개** 모두 처리 상태를 정함`,
      rule: '불합격 상태(보류·격하·폐기) 미지정',
      say: '좋은 소식! 불합격 LOT은 **모두** 처리 상태를 정해 뒀어요.',
      detail: {
        crumb,
        ruleExpr,
        memo: '처리 상태를 정하지 않은 불합격 LOT이 없어요.',
        columns: [{ label: '구분' }, { label: '값', numeric: true }],
        rows: [{ cells: ['불합격 LOT', `${rows.length}개`] }, { cells: ['처리 상태 미지정', '0개'] }],
        primary: { label: '불합격 관리 열기', href: '/quality/rejected' },
      },
    };
  }
  const linked = open.filter((r) => r.salesOrderItem !== null).length;
  const failedName = top.failedItems[0]?.inspectionItemName;
  return {
    key: 'rejected-lots',
    severity: 'danger',
    title: '처리 안 한 불합격 LOT',
    value: `${open.length}개`,
    summary: `**${top.lotNo}**(${top.steelGradeCode ?? '-'})${failedName ? ` ${failedName}` : ''} 불합격 · 수주 연결 ${linked}개`,
    rule: '불합격 상태(보류·격하·폐기) 미지정',
    say: `불합격 LOT **${open.length}개**가 아직 처리 상태를 정하지 않았어요.${linked > 0 ? ` 그중 **${linked}개**는 수주에 연결돼 있어요.` : ''}`,
    detail: {
      crumb,
      ruleExpr,
      memo: `**${top.lotNo}**부터 보류·격하·폐기 중 하나로 정해 주세요. 수주에 연결된 LOT은 재생산 계획이 필요한지도 함께 봐요.`,
      columns: [{ label: 'LOT 번호' }, { label: '구분' }, { label: '강종' }, { label: '사유' }, { label: '불합격 항목' }, { label: '연결 수주' }],
      rows: open.slice(0, BRIEFING_DETAIL_ROWS).map((r, index) => ({
        cells: [
          r.lotNo,
          LOT_TYPE_LABEL[r.lotType],
          r.steelGradeCode ?? '-',
          r.reason === 'FAILED' ? '불합격' : '히트 불합격',
          r.failedItems.map((f) => f.inspectionItemName).join(', ') || '-',
          r.salesOrderItem ? `${r.salesOrderItem.salesOrderNo} ${r.salesOrderItem.customerName}` : '-',
        ],
        highlight: index === 0,
      })),
      primary: { label: `${top.lotNo} 처리하기`, href: `/quality/rejected?lot=${top.lotId}` },
      secondary: { label: '불합격 관리 열기', href: '/quality/rejected' },
    },
  };
}

/** 강종별 불합격률 (REQ-DSH-002, 최근 30일). 판정이 없으면 카드를 만들지 않는다 */
export function rejectRateCard(data: RejectRateData): BriefingCard | null {
  const inspected = data.grades.reduce((sum, g) => sum + g.inspectedCount, 0);
  if (inspected === 0) return null;
  const failed = data.grades.reduce((sum, g) => sum + g.failedCount, 0);
  const grades = data.grades.filter((g) => g.rejectRate !== null).sort((a, b) => (b.rejectRate ?? 0) - (a.rejectRate ?? 0) || a.steelGradeCode.localeCompare(b.steelGradeCode));
  const top = grades[0];
  const overall = failed / inspected;
  const ok = failed === 0 || !top;
  return {
    key: 'reject-rate',
    severity: ok ? 'ok' : 'run',
    title: `불합격률 (최근 ${data.days}일)`,
    value: pct(overall),
    summary: ok ? `판정 **${inspected}건** 모두 합격` : `판정 ${inspected}건 중 불합격 ${failed}건 · 가장 높은 **${top.steelGradeCode}** ${pct(top.rejectRate ?? 0)}`,
    rule: '불합격 판정 ÷ 판정된 검사',
    say: ok
      ? `좋은 소식! 최근 ${data.days}일 판정 **${inspected}건**이 모두 합격이에요.`
      : `최근 ${data.days}일 불합격률은 **${pct(overall)}**예요. **${top.steelGradeCode}**가 **${pct(top.rejectRate ?? 0)}**로 가장 높아요.`,
    detail: {
      crumb: '품질 › 강종별 불합격률',
      ruleExpr: `불합격 판정 수 ÷ 판정된 검사 수 (${data.from} ~ ${data.to})`,
      memo: ok ? '이 기간 불합격 판정이 없어요.' : `**${top.steelGradeCode}**가 가장 높아요. 공정별로 나눠 보면 어디서 떨어졌는지 알 수 있어요.`,
      columns: [{ label: '강종' }, { label: '판정', numeric: true }, { label: '불합격', numeric: true }, { label: '불합격률', numeric: true }],
      rows: [
        ...grades.slice(0, BRIEFING_DETAIL_ROWS).map((g, index) => ({
          cells: [g.steelGradeCode, String(g.inspectedCount), String(g.failedCount), pct(g.rejectRate ?? 0)],
          highlight: !ok && index === 0,
        })),
        { cells: ['전체', String(inspected), String(failed), pct(overall)] },
      ],
      primary: { label: '불합격 관리 열기', href: '/quality/rejected' },
      secondary: { label: '검사 입력 열기', href: '/quality/inspections' },
    },
  };
}

/** 여재 보유 기간 (REQ-DSH-002). 여재가 없으면 카드를 만들지 않는다 */
export function surplusAgeCard(data: SurplusAgeData): BriefingCard | null {
  if (data.totalQty === 0) return null;
  const items = [...data.items].sort((a, b) => b.maxAgeDays - a.maxAgeDays || a.itemCode.localeCompare(b.itemCode));
  const top = items[0];
  if (!top) return null;
  const aged = top.maxAgeDays >= BRIEFING_AGED_SURPLUS_DAYS;
  return {
    key: 'surplus-age',
    severity: aged ? 'wait' : 'run',
    title: aged ? '여재 장기 보유' : '여재 보유',
    value: `${data.totalQty}매`,
    summary: `**${top.itemCode}** ${top.surplusQty}매 · 가장 오래된 것 **${top.maxAgeDays}일**째`,
    rule: `여재 보유 ${BRIEFING_AGED_SURPLUS_DAYS}일 이상이면 확인`,
    say: aged
      ? `여재 슬래브가 **${data.totalQty}매**(${ton(data.totalTon)}) 있어요. **${top.itemCode}**는 **${top.maxAgeDays}일**째라 맞는 수주에 배정할 수 있는지 봐 주세요.`
      : `여재 슬래브가 **${data.totalQty}매** 있어요. 가장 오래된 것도 ${top.maxAgeDays}일이라 아직 괜찮아요.`,
    detail: {
      crumb: '재고 › 여재',
      ruleExpr: `오늘 − 여재가 된 날 ≥ ${BRIEFING_AGED_SURPLUS_DAYS}일`,
      memo: aged ? `**${top.itemCode}** 여재가 가장 오래됐어요. 같은 규격 수주가 있으면 배정 후보가 돼요.` : '오래된 여재는 아직 없어요.',
      columns: [{ label: '품목' }, { label: '강종' }, { label: '매수', numeric: true }, { label: '톤', numeric: true }, { label: '여재가 된 날' }, { label: '보유 일수', numeric: true }],
      rows: items.slice(0, BRIEFING_DETAIL_ROWS).map((i, index) => ({
        cells: [i.itemCode, i.steelGradeCode ?? '-', String(i.surplusQty), fmtNum(i.surplusTon, 3), fmtMD(i.oldestSinceDate), { text: `${i.maxAgeDays}일`, tone: i.maxAgeDays >= BRIEFING_AGED_SURPLUS_DAYS ? 'wait' : 'mute' }],
        highlight: aged && index === 0,
      })),
      note: `${BRIEFING_AGED_SURPLUS_DAYS}일 기준은 Factory Agent 여재 장기 보유 기준과 같은 가정값이에요.`,
      primary: { label: '여재 재고 열기', href: '/inventories?tab=surplus' },
    },
  };
}

/** 배정 대기 출하요청 (BP-SHP-01). 없으면 카드를 만들지 않는다 */
export function shipmentWaitingCard(rows: readonly ShipmentListRow[], today: string): BriefingCard | null {
  const waiting = rows.filter((r) => r.shipmentRequestStatus === 'REQUESTED').sort((a, b) => a.requestedShipDate.localeCompare(b.requestedShipDate) || a.shipmentRequestNo.localeCompare(b.shipmentRequestNo));
  const top = waiting[0];
  if (!top) return null;
  const late = waiting.filter((r) => r.requestedShipDate <= today).length;
  return {
    key: 'shipment-waiting',
    severity: late > 0 ? 'danger' : 'wait',
    title: '배정 대기 출하요청',
    value: `${waiting.length}건`,
    summary: `**${top.shipmentRequestNo}**(${top.customerName}) 출하 예정 ${dayLabel(top.requestedShipDate)} · 배정 대기 ${top.waitingAllocationQty}매`,
    rule: '출하요청 상태 = 배정 대기',
    say:
      late > 0
        ? `배정 대기 출하요청이 **${waiting.length}건**이에요. 그중 **${late}건**은 출하 예정일이 오늘이거나 지났어요. **${top.shipmentRequestNo}(${top.customerName})**부터 LOT을 배정해 주세요.`
        : `배정 대기 출하요청이 **${waiting.length}건** 있어요. 가장 빠른 건 **${top.shipmentRequestNo}(${top.customerName})**, ${dayLabel(top.requestedShipDate)} 출하예요.`,
    detail: {
      crumb: '영업 › 출하요청 › 배정 대기',
      ruleExpr: '출하요청 상태 = 배정 대기 → 출하 예정일 이른 순',
      memo: `**${top.shipmentRequestNo}**는 배정 대기 ${top.waitingAllocationQty}매가 남았어요. 출하요청 상세에서 합격 LOT을 배정할 수 있어요.`,
      columns: [{ label: '출하요청' }, { label: '고객사' }, { label: '출하 예정일' }, { label: '요청(매)', numeric: true }, { label: '배정 대기(매)', numeric: true }, { label: '톤', numeric: true }],
      rows: waiting.slice(0, BRIEFING_DETAIL_ROWS).map((r, index) => ({
        cells: [
          r.shipmentRequestNo,
          r.customerName,
          r.requestedShipDate <= today ? { text: dayLabel(r.requestedShipDate), tone: 'danger' } : dayLabel(r.requestedShipDate),
          String(r.totalRequestQty),
          String(r.waitingAllocationQty),
          fmtNum(r.totalWeightTon, 3),
        ],
        highlight: index === 0,
      })),
      primary: { label: '배정 대기 목록 열기', href: '/shipment-requests?status=REQUESTED' },
      secondary: { label: '출하요청 전체 보기', href: '/shipment-requests' },
    },
  };
}

/** 오늘부터 7일 안에 출하할 출하요청 (배정 대기·배정 확정). 없으면 카드를 만들지 않는다 */
export function upcomingShipmentsCard(rows: readonly ShipmentListRow[], today: string): BriefingCard | null {
  const until = addDays(today, BRIEFING_UPCOMING_DAYS - 1);
  const upcoming = rows.filter(
    (r) => (r.shipmentRequestStatus === 'REQUESTED' || r.shipmentRequestStatus === 'ALLOCATED') && r.requestedShipDate >= today && r.requestedShipDate <= until,
  );
  if (upcoming.length === 0) return null;
  const totalTon = decSum(upcoming.map((r) => r.totalWeightTon));
  const days = [...new Set(upcoming.map((r) => r.requestedShipDate))].sort().map((date) => {
    const onDay = upcoming.filter((r) => r.requestedShipDate === date);
    return { date, rows: onDay, ton: decSum(onDay.map((r) => r.totalWeightTon)) };
  });
  const peak = [...days].sort((a, b) => b.rows.length - a.rows.length || a.date.localeCompare(b.date))[0];
  const crowded = peak.rows.length >= 2;
  return {
    key: 'upcoming-shipments',
    severity: 'run',
    title: `${BRIEFING_UPCOMING_DAYS}일 안 출하 예정`,
    value: ton(totalTon),
    summary: `출하요청 **${upcoming.length}건**${crowded ? ` · ${dayLabel(peak.date)}에 ${peak.rows.length}건 몰림` : ''}`,
    rule: `출하 예정일이 오늘부터 ${BRIEFING_UPCOMING_DAYS}일 안`,
    say: crowded
      ? `앞으로 ${BRIEFING_UPCOMING_DAYS}일 출하 예정은 **${ton(totalTon)}**(${upcoming.length}건)이에요. **${dayLabel(peak.date)}**에 **${peak.rows.length}건**이 몰려 있어요.`
      : `앞으로 ${BRIEFING_UPCOMING_DAYS}일 출하 예정은 **${ton(totalTon)}**(${upcoming.length}건)이에요.`,
    detail: {
      crumb: '출하요청 › 출하 예정',
      ruleExpr: `Σ 매수 × 이론중량 (출하 예정일 ${today} ~ ${until}, 배정 대기·배정 확정)`,
      memo: crowded ? `**${dayLabel(peak.date)}**에 ${ton(peak.ton)}이 몰려 있어요.` : '출하 예정이 날짜별로 고르게 나뉘어 있어요.',
      columns: [{ label: '출하 예정일' }, { label: '출하요청', numeric: true }, { label: '톤', numeric: true }, { label: '고객사' }],
      rows: [
        ...days.map((d) => ({
          cells: [crowded && d.date === peak.date ? { text: dayLabel(d.date), tone: 'wait' as const } : dayLabel(d.date), `${d.rows.length}건`, fmtNum(d.ton, 3), [...new Set(d.rows.map((r) => r.customerName))].join(', ')],
          highlight: crowded && d.date === peak.date,
        })),
        { cells: ['합계', `${upcoming.length}건`, fmtNum(totalTon, 3), ''] },
      ],
      note: '제품 톤은 저장하지 않고 매수 × 이론중량으로 계산해요.',
      primary: { label: '출하요청 목록 열기', href: '/shipment-requests' },
    },
  };
}

/** 어제 출고 확정된 출하요청. 없으면 카드를 만들지 않는다 */
export function issuedYesterdayCard(rows: readonly ShipmentListRow[], today: string): BriefingCard | null {
  const yesterday = addDays(today, -1);
  const issued = rows.filter((r) => r.shipmentRequestStatus === 'ISSUED' && r.issuedAt !== null && toSeoulDateString(new Date(r.issuedAt)) === yesterday);
  if (issued.length === 0) return null;
  const totalTon = decSum(issued.map((r) => r.totalWeightTon));
  const customers = [...new Set(issued.map((r) => r.customerName))];
  return {
    key: 'issued-yesterday',
    severity: 'ok',
    title: '어제 출고 확정',
    value: `${issued.length}건`,
    summary: `${customers.join(', ')} · **${ton(totalTon)}**`,
    rule: '출고 확정일 = 어제',
    say: `좋은 소식! 어제 출하요청 **${issued.length}건**(${ton(totalTon)})이 출고 확정됐어요.`,
    detail: {
      crumb: '물류 › 출고 확정 › 어제',
      ruleExpr: `출하요청 상태 = 출고 완료 && 출고 확정일 = ${yesterday}`,
      memo: '출고 확정 때 밀시트도 함께 발행됐어요.',
      columns: [{ label: '출하요청' }, { label: '고객사' }, { label: '매수', numeric: true }, { label: '톤', numeric: true }, { label: '확정한 사람' }],
      rows: issued.slice(0, BRIEFING_DETAIL_ROWS).map((r) => ({ cells: [r.shipmentRequestNo, r.customerName, String(r.totalRequestQty), fmtNum(r.totalWeightTon, 3), r.issuedEmployeeName ?? '-'] })),
      primary: { label: '출고 완료 목록 열기', href: '/shipment-requests?status=ISSUED' },
    },
  };
}

/** 출고 확정 대기 (REQ-SHP-002): 배정 확정까지 끝난 출하요청 */
export function goodsIssueCard(queue: readonly GoodsIssueQueueRow[], today: string): BriefingCard {
  const waiting = queue.filter((r) => r.shipmentRequestStatus === 'ALLOCATED').sort((a, b) => a.requestedShipDate.localeCompare(b.requestedShipDate) || a.shipmentRequestNo.localeCompare(b.shipmentRequestNo));
  const ruleExpr = '출하요청 상태 = 배정 확정 → 출하 예정일 이른 순';
  const top = waiting[0];
  if (!top) {
    return {
      key: 'goods-issue',
      severity: 'ok',
      title: '출고 확정 대기',
      value: '0건',
      summary: '배정 확정된 출하요청을 모두 출고 확정함',
      rule: '출하요청 상태 = 배정 확정',
      say: '좋은 소식! 출고 확정을 기다리는 출하요청이 **하나도 없어요**.',
      detail: {
        crumb: '물류 › 출고 확정',
        ruleExpr,
        memo: '출고 확정 대기가 없어요.',
        columns: [{ label: '구분' }, { label: '값', numeric: true }],
        rows: [{ cells: ['출고 확정 대기', '0건'] }],
        primary: { label: '출고 확정 열기', href: '/goods-issues' },
      },
    };
  }
  const due = waiting.filter((r) => r.requestedShipDate <= today).length;
  const ready = waiting.filter((r) => r.ready).length;
  return {
    key: 'goods-issue',
    severity: due > 0 ? 'danger' : 'wait',
    title: '출고 확정 대기',
    value: `${waiting.length}건`,
    summary: `**${top.shipmentRequestNo}**(${top.customerName}) ${dayLabel(top.requestedShipDate)} · ${top.ready ? '바로 확정 가능' : `확인 필요 ${top.problems.length}가지`}`,
    rule: '배정 확정 · 출하 예정일 지나면 위험',
    say:
      due > 0
        ? `출고 확정 대기가 **${waiting.length}건**이에요. 그중 **${due}건**은 출하 예정일이 오늘이거나 지났어요. **${top.shipmentRequestNo}(${top.customerName})**부터 확정해 주세요.`
        : `출고 확정 대기가 **${waiting.length}건** 있어요. 그중 **${ready}건**은 바로 확정할 수 있어요.`,
    detail: {
      crumb: '물류 › 출고 확정 › 대기',
      ruleExpr,
      memo: top.ready
        ? `**${top.shipmentRequestNo}**는 다시 확인까지 통과해서 확정 버튼만 누르면 돼요. 밀시트는 출고 확정 때 함께 발행돼요.`
        : `**${top.shipmentRequestNo}**는 확정 전에 확인할 것이 있어요: ${top.problems.map((p) => p.message).join(' / ')}`,
      columns: [{ label: '출하요청' }, { label: '고객사' }, { label: '출하 예정일' }, { label: '매수', numeric: true }, { label: '톤', numeric: true }, { label: '상태' }],
      rows: waiting.slice(0, BRIEFING_DETAIL_ROWS).map((r, index) => ({
        cells: [
          r.shipmentRequestNo,
          r.customerName,
          r.requestedShipDate <= today ? { text: dayLabel(r.requestedShipDate), tone: 'danger' } : dayLabel(r.requestedShipDate),
          String(r.totalAllocatedQty),
          fmtNum(r.totalWeightTon, 3),
          r.ready ? { text: '확정 가능', tone: 'ok' } : { text: `확인 필요 ${r.problems.length}`, tone: 'wait' },
        ],
        highlight: index === 0,
      })),
      primary: { label: `${top.shipmentRequestNo} 출고 확정`, href: `/goods-issues?request=${top.shipmentRequestId}` },
      secondary: { label: '출고 확정 열기', href: '/goods-issues' },
    },
  };
}

/** 원료 부족 예상 (REQ-PRD-005, MRP 순소요 > 0) */
export function rawShortageCard(data: RawMaterialBalanceData): BriefingCard {
  const short = data.materials.filter((m) => decCmp(m.netTon, 0) > 0).sort((a, b) => (a.firstShortageDate ?? '9999').localeCompare(b.firstShortageDate ?? '9999') || a.itemCode.localeCompare(b.itemCode));
  const ruleExpr = `순소요 = 소요 − 잔량 − 입고예정 > 0 (필요일 ~ ${data.to})`;
  const top = short[0];
  if (!top) {
    return {
      key: 'raw-shortage',
      severity: 'ok',
      title: '원료 부족 예상',
      value: '없음',
      summary: `생산계획 **${data.planCount}건**에 필요한 원료가 모두 확보됨`,
      rule: 'MRP 순소요 > 0',
      say: `좋은 소식! ${fmtMD(data.to)}까지 생산계획 **${data.planCount}건**에 필요한 원료가 모두 확보돼 있어요.`,
      detail: {
        crumb: '구매 › MRP',
        ruleExpr,
        memo: '부족이 예상되는 원료가 없어요.',
        columns: [{ label: '원료' }, { label: '잔량(톤)', numeric: true }, { label: '소요(톤)', numeric: true }],
        rows: data.materials.slice(0, BRIEFING_DETAIL_ROWS).map((m) => ({ cells: [m.itemName, fmtNum(m.onHandTon, 3), fmtNum(m.grossTon, 3)] })),
        primary: { label: 'MRP 열기', href: '/mrp' },
      },
    };
  }
  return {
    key: 'raw-shortage',
    severity: 'danger',
    title: '원료 부족 예상',
    value: `${short.length}종`,
    summary: `**${top.itemName}** ${ton(top.netTon)} 부족${top.firstShortageDate ? ` · 첫 부족일 ${dayLabel(top.firstShortageDate)}` : ''}`,
    rule: 'MRP 순소요 > 0',
    say: `원료 **${short.length}종**이 부족할 것 같아요! **${top.itemName}**이 **${ton(top.netTon)}** 모자라요${top.firstShortageDate ? `. 첫 부족일은 **${dayLabel(top.firstShortageDate)}**예요` : ''}.`,
    detail: {
      crumb: '구매 › MRP › 부족',
      ruleExpr,
      memo: `**${top.itemName}**부터 구매요청을 만들어 주세요. MRP 화면에서 부족량 그대로 구매요청을 만들 수 있어요.`,
      columns: [{ label: '원료' }, { label: '잔량(톤)', numeric: true }, { label: '입고예정(톤)', numeric: true }, { label: '소요(톤)', numeric: true }, { label: '부족(톤)', numeric: true }, { label: '첫 부족일' }],
      rows: short.slice(0, BRIEFING_DETAIL_ROWS).map((m, index) => ({
        cells: [m.itemName, fmtNum(m.onHandTon, 3), fmtNum(m.coveredScheduledTon, 3), fmtNum(m.grossTon, 3), { text: fmtNum(m.netTon, 3), tone: 'danger' }, m.firstShortageDate ? dayLabel(m.firstShortageDate) : '-'],
        highlight: index === 0,
      })),
      primary: { label: 'MRP 열기', href: '/mrp' },
      secondary: { label: '구매요청 열기', href: '/purchase-requisitions' },
    },
  };
}

/** 승인됐지만 아직 발주하지 않은 구매요청. 없으면 카드를 만들지 않는다 */
export function approvedRequisitionsCard(data: PurchaseProgressData): BriefingCard | null {
  const approved = data.requisitionsByStatus?.find((s) => s.status === 'APPROVED')?.count ?? 0;
  const waiting = data.requisitionsByStatus?.find((s) => s.status === 'WAITING_APPROVAL')?.count ?? 0;
  if (approved === 0) return null;
  return {
    key: 'approved-requisitions',
    severity: 'wait',
    title: '발주 기다리는 구매요청',
    value: `${approved}건`,
    summary: `승인 끝난 구매요청 **${approved}건** · 승인 대기 ${waiting}건`,
    rule: '구매요청 상태 = 승인',
    say: `승인이 끝난 구매요청 **${approved}건**이 발주를 기다리고 있어요.`,
    detail: {
      crumb: '구매 › 구매요청',
      ruleExpr: '구매요청 상태 = 승인 (발주 전)',
      memo: '발주 화면에서 승인된 구매요청을 골라 발주를 확정할 수 있어요.',
      columns: [{ label: '상태' }, { label: '건수', numeric: true }],
      rows: (data.requisitionsByStatus ?? []).map((s) => ({ cells: [s.status === 'APPROVED' ? { text: PURCHASE_REQUISITION_STATUS_LABEL.APPROVED, tone: 'wait' } : PURCHASE_REQUISITION_STATUS_LABEL[s.status], `${s.count}건`], highlight: s.status === 'APPROVED' })),
      primary: { label: '발주 열기', href: '/purchase-orders' },
      secondary: { label: '구매요청 열기', href: '/purchase-requisitions' },
    },
  };
}

/** 입고가 남은 발주. 입고 예정일이 지난 발주가 있으면 '확인 필요'. 없으면 카드를 만들지 않는다 */
export function openPurchaseOrdersCard(data: PurchaseProgressData, today: string): BriefingCard | null {
  const open = data.openPurchaseOrders;
  const top = open?.purchaseOrders[0];
  if (!open || !top) return null;
  const late = open.purchaseOrders.filter((po) => po.expectedReceiptDate !== null && po.expectedReceiptDate < today).length;
  return {
    key: 'open-purchase-orders',
    severity: late > 0 ? 'wait' : 'run',
    title: '입고 남은 발주',
    value: `${open.count}건`,
    summary: `입고예정 **${ton(open.scheduledReceiptTon)}** · 가장 빠른 **${top.purchaseOrderNo}**${top.expectedReceiptDate ? ` ${dayLabel(top.expectedReceiptDate)}` : ''}`,
    rule: '발주 상태 = 확정·부분 입고',
    say:
      late > 0
        ? `입고가 남은 발주가 **${open.count}건**이에요. 그중 **${late}건**은 입고 예정일이 지났어요. **${top.purchaseOrderNo}(${top.supplierName})**부터 확인해 주세요.`
        : `입고가 남은 발주가 **${open.count}건**, 모두 **${ton(open.scheduledReceiptTon)}**이에요. 가장 빠른 입고는 **${top.purchaseOrderNo}(${top.supplierName})**예요.`,
    detail: {
      crumb: '구매 › 발주 › 입고 대기',
      ruleExpr: '발주 상태 ∈ {확정, 부분 입고} → 입고 예정일 이른 순',
      memo: `**${top.purchaseOrderNo}**의 입고가 가장 빨라요. 입고 등록은 입고 화면에서 해요.`,
      columns: [{ label: '발주번호' }, { label: '공급업체' }, { label: '입고 예정일' }, { label: '입고예정(톤)', numeric: true }],
      rows: open.purchaseOrders.slice(0, BRIEFING_DETAIL_ROWS).map((po, index) => ({
        cells: [
          po.purchaseOrderNo,
          po.supplierName,
          po.expectedReceiptDate === null ? '-' : po.expectedReceiptDate < today ? { text: dayLabel(po.expectedReceiptDate), tone: 'wait' } : dayLabel(po.expectedReceiptDate),
          fmtNum(po.scheduledReceiptTon, 3),
        ],
        highlight: index === 0,
      })),
      primary: { label: `${top.purchaseOrderNo} 열기`, href: `/purchase-orders?po=${top.purchaseOrderId}` },
      secondary: { label: '입고 열기', href: '/goods-receipts' },
    },
  };
}

/** 부서장의 결재 대기 구매요청 (REQ-AUTH-004). 없으면 카드를 만들지 않는다 */
export function approvalInboxCard(rows: readonly RequisitionView[]): BriefingCard | null {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const top = sorted[0];
  if (!top) return null;
  return {
    key: 'approval-inbox',
    severity: 'wait',
    title: '결재 대기',
    value: `${sorted.length}건`,
    summary: `**${top.purchaseRequisitionNo}** ${top.itemName} ${ton(top.requestedTon)} · ${top.requesterName ?? '요청자'}`,
    rule: '내 부서 구매요청 = 승인 대기',
    say: `부서장님 결재를 기다리는 구매요청이 **${sorted.length}건** 있어요. 가장 오래된 건 **${top.purchaseRequisitionNo}**예요.`,
    detail: {
      crumb: '승인함',
      ruleExpr: '구매요청 상태 = 승인 대기 && 요청 부서 = 내가 부서장인 부서',
      memo: `**${top.purchaseRequisitionNo}**(${top.itemName} ${ton(top.requestedTon)})가 가장 오래 기다렸어요.`,
      columns: [{ label: '구매요청' }, { label: '원료' }, { label: '요청(톤)', numeric: true }, { label: '희망 입고일' }, { label: '요청자' }],
      rows: sorted.slice(0, BRIEFING_DETAIL_ROWS).map((r, index) => ({
        cells: [r.purchaseRequisitionNo, r.itemName, fmtNum(r.requestedTon, 3), dayLabel(r.desiredReceiptDate), r.requesterName ?? '-'],
        highlight: index === 0,
      })),
      primary: { label: `${top.purchaseRequisitionNo} 결재하기`, href: `/approvals?pr=${top.id}` },
      secondary: { label: '승인함 열기', href: '/approvals' },
    },
  };
}

/** 마감이 지났거나 오늘인 내 업무. 없으면 카드를 만들지 않는다 */
export function taskCard(summary: TaskSummary): BriefingCard | null {
  if (summary.overdueCount === 0 && summary.dueTodayCount === 0) return null;
  const overdue = summary.overdueCount > 0;
  return {
    key: 'tasks',
    severity: overdue ? 'danger' : 'wait',
    title: overdue ? '마감 지난 업무' : '오늘 마감 업무',
    value: `${overdue ? summary.overdueCount : summary.dueTodayCount}건`,
    summary: `진행 중 **${summary.openCount}건** · 마감 지남 ${summary.overdueCount} · 오늘 마감 ${summary.dueTodayCount}`,
    rule: '내 담당 · 마감일 ≤ 오늘',
    say: overdue
      ? `마감이 지난 내 업무가 **${summary.overdueCount}건** 있어요.${summary.dueTodayCount > 0 ? ` 오늘 마감도 **${summary.dueTodayCount}건**이에요.` : ''}`
      : `오늘 마감인 업무가 **${summary.dueTodayCount}건** 있어요.`,
    detail: {
      crumb: '업무·알림 › 업무',
      ruleExpr: '담당자 = 나 && 상태 = 진행 && 마감일 ≤ 오늘',
      memo: '업무 화면에서 마감이 가까운 순서로 볼 수 있어요.',
      columns: [{ label: '구분' }, { label: '건수', numeric: true }],
      rows: [
        { cells: ['진행 중', `${summary.openCount}건`] },
        { cells: [{ text: '마감 지남', tone: summary.overdueCount > 0 ? 'danger' : 'mute' }, `${summary.overdueCount}건`], highlight: overdue },
        { cells: ['오늘 마감', `${summary.dueTodayCount}건`], highlight: !overdue },
      ],
      primary: { label: '내 업무 열기', href: '/tasks?tab=tasks' },
    },
  };
}

/** 확정을 기다리는 Factory Agent 대응 후보 (REQ-AGT-005·006). 없으면 카드를 만들지 않는다 */
export function agentRiskCard(data: AgentRiskData): BriefingCard | null {
  const top = data.items[0];
  if (data.openCount === 0 || !top) return null;
  return {
    key: 'agent-risk',
    severity: 'wait',
    title: 'Agent 대응 후보',
    value: `${data.openCount}건`,
    summary: data.byRisk.map((r) => `${RISK_NAME[r.riskType]} ${r.count}`).join(' · '),
    rule: 'Agent 후보 = 확정 전·실행 전',
    say: `Factory Agent가 찾은 위험에 대응 후보가 **${data.openCount}건** 있어요. 확정은 담당자가 직접 해요.`,
    detail: {
      crumb: 'AI Factory Agent',
      ruleExpr: 'Agent 후보 상태 ∈ {AI 생성, 확인 대기, 승인}',
      memo: `가장 최근 후보: ${top.summary}`,
      columns: [{ label: '위험 유형' }, { label: '내용' }],
      rows: data.items.map((i, index) => ({ cells: [RISK_NAME[i.riskType], i.summary], highlight: index === 0 })),
      primary: { label: 'Agent 열기', href: '/agent' },
    },
  };
}

/** 어제 생산량. 생산이 없으면 카드를 만들지 않는다 */
export function productionYesterdayCard(data: ProductionVolumeData, today: string): BriefingCard | null {
  const yesterday = addDays(today, -1);
  const point = data.series.find((p) => p.date === yesterday);
  if (!point || decCmp(point.ton, 0) <= 0) return null;
  const recent = data.series.filter((p) => p.date <= yesterday).slice(-5);
  return {
    key: 'production-yesterday',
    severity: 'ok',
    title: '어제 생산량',
    value: ton(point.ton),
    summary: `슬래브 **${point.slabQty}매** · 코일 **${point.coilQty}매**`,
    rule: '어제 완료된 작업 실적',
    say: `좋은 소식도 있어요! 어제 슬래브 **${point.slabQty}매**, 코일 **${point.coilQty}매**, 모두 **${ton(point.ton)}**을 만들었어요.`,
    detail: {
      crumb: '생산 › 작업 실적',
      ruleExpr: '완료된 작업 실적의 산출 (일별)',
      memo: '최근 닷새 생산량이에요.',
      columns: [{ label: '날짜' }, { label: '슬래브(매)', numeric: true }, { label: '코일(매)', numeric: true }, { label: '톤', numeric: true }],
      rows: recent.map((p) => ({ cells: [dayLabel(p.date), String(p.slabQty), String(p.coilQty), fmtNum(p.ton, 3)], highlight: p.date === yesterday })),
      primary: { label: '작업 실적 열기', href: '/production/results' },
    },
  };
}

// ── 역할별 묶음 ─────────────────────────────────────────

/** 역할마다 읽는 자료. 부서장이면 승인함을 더 읽는다 */
export const BRIEFING_ROLE_SOURCES: Record<RoleCode, readonly BriefingSourceKey[]> = {
  SALES: ['deliveryRisk', 'shipmentRequests', 'agentRisk', 'taskSummary'],
  PURCHASE: ['rawMaterialBalance', 'purchaseProgress', 'agentRisk', 'taskSummary'],
  PRODUCTION: ['inspectionQueue', 'deliveryRisk', 'surplusAge', 'productionVolume', 'agentRisk', 'taskSummary'],
  QUALITY: ['rejectedLots', 'inspectionQueue', 'rejectRate', 'agentRisk', 'taskSummary'],
  LOGISTICS: ['goodsIssueQueue', 'shipmentRequests', 'surplusAge', 'taskSummary'],
  ADMIN: ['agentRisk', 'deliveryRisk', 'surplusAge', 'taskSummary'],
};

export function briefingSourceKeys(role: RoleCode, isDepartmentHead: boolean): BriefingSourceKey[] {
  return [...(isDepartmentHead ? (['approvalInbox'] as const) : []), ...BRIEFING_ROLE_SOURCES[role]];
}

/** 왼쪽 "읽은 자료"에 보이는 이름 */
export const BRIEFING_SOURCE_LABEL: Record<BriefingSourceKey, string> = {
  deliveryRisk: '납기 위험 수주',
  surplusAge: '여재 재고',
  rejectRate: '강종별 불합격률',
  rawMaterialBalance: '원료 MRP',
  purchaseProgress: '구매 진행',
  productionVolume: '생산량',
  agentRisk: 'Agent 후보',
  inspectionQueue: '검사 대기',
  rejectedLots: '불합격 LOT',
  goodsIssueQueue: '출고 확정 대기',
  shipmentRequests: '출하요청',
  approvalInbox: '승인함',
  taskSummary: '내 업무',
};

/** 읽은 자료의 건수 표시 (읽지 못했으면 '-') */
export function briefingSourceCount(sources: BriefingSources, key: BriefingSourceKey): string {
  switch (key) {
    case 'deliveryRisk':
      return sources.deliveryRisk ? `${sources.deliveryRisk.items.length}건` : '-';
    case 'surplusAge':
      return sources.surplusAge ? `${sources.surplusAge.totalQty}매` : '-';
    case 'rejectRate':
      return sources.rejectRate ? `${sources.rejectRate.grades.length}강종` : '-';
    case 'rawMaterialBalance':
      return sources.rawMaterialBalance ? `${sources.rawMaterialBalance.materials.length}종` : '-';
    case 'purchaseProgress':
      return sources.purchaseProgress?.openPurchaseOrders ? `발주 ${sources.purchaseProgress.openPurchaseOrders.count}건` : sources.purchaseProgress ? '읽음' : '-';
    case 'productionVolume':
      return sources.productionVolume ? `${sources.productionVolume.days}일` : '-';
    case 'agentRisk':
      return sources.agentRisk ? `${sources.agentRisk.openCount}건` : '-';
    case 'inspectionQueue':
      return sources.inspectionQueue ? `${sources.inspectionQueue.filter((r) => r.inspectionResult === 'PENDING').length}개` : '-';
    case 'rejectedLots':
      return sources.rejectedLots ? `${sources.rejectedLots.length}개` : '-';
    case 'goodsIssueQueue':
      return sources.goodsIssueQueue ? `${sources.goodsIssueQueue.filter((r) => r.shipmentRequestStatus === 'ALLOCATED').length}건` : '-';
    case 'shipmentRequests':
      return sources.shipmentRequests ? `${sources.shipmentRequests.length}건` : '-';
    case 'approvalInbox':
      return sources.approvalInbox ? `${sources.approvalInbox.length}건` : '-';
    case 'taskSummary':
      return sources.taskSummary ? `${sources.taskSummary.openCount}건` : '-';
  }
}

/** 역할별 규칙을 차례로 돌린 카드 후보 (자료가 없거나 해당 없음이면 빠진다) */
function candidateCards(role: RoleCode, s: BriefingSources): (BriefingCard | null)[] {
  const t = s.today;
  const delivery = s.deliveryRisk ? deliveryRiskCard(s.deliveryRisk) : null;
  const surplus = s.surplusAge ? surplusAgeCard(s.surplusAge) : null;
  const agent = s.agentRisk ? agentRiskCard(s.agentRisk) : null;
  const tasks = s.taskSummary ? taskCard(s.taskSummary) : null;
  switch (role) {
    case 'SALES':
      return [
        delivery,
        s.shipmentRequests ? shipmentWaitingCard(s.shipmentRequests, t) : null,
        s.shipmentRequests ? upcomingShipmentsCard(s.shipmentRequests, t) : null,
        s.shipmentRequests ? issuedYesterdayCard(s.shipmentRequests, t) : null,
        tasks,
        agent,
      ];
    case 'PURCHASE':
      return [
        s.rawMaterialBalance ? rawShortageCard(s.rawMaterialBalance) : null,
        s.purchaseProgress ? approvedRequisitionsCard(s.purchaseProgress) : null,
        s.purchaseProgress ? openPurchaseOrdersCard(s.purchaseProgress, t) : null,
        tasks,
        agent,
      ];
    case 'PRODUCTION':
      return [
        s.inspectionQueue ? inspectionPendingCard(s.inspectionQueue, t, 'production') : null,
        // 납기 위험이 없다는 소식은 영업 카드라 생산에서는 빼고, 생산 좋은 소식(어제 생산량)을 쓴다
        delivery?.severity === 'ok' ? null : delivery,
        surplus,
        s.productionVolume ? productionYesterdayCard(s.productionVolume, t) : null,
        tasks,
        agent,
      ];
    case 'QUALITY':
      return [
        s.rejectedLots ? rejectedLotsCard(s.rejectedLots) : null,
        s.inspectionQueue ? inspectionPendingCard(s.inspectionQueue, t, 'quality') : null,
        s.rejectRate ? rejectRateCard(s.rejectRate) : null,
        tasks,
        agent,
      ];
    case 'LOGISTICS':
      return [
        s.goodsIssueQueue ? goodsIssueCard(s.goodsIssueQueue, t) : null,
        s.shipmentRequests ? upcomingShipmentsCard(s.shipmentRequests, t) : null,
        surplus,
        s.shipmentRequests ? issuedYesterdayCard(s.shipmentRequests, t) : null,
        tasks,
      ];
    case 'ADMIN':
      return [agent, tasks, delivery, surplus];
  }
}

/** 아무 카드도 없을 때 한 장 */
function quietCard(): BriefingCard {
  return {
    key: 'quiet',
    severity: 'ok',
    title: '오늘은 조용해요',
    value: '0건',
    summary: '규칙에 걸린 일이 없음',
    rule: '모든 브리핑 규칙',
    say: '오늘은 규칙에 걸린 일이 **하나도 없어요**. 편하게 시작해요!',
    detail: {
      crumb: '대시보드',
      ruleExpr: '모든 브리핑 규칙 = 해당 없음',
      memo: '급하게 볼 일이 없어요. 대시보드 위젯에서 전체 현황을 볼 수 있어요.',
      columns: [{ label: '구분' }, { label: '값' }],
      rows: [{ cells: ['규칙에 걸린 카드', '없음'] }],
      primary: { label: '대시보드 열기', href: '/dashboard' },
    },
  };
}

/**
 * 역할별 브리핑 카드 (최대 4장). 위험 → 확인 필요 → 참고 → 좋은 소식 순서이고,
 * 좋은 소식이 있으면 마지막 한 자리는 좋은 소식으로 남긴다(시안처럼 늘 좋은 말로 끝낸다).
 * 부서장이면 결재 대기를 먼저 넣는다.
 */
export function buildBriefingCards(role: RoleCode, sources: BriefingSources, isDepartmentHead: boolean): BriefingCard[] {
  const approvals = isDepartmentHead && sources.approvalInbox ? approvalInboxCard(sources.approvalInbox) : null;
  const all = [approvals, ...candidateCards(role, sources)].filter((c): c is BriefingCard => c !== null);
  const sorted = BRIEFING_SEVERITY_ORDER.flatMap((severity) => all.filter((c) => c.severity === severity));
  const good = sorted.filter((c) => c.severity === 'ok');
  const rest = sorted.filter((c) => c.severity !== 'ok');
  const picked = [...rest.slice(0, good.length > 0 ? BRIEFING_CARD_LIMIT - 1 : BRIEFING_CARD_LIMIT), ...good].slice(0, BRIEFING_CARD_LIMIT);
  return picked.length > 0 ? picked : [quietCard()];
}

/** 카드 심각도별 건수: "위험 1 · 확인 필요 2 · 좋은 소식 1" */
export function briefingCountLabel(cards: readonly BriefingCard[]): string {
  return BRIEFING_SEVERITY_ORDER.map((s) => ({ s, n: cards.filter((c) => c.severity === s).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${BRIEFING_SEVERITY_LABEL[x.s]} ${x.n}`)
    .join(' · ');
}

/** **강조** 표시를 나눈다: 홀수 번째 조각이 강조 */
export function splitEmphasis(text: string): { text: string; em: boolean }[] {
  return text
    .split(/\*\*(.+?)\*\*/)
    .map((part, index) => ({ text: part, em: index % 2 === 1 }))
    .filter((part) => part.text.length > 0);
}

/** 이 역할이 돌리는 규칙 수 (왼쪽 "브리핑 규칙 N개") */
export function briefingRuleCount(role: RoleCode, isDepartmentHead: boolean): number {
  return candidateCards(role, { today: '', ...EMPTY_BRIEFING_SOURCES }).length + (isDepartmentHead ? 1 : 0);
}

/** 타자 치는 중: 앞에서부터 shown 글자만 보이게 강조 조각을 자른다 */
export function visibleEmphasis(text: string, shown: number): { text: string; em: boolean }[] {
  const out: { text: string; em: boolean }[] = [];
  let left = shown;
  for (const part of splitEmphasis(text)) {
    if (left <= 0) break;
    const chars = [...part.text];
    out.push({ text: chars.slice(0, left).join(''), em: part.em });
    left -= chars.length;
  }
  return out;
}

/** 강조 표시를 뺀 글자 수 (타자 끝을 알려고) */
export const plainLength = (text: string): number => splitEmphasis(text).reduce((sum, part) => sum + [...part.text].length, 0);

/** 시각에 맞는 인사 (서울 시각) */
export function briefingGreeting(hour: number): string {
  if (hour < 11) return '좋은 아침이에요!';
  if (hour < 17) return '좋은 오후예요!';
  return '오늘 하루도 수고 많으셨어요!';
}

const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL_TIME_ZONE, weekday: 'short' });

/** 2026년 10월 23일 (금) 09:05 */
export function briefingDateText(date: Date): string {
  const p = seoulDateParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}년 ${p.month}월 ${p.day}일 (${weekdayFormatter.format(date)}) ${pad(p.hour)}:${pad(p.minute)}`;
}
