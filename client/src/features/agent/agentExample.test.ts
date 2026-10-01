import { describe, expect, it } from 'vitest';
import { ACTION_TYPE_GRADE, ACTOR_TYPE, DRAFT_STATUS, DRAFT_STATUS_LABEL, PERMISSION } from '@/codes';
import { SEED_ROLE_PERMISSIONS } from '@/mock/seed';
import {
  AGENT_DETECTIONS,
  AGENT_HISTORY,
  AGENT_RESOLVED_EXAMPLE,
  AGENT_RISK_CODES,
  AGENT_RULES,
  CANDIDATE_FLOW,
  DRAFT_FLOW,
  EXAMPLE_NO,
  RAW_SHORTAGE_CANDIDATE,
  agentRuleOf,
  draftStepState,
} from '@/features/agent/agentExample';
import { businessEventLabelOf } from '@/features/agent/lib/businessEventLabel';
import { collectTexts, findForbiddenWords, findMalformedNumbers } from '@/features/agent/lib/exampleTextCheck';

const ALL_EXAMPLE = { AGENT_DETECTIONS, AGENT_HISTORY, AGENT_RESOLVED_EXAMPLE, AGENT_RULES, CANDIDATE_FLOW, EXAMPLE_NO };

describe('AI Factory Agent 예시 (BP-AGT-01)', () => {
  it('위험 코드 5개마다 규칙이 하나씩 있고 감지 예시도 하나씩 있다', () => {
    expect(AGENT_RULES.map((rule) => rule.riskCode)).toEqual([...AGENT_RISK_CODES]);
    expect(AGENT_DETECTIONS.map((item) => item.riskCode).sort()).toEqual([...AGENT_RISK_CODES].sort());
  });

  it('합격 매수 부족만 이벤트 트리거이고 나머지는 스케줄이다 (REQ-AGT-001)', () => {
    expect(AGENT_RULES.filter((rule) => rule.trigger === 'EVENT').map((rule) => rule.riskCode)).toEqual(['GOOD_QTY_SHORTAGE']);
  });

  it('초안을 만드는 후보는 확정 권한이 후보가 만드는 업무의 권한이다 (REQ-AGT-006)', () => {
    expect(agentRuleOf('RAW_SHORTAGE').confirmPermission).toBe(PERMISSION.PURCHASE_REQUISITION_CREATE);
    expect(agentRuleOf('GOOD_QTY_SHORTAGE').confirmPermission).toBe(PERMISSION.PRODUCTION_PLAN_CONFIRM);
    for (const rule of AGENT_RULES) expect(Boolean(rule.actionType)).toBe(Boolean(rule.confirmPermission));
    // 구매요청 등록 권한은 구매 역할만 사용(USE)한다 = 확정하는 사람은 부서장이 아니라 담당 부서원
    expect(SEED_ROLE_PERMISSIONS.PURCHASE.use).toContain(PERMISSION.PURCHASE_REQUISITION_CREATE);
  });

  it('구매요청 생성은 P1 유형이고, 재생산 계획 생성은 P2 제안 유형이다', () => {
    expect(ACTION_TYPE_GRADE[agentRuleOf('RAW_SHORTAGE').actionType ?? 'PURCHASE_REQUISITION_CREATE']).toBe('P1');
    expect(ACTION_TYPE_GRADE[agentRuleOf('GOOD_QTY_SHORTAGE').actionType ?? 'REPRODUCTION_PLAN_CREATE']).toBe('P2');
  });

  it('대응 후보 수: 알림만 보내는 유형은 0, 초안·추천 유형은 1', () => {
    const counts = Object.fromEntries(AGENT_DETECTIONS.map((item) => [item.riskCode, item.candidateCount]));
    expect(counts).toEqual({ RAW_SHORTAGE: 1, GOOD_QTY_SHORTAGE: 1, DUE_RISK: 0, AGED_SURPLUS: 1, QUALITY_RATE_RISE: 0 });
  });

  it('처리 순서는 담당 부서원 확정 → 요청자 권한 실행 → 요청자 소속 부서장 최종 승인이다', () => {
    expect(CANDIDATE_FLOW[0]).toContain('담당 부서원');
    expect(CANDIDATE_FLOW[0]).toContain('요청자');
    expect(CANDIDATE_FLOW.at(-1)).toContain('요청자 소속 부서장');
    expect(CANDIDATE_FLOW.join(' ')).not.toMatch(/SYSTEM|시스템/);
  });

  it('감지 이력의 주체는 사용자/시스템뿐이고, 사람이 확정하는 단계는 사용자다', () => {
    const actors = new Set(AGENT_HISTORY.map((entry) => entry.actorType));
    for (const actor of actors) expect(Object.values(ACTOR_TYPE)).toContain(actor);
    expect(AGENT_HISTORY.find((entry) => entry.businessEventType === 'DRAFT_CONFIRMED')?.actorType).toBe('USER');
  });

  it('예시 번호는 9.1·9.2 형식이고, 금지어·단독 SM355가 없다', () => {
    const texts = collectTexts(ALL_EXAMPLE);
    expect(findMalformedNumbers(texts)).toEqual([]);
    expect(findForbiddenWords(texts)).toEqual([]);
    expect(EXAMPLE_NO.rawShortagePlans).toEqual(['PP-2610-0003', 'PP-2610-0004']);
    expect(EXAMPLE_NO.goodQtySalesOrder).toBe('SO-2609-014');
    expect(EXAMPLE_NO.limestoneLot).toBe('RM-LIM01-260930-002');
  });

  it('확정 버튼이 있는 대응 후보는 확인 대기 상태다 (04 10장·13.4, REQ-ACT-003)', () => {
    expect(RAW_SHORTAGE_CANDIDATE.draftStatus).toBe(DRAFT_STATUS.WAITING_APPROVAL);
    expect(DRAFT_FLOW).toEqual(['AI_GENERATED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTED']);
    expect(DRAFT_FLOW.map((status) => draftStepState(status, RAW_SHORTAGE_CANDIDATE.draftStatus))).toEqual(['done', 'run', 'todo', 'todo']);
    expect(draftStepState(DRAFT_STATUS.EXECUTED, DRAFT_STATUS.EXECUTED)).toBe('run');
    expect(() => draftStepState(DRAFT_STATUS.REJECTED, DRAFT_STATUS.WAITING_APPROVAL)).toThrow(RangeError);
    // 감지 이력: 초안 생성 기록은 '생성'으로 시작해 '확인 대기'로 넘어갔다고 쓰고, 확정 단계는 '확인 대기' 중이다
    const created = AGENT_HISTORY.find((entry) => entry.businessEventType === 'DRAFT_CREATED');
    expect(created?.detail).toContain(DRAFT_STATUS_LABEL.AI_GENERATED);
    expect(created?.detail).toContain(DRAFT_STATUS_LABEL.WAITING_APPROVAL);
    expect(AGENT_HISTORY.find((entry) => entry.pending)?.time).toBe(DRAFT_STATUS_LABEL.WAITING_APPROVAL);
  });

  it('작업 로그 이벤트 표시명은 확정 코드·제안 코드 모두 공통 코드에서 온다', () => {
    expect(businessEventLabelOf('DRAFT_CREATED')).toBe('초안 생성');
    expect(AGENT_HISTORY.map((entry) => businessEventLabelOf(entry.businessEventType)).every((label) => label.length > 0)).toBe(true);
  });

  it('없는 위험 코드는 RangeError', () => {
    expect(() => agentRuleOf('NOPE' as never)).toThrow(RangeError);
  });
});
