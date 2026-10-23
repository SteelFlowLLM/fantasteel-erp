import { AGENT_RISK_TYPE, type AgentDraftMeta } from '@fantasteel/shared';

/**
 * 납기 위험·불합격률 상승·여재 장기 보유 규칙 (REQ-AGT-004, BP-AGT-01). 규칙이 감지하고 LLM은 관여하지 않는다.
 * DB를 읽지 않는 순수 함수라 단위 테스트로 확인한다.
 */

/** 🟡 TBD: 여재 장기 보유로 보는 생산완료 후 경과일 */
export const AGED_SURPLUS_DAYS = 30;
/** 🟡 TBD: 강종별 불합격률을 보는 기간(일), 기준(초과), 최소 검사 건수(건수가 적으면 우연한 쏠림이라 제외) */
export const QUALITY_RATE_WINDOW_DAYS = 30;
export const QUALITY_RATE_LIMIT = 0.05;
export const QUALITY_RATE_MIN_SAMPLE = 5;

/** 'YYYY-MM-DD' 두 날짜 사이 일수 (to - from) */
export const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);

export interface DueItemInput {
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  ownerEmployeeId: number;
  dueDate: string;
  orderedQty: number;
  shippedQty: number;
}

export interface DueRiskAlert {
  meta: AgentDraftMeta;
  salesOrderItemId: number;
  salesOrderId: number;
  ownerEmployeeId: number;
  /** 날짜가 바뀌어도 같은 위험이면 같은 문장이라, 안 읽은 같은 알림이 있으면 다시 보내지 않는 기준이 된다 */
  content: string;
}

/**
 * DUE_RISK: 납기일까지 남은 일수가 기준일 이하이고(지난 납기 포함) 출하 매수가 수주 매수보다 적으면 담당자 알림.
 * 납기 검증(Promise Engine)은 범위 밖이라 규칙 알림만 한다.
 */
export function dueRiskAlerts(items: readonly DueItemInput[], today: string, riskDays: number): DueRiskAlert[] {
  return items
    .filter((i) => dayDiff(today, i.dueDate) <= riskDays && i.shippedQty < i.orderedQty)
    .map((i) => {
      const left = dayDiff(today, i.dueDate);
      const summary = `수주 ${i.salesOrderNo} ${i.lineNo}번 품목: 납기 ${i.dueDate}(${left >= 0 ? `${left}일 남음` : `${-left}일 지남`}), 출하 ${i.shippedQty}/${i.orderedQty}매`;
      return {
        meta: {
          riskType: AGENT_RISK_TYPE.DUE_RISK,
          targetKey: `${AGENT_RISK_TYPE.DUE_RISK}:soItem:${i.salesOrderItemId}`,
          detectedOn: today,
          summary,
          evidence: { salesOrderNo: i.salesOrderNo, lineNo: i.lineNo, dueDate: i.dueDate, daysLeft: left, orderedQty: i.orderedQty, shippedQty: i.shippedQty },
        },
        salesOrderItemId: i.salesOrderItemId,
        salesOrderId: i.salesOrderId,
        ownerEmployeeId: i.ownerEmployeeId,
        content: `[Agent 납기 위험] 수주 ${i.salesOrderNo} ${i.lineNo}번 품목 납기 ${i.dueDate}, 출하 ${i.shippedQty}/${i.orderedQty}매`,
      };
    });
}

export interface GradeInspectionCount {
  steelGradeCode: string;
  passCount: number;
  failCount: number;
}

export interface QualityRateAlert {
  meta: AgentDraftMeta;
  steelGradeCode: string;
  content: string;
}

/** QUALITY_RATE_RISE: 강종별 불합격률이 기준을 넘으면 품질 부서 알림. 검사 건수가 최소 건수보다 적은 강종은 보지 않는다 */
export function qualityRateAlerts(counts: readonly GradeInspectionCount[], today: string): QualityRateAlert[] {
  return counts
    .filter((c) => c.passCount + c.failCount >= QUALITY_RATE_MIN_SAMPLE && c.failCount / (c.passCount + c.failCount) > QUALITY_RATE_LIMIT)
    .map((c) => {
      const total = c.passCount + c.failCount;
      const rate = ((c.failCount / total) * 100).toFixed(1);
      const summary = `강종 ${c.steelGradeCode}: 최근 ${QUALITY_RATE_WINDOW_DAYS}일 불합격률 ${rate}% (불합격 ${c.failCount}/${total}건, 기준 ${QUALITY_RATE_LIMIT * 100}% 초과)`;
      return {
        meta: {
          riskType: AGENT_RISK_TYPE.QUALITY_RATE_RISE,
          targetKey: `${AGENT_RISK_TYPE.QUALITY_RATE_RISE}:grade:${c.steelGradeCode}`,
          detectedOn: today,
          summary,
          evidence: { steelGradeCode: c.steelGradeCode, failCount: c.failCount, totalCount: total, failRatePercent: rate, windowDays: QUALITY_RATE_WINDOW_DAYS },
        },
        steelGradeCode: c.steelGradeCode,
        content: `[Agent 불합격률 상승] 강종 ${c.steelGradeCode} 최근 ${QUALITY_RATE_WINDOW_DAYS}일 불합격률 ${rate}% (${c.failCount}/${total}건)`,
      };
    });
}

export interface AgedSurplusInput {
  itemId: number;
  itemCode: string;
  lots: readonly { lotNo: string; producedDate: string | null }[];
}

export interface WaitingOrder {
  salesOrderItemId: number;
  salesOrderNo: string;
  lineNo: number;
  dueDate: string;
  unsecuredQty: number;
}

export interface AgedSurplusCandidate {
  meta: AgentDraftMeta;
  itemId: number;
  agedLotNos: string[];
  recommendations: WaitingOrder[];
}

/**
 * AGED_SURPLUS: 생산완료 후 기준일을 넘긴 여재가 있고 같은 규격의 대기 수주(미확보 > 0)가 있으면 배정 추천 후보.
 * 대기 수주는 납기 빠른 순으로 추천한다. 추천만 하고 실행은 기존 배정·예약 화면에서 한다.
 */
export function agedSurplusCandidate(input: AgedSurplusInput, waiting: readonly WaitingOrder[], today: string): AgedSurplusCandidate | null {
  const aged = input.lots.filter((l) => l.producedDate !== null && dayDiff(l.producedDate, today) >= AGED_SURPLUS_DAYS);
  const recommendations = waiting.filter((w) => w.unsecuredQty > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.salesOrderItemId - b.salesOrderItemId);
  if (aged.length === 0 || recommendations.length === 0) return null;
  const first = recommendations[0];
  const summary = `${input.itemCode}: 생산완료 ${AGED_SURPLUS_DAYS}일 이상 여재 ${aged.length}매, 대기 수주 ${recommendations.length}건 (가장 급한 수주 ${first.salesOrderNo} ${first.lineNo}번 품목, 미확보 ${first.unsecuredQty}매)`;
  return {
    meta: {
      riskType: AGENT_RISK_TYPE.AGED_SURPLUS,
      targetKey: `${AGENT_RISK_TYPE.AGED_SURPLUS}:item:${input.itemId}`,
      detectedOn: today,
      summary,
      evidence: { itemCode: input.itemCode, agedSurplusQty: aged.length, waitingOrderCount: recommendations.length, oldestProducedDate: aged.map((l) => l.producedDate ?? '').sort()[0] },
    },
    itemId: input.itemId,
    agedLotNos: aged.map((l) => l.lotNo),
    recommendations,
  };
}
