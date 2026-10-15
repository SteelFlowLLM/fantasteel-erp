import { AGENT_RISK_TYPE, type AgentDraftMeta, type MrpRequisitionLineView, type ReproductionCheck } from '@fantasteel/shared';

/**
 * 감지 규칙 (REQ-AGT-001~004, BP-AGT-01). 규칙이 감지하고 대응 후보를 만든다. LLM은 관여하지 않는다 (REQ-AGT-006).
 * DB를 읽지 않는 순수 함수라 단위 테스트로 확인한다.
 */

/** 🟡 TBD: 원료 부족을 볼 기간. 필요일이 오늘부터 이 일수 안인 계획의 소요만 본다 (docs/backend/factory-agent.md) */
export const RAW_SHORTAGE_HORIZON_DAYS = 30;

export interface RawShortageCandidate {
  meta: AgentDraftMeta;
  productionPlanId: number;
  itemId: number;
  requestedTon: string;
  desiredReceiptDate: string;
  requestReason: string;
}

export interface GoodQtyShortageCandidate {
  meta: AgentDraftMeta;
  salesOrderItemId: number;
  additionalPlanQty: number;
}

export const rawShortageKey = (productionPlanId: number, itemId: number) => `${AGENT_RISK_TYPE.RAW_SHORTAGE}:plan:${productionPlanId}:item:${itemId}`;
export const goodQtyShortageKey = (salesOrderItemId: number) => `${AGENT_RISK_TYPE.GOOD_QTY_SHORTAGE}:soItem:${salesOrderItemId}`;

/** 'YYYY-MM-DD'에 일수를 더한다 (UTC 날짜 연산이라 서울 날짜 문자열에 그대로 쓴다) */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * RAW_SHORTAGE (REQ-AGT-002): 계획 소요량이 원료 잔량 + 입고예정을 넘는 줄(MRP 순소요 > 0)마다 구매요청 후보를 만든다.
 * 같은 계획·원료의 구매요청이 이미 있으면(existingPurchaseRequisitionNo) 만들지 않는다.
 * 희망 입고일은 필요일이되, 이미 지난 날짜면 오늘로 둔다.
 */
export function rawShortageCandidates(lines: readonly MrpRequisitionLineView[], today: string): RawShortageCandidate[] {
  return lines
    .filter((line) => Number(line.netRequirementTon) > 0 && line.existingPurchaseRequisitionNo === null)
    .map((line) => {
      const desiredReceiptDate = line.requiredDate < today ? today : line.requiredDate;
      const summary = `${line.itemCode} ${line.itemName}: 생산계획 ${line.productionPlanNo} 소요가 잔량·입고예정보다 ${line.netRequirementTon}t 부족 (필요일 ${line.requiredDate})`;
      return {
        meta: {
          riskType: AGENT_RISK_TYPE.RAW_SHORTAGE,
          targetKey: rawShortageKey(line.productionPlanId, line.itemId),
          detectedOn: today,
          summary,
          evidence: { productionPlanNo: line.productionPlanNo, itemCode: line.itemCode, netRequirementTon: line.netRequirementTon, requiredDate: line.requiredDate },
        },
        productionPlanId: line.productionPlanId,
        itemId: line.itemId,
        requestedTon: line.netRequirementTon,
        desiredReceiptDate,
        requestReason: `[Agent] ${summary}`,
      };
    });
}

/**
 * GOOD_QTY_SHORTAGE (REQ-AGT-003): 합격 매수가 수주 대비 부족하면 재생산 후보를 만든다.
 * 재생산 판단(업무 프로세스 4.5)의 "추가 계획 필요"가 0보다 클 때만이다: 예약·진행 계획·검사 대기 제품으로 채워지면 부족이 아니다.
 * 진행 중인 수주 품목(OPEN·PARTIALLY_SHIPPED)만 본다.
 */
export function goodQtyShortageCandidate(check: ReproductionCheck, today: string): GoodQtyShortageCandidate | null {
  if (check.additionalPlanQty <= 0) return null;
  if (check.salesOrderItemStatus !== 'OPEN' && check.salesOrderItemStatus !== 'PARTIALLY_SHIPPED') return null;
  const summary = `수주 ${check.salesOrderNo} ${check.lineNo}번 품목: 합격 매수가 부족해 ${check.additionalPlanQty}매 추가 계획이 필요 (미확보 ${check.unsecuredQty}매, 진행 계획 잔여 ${check.openPlanRemainingQty}매)`;
  return {
    meta: {
      riskType: AGENT_RISK_TYPE.GOOD_QTY_SHORTAGE,
      targetKey: goodQtyShortageKey(check.salesOrderItemId),
      detectedOn: today,
      summary,
      evidence: {
        salesOrderNo: check.salesOrderNo,
        lineNo: check.lineNo,
        orderedQty: check.orderedQty,
        shippedQty: check.shippedQty,
        activeReservedQty: check.activeReservedQty,
        openPlanRemainingQty: check.openPlanRemainingQty,
        additionalPlanQty: check.additionalPlanQty,
        reservationAvailableQty: check.reservationAvailableQty,
      },
    },
    salesOrderItemId: check.salesOrderItemId,
    additionalPlanQty: check.additionalPlanQty,
  };
}

/** payload(jsonb)의 agent 칸을 읽는다. Agent가 만든 초안이 아니면 null (메시지 초안과 구분) */
export function agentMetaOf(payload: unknown): AgentDraftMeta | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const agent = (payload as Record<string, unknown>).agent;
  if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return null;
  const a = agent as Record<string, unknown>;
  const riskType = Object.values(AGENT_RISK_TYPE).find((t) => t === a.riskType);
  if (!riskType || typeof a.targetKey !== 'string') return null;
  return {
    riskType,
    targetKey: a.targetKey,
    detectedOn: typeof a.detectedOn === 'string' ? a.detectedOn : '',
    summary: typeof a.summary === 'string' ? a.summary : '',
    evidence: typeof a.evidence === 'object' && a.evidence !== null && !Array.isArray(a.evidence) ? (a.evidence as AgentDraftMeta['evidence']) : {},
  };
}
