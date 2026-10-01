// AI Factory Agent 예시 내용 (P2 준비 중 화면 전용, 실제 데이터 아님).
// 근거: 요구사항 REQ-AGT-001~006, 업무 프로세스 BP-AGT-01(위험 코드 제안·정상 흐름), 용어 사전 TRM-104~107.
// 번호는 9.1·9.2 형식 도우미로만 만든다. 작업 로그 주체는 USER/SYSTEM뿐이다 (AI 주체 없음).
import {
  ACTION_TYPE,
  BUSINESS_EVENT_TYPE,
  PERMISSION,
  PROPOSED_BUSINESS_EVENT_TYPE,
  STEEL_GRADE,
  formatBusinessNo,
  formatEventNo,
  formatRawMaterialLotNo,
  type ActionType,
  type ActorType,
  type BusinessEventType,
  type Permission,
  type ProposedBusinessEventType,
} from '@/codes';

/** BP-AGT-01 위험 코드 제안. 화면에는 코드 대신 요구사항(REQ-AGT-001)의 한글 이름을 쓴다. */
export const AGENT_RISK_CODES = ['RAW_SHORTAGE', 'GOOD_QTY_SHORTAGE', 'DUE_RISK', 'AGED_SURPLUS', 'QUALITY_RATE_RISE'] as const;
export type AgentRiskCode = (typeof AGENT_RISK_CODES)[number];

export const AGENT_RISK_NAME: Record<AgentRiskCode, string> = {
  RAW_SHORTAGE: '원료 부족',
  GOOD_QTY_SHORTAGE: '합격 매수 부족',
  DUE_RISK: '납기 위험',
  AGED_SURPLUS: '여재 장기 보유',
  QUALITY_RATE_RISE: '불합격률 상승',
};

/** 감지 트리거 (REQ-AGT-001, TRM-105) */
export type AgentTrigger = 'SCHEDULE' | 'EVENT';
export const AGENT_TRIGGER_NAME: Record<AgentTrigger, string> = { SCHEDULE: '스케줄', EVENT: '이벤트' };

export interface AgentRule {
  riskCode: AgentRiskCode;
  trigger: AgentTrigger;
  /** 규칙 (BP-AGT-01 표 그대로) */
  condition: string;
  /** 대응 (REQ-AGT-002~004) */
  response: string;
  /** 대응 후보가 만드는 업무 (Action Draft 유형). 알림만 보내는 유형은 없음 */
  actionType?: ActionType;
  /** 대응 후보를 확정할 수 있는 권한 = 후보가 만드는 업무의 권한 (REQ-AGT-006) */
  confirmPermission?: Permission;
}

/** BP-AGT-01 표 */
export const AGENT_RULES: readonly AgentRule[] = [
  {
    riskCode: 'RAW_SHORTAGE',
    trigger: 'SCHEDULE',
    condition: '생산계획 소요량이 원료 잔량 + 입고예정보다 큼',
    response: '구매요청 초안',
    actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE,
    confirmPermission: PERMISSION.PURCHASE_REQUISITION_CREATE,
  },
  {
    riskCode: 'GOOD_QTY_SHORTAGE',
    trigger: 'EVENT',
    condition: '검사 등록 때 합격 매수가 수주 대비 부족',
    response: '재생산 계획 초안',
    actionType: ACTION_TYPE.REPRODUCTION_PLAN_CREATE,
    confirmPermission: PERMISSION.PRODUCTION_PLAN_CONFIRM,
  },
  {
    riskCode: 'DUE_RISK',
    trigger: 'SCHEDULE',
    condition: '납기일까지 남은 일수가 기준일(초기 3일) 이하이고 출하 매수가 수주 매수보다 적음',
    response: '담당자 알림',
  },
  {
    riskCode: 'AGED_SURPLUS',
    trigger: 'SCHEDULE',
    condition: '여재 장기 보유 (보유일 기준은 미정)',
    response: '대기 수주 배정 추천',
  },
  {
    riskCode: 'QUALITY_RATE_RISE',
    trigger: 'SCHEDULE',
    condition: '강종별 불합격률 기준 초과 (기간은 미정)',
    response: '품질 부서 알림',
  },
];

export const agentRuleOf = (riskCode: AgentRiskCode): AgentRule => {
  const rule = AGENT_RULES.find((item) => item.riskCode === riskCode);
  if (!rule) throw new RangeError(`없는 위험 코드예요: ${riskCode}`);
  return rule;
};

// ── 예시 번호 (9.1·9.2 형식) ─────────────────────────────────────
export const EXAMPLE_NO = {
  rawShortagePlans: [formatBusinessNo('PRODUCTION_PLAN', '2610', 3), formatBusinessNo('PRODUCTION_PLAN', '2610', 4)],
  goodQtySalesOrder: formatBusinessNo('SALES_ORDER', '2609', 14),
  dueRiskSalesOrder: formatBusinessNo('SALES_ORDER', '2609', 11),
  limestoneLot: formatRawMaterialLotNo('LIM01', '260930', 2),
  limestoneReceipt: formatBusinessNo('GOODS_RECEIPT', '2609', 21),
} as const;

export interface AgentDetection {
  key: string;
  riskCode: AgentRiskCode;
  title: string;
  /** 대응 후보 수 (알림만 보내는 유형은 0) */
  candidateCount: number;
  detectedAt: string;
}

/** 감지 목록 예시 5건 (위험 유형마다 1건) */
export const AGENT_DETECTIONS: readonly AgentDetection[] = [
  { key: 'raw', riskCode: 'RAW_SHORTAGE', title: '철광석(ORE01) 1,200 t 부족 예상', candidateCount: 1, detectedAt: '10-01 06:00' },
  {
    key: 'good',
    riskCode: 'GOOD_QTY_SHORTAGE',
    title: `${EXAMPLE_NO.goodQtySalesOrder} ${STEEL_GRADE.SM355A} 코일 합격 4매 부족`,
    candidateCount: 1,
    detectedAt: '09-30 16:20',
  },
  {
    key: 'due',
    riskCode: 'DUE_RISK',
    title: `${EXAMPLE_NO.dueRiskSalesOrder} 납기 2일 남음 · 출하 6매 / 수주 10매`,
    candidateCount: 0,
    detectedAt: '10-01 06:00',
  },
  { key: 'aged', riskCode: 'AGED_SURPLUS', title: `${STEEL_GRADE.SM355B} 슬래브 250×1500×10000 여재 8매 보유`, candidateCount: 1, detectedAt: '10-01 06:00' },
  { key: 'rate', riskCode: 'QUALITY_RATE_RISE', title: `${STEEL_GRADE.SM355B} 불합격률 기준 초과`, candidateCount: 0, detectedAt: '10-01 06:00' },
];

/** 확정 전에 위험이 해소된 예 (BP-AGT-01 "승인 전 위험이 해소되면 재검증으로 실행을 막는다") */
export const AGENT_RESOLVED_EXAMPLE = {
  riskCode: 'RAW_SHORTAGE' as AgentRiskCode,
  title: `석회석(LIM01) 부족 예상 → ${EXAMPLE_NO.limestoneReceipt} 입고 확정(${EXAMPLE_NO.limestoneLot})으로 해소`,
  note: '확정 전 재검증에서 해소돼 실행하지 않았어요',
};

/** 선택한 감지(원료 부족)의 상황 설명 숫자 */
export const RAW_SHORTAGE_METRICS: readonly { label: string; value: string; unit: string; danger?: boolean }[] = [
  { label: '소요량', value: '3,400', unit: 't' },
  { label: '원료 잔량', value: '1,600', unit: 't' },
  { label: '입고예정', value: '600', unit: 't' },
  { label: '부족량', value: '1,200', unit: 't', danger: true },
];

/** 대응 후보 (Action Draft로 저장된 구매요청 초안) 예시 */
export const RAW_SHORTAGE_CANDIDATE = {
  actionType: ACTION_TYPE.PURCHASE_REQUISITION_CREATE,
  rawMaterial: '철광석',
  rawMaterialCode: 'ORE01',
  requiredTon: '1,200',
  desiredReceiptDate: '10-07',
} as const;

/** 대응 후보 처리 순서 (BP-AGT-01 정상 흐름, REQ-AGT-006) */
export const CANDIDATE_FLOW: readonly string[] = [
  '담당 부서원이 후보별 확정 (확정한 사람이 요청자)',
  '요청자 권한으로 구매요청 등록',
  '요청자 소속 부서장 최종 승인',
];

export interface AgentHistoryEntry {
  key: string;
  time: string;
  actorType: ActorType;
  eventType: BusinessEventType | ProposedBusinessEventType;
  eventNo?: string;
  head: string;
  detail: string;
  /** 아직 일어나지 않은 다음 단계 */
  pending?: boolean;
}

/** 감지 이력 (작업 로그). AI 상황 설명은 데이터를 바꾸지 않아 작업 로그에 남지 않는다. */
export const AGENT_HISTORY: readonly AgentHistoryEntry[] = [
  {
    key: 'detected',
    time: '10-01 06:00',
    actorType: 'SYSTEM',
    eventType: PROPOSED_BUSINESS_EVENT_TYPE.AGENT_RISK_DETECTED,
    eventNo: formatEventNo('261001', 1),
    head: '원료 부족 감지',
    detail: '철광석(ORE01) 부족량 1,200 t',
  },
  {
    key: 'draft',
    time: '10-01 06:00',
    actorType: 'SYSTEM',
    eventType: BUSINESS_EVENT_TYPE.DRAFT_CREATED,
    eventNo: formatEventNo('261001', 2),
    head: '대응 후보를 구매요청 초안으로 저장',
    detail: '같은 대상의 미처리 초안이 없어 새로 만들었어요',
  },
  {
    key: 'confirm',
    time: '확정 대기',
    actorType: 'USER',
    eventType: BUSINESS_EVENT_TYPE.DRAFT_CONFIRMED,
    head: '구매 부서원이 확정하면 기록돼요',
    detail: '확정한 사람이 요청자가 되고, 그 사람 권한으로 구매요청을 등록해요',
    pending: true,
  },
];
