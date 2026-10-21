import {
  ACTION_TYPE_LABEL,
  AGENT_RISK_TYPE,
  AGENT_RISK_TYPE_LABEL,
  DRAFT_STATUS,
  DRAFT_STATUS_LABEL,
  NOTIFICATION_TYPE,
  PERMISSION,
  PERMISSION_LABEL,
  type AgentCandidateView,
  type AgentRiskType,
  type AuthUser,
  type NotificationType,
  type Permission,
} from '@fantasteel/shared';
import { hasPermission } from '../../../common/auth/auth.guard';
import type { FactoryAgentService } from '../../factory-agent/factory-agent.service';
import type { NotificationService } from '../../notification/notification.service';
import { codeLabelList, limitRows, optionalBoolean, optionalEnum, seoulDateTimeText, type AssistantTool } from './assistant-tool';
import { AGENT_NOTIFICATION_TYPES, collectNotifications, notificationRow } from './notification.tool';

const RISK_TYPES = Object.values(AGENT_RISK_TYPE) as AgentRiskType[];

/** 대응 후보가 만드는 업무의 확정 권한 (factory-agent CONFIRM_PERMISSION). 이 중 하나의 조회 권한이 있어야 후보를 볼 수 있다 */
export const AGENT_CANDIDATE_PERMISSIONS: readonly Permission[] = [PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PRODUCTION_PLAN_CONFIRM, PERMISSION.SHIPMENT_REQUEST_MANAGE];

/** 알림형 위험(납기 위험·불합격률 상승)은 후보 없이 같은 이름의 알림만 보낸다 */
const ALERT_TYPE_OF_RISK: Partial<Record<AgentRiskType, NotificationType>> = {
  [AGENT_RISK_TYPE.DUE_RISK]: NOTIFICATION_TYPE.DUE_RISK,
  [AGENT_RISK_TYPE.QUALITY_RATE_RISE]: NOTIFICATION_TYPE.QUALITY_RATE_RISE,
};

/** 아직 처리하지 않은 후보 (화면의 isOpenCandidate와 같다): 확정 대기, 확정했지만 실행 전 */
export const isOpenAgentCandidate = (c: Pick<AgentCandidateView, 'draftStatus'>): boolean =>
  c.draftStatus === DRAFT_STATUS.AI_GENERATED || c.draftStatus === DRAFT_STATUS.WAITING_APPROVAL || c.draftStatus === DRAFT_STATUS.APPROVED;

export const canViewAgentCandidates = (user: AuthUser): boolean => AGENT_CANDIDATE_PERMISSIONS.some((permission) => hasPermission(user, { permission, level: 'VIEW' }));

/** 열린 후보를 앞에, 그 안에서는 최근 것을 앞에 (화면의 sortCandidates) */
export function sortAgentCandidates(list: readonly AgentCandidateView[]): AgentCandidateView[] {
  return [...list].sort((a, b) => Number(isOpenAgentCandidate(b)) - Number(isOpenAgentCandidate(a)) || b.id - a.id);
}

export function candidateRow(c: AgentCandidateView) {
  return {
    후보id: c.id,
    위험: AGENT_RISK_TYPE_LABEL[c.riskType],
    '대응 업무': ACTION_TYPE_LABEL[c.actionType],
    상태: DRAFT_STATUS_LABEL[c.draftStatus],
    요약: c.summary,
    감지: seoulDateTimeText(c.createdAt),
    ...(c.confirmerName ? { 확정자: c.confirmerName } : {}),
    ...(c.result ? { '만든 업무': c.result.no } : {}),
    ...(c.rejectReason ? { '반려 사유': c.rejectReason } : {}),
  };
}

/**
 * 공장 Agent 위험 후보·알림 (GET action-drafts?source=agent, 내 알림, 문서에 없는 기능 이슈 #506).
 * 후보는 그 후보가 만드는 업무(구매요청 등록·생산계획 확정·출하요청 관리)의 조회 권한이 있는 사원에게만 service가 돌려주고,
 * 알림은 내 알림(Agent 대응 후보·납기 위험·불합격률 상승)만이다. 사원마다 다른 목록이라 철강맨AI 패널에서만 알린다.
 */
export function agentRiskTool(agent: FactoryAgentService, notifications: NotificationService): AssistantTool {
  return {
    access: {
      checkedBy: 'SERVICE',
      permissions: AGENT_CANDIDATE_PERMISSIONS,
      note: '대응 후보는 후보가 만드는 업무(구매요청 등록·생산계획 확정·출하요청 관리)의 조회 권한이 있는 사원만 볼 수 있어요. 납기 위험·불합격률 상승 알림은 담당자의 알림함에만 와요.',
    },
    panelOnly: true,
    definition: {
      name: 'get_agent_risks',
      description: `공장 Agent가 감지한 위험의 대응 후보와 내게 온 Agent 알림을 조회한다. 열린 후보(처리 전)를 먼저 준다. riskType: ${codeLabelList(AGENT_RISK_TYPE_LABEL)}. 원료 부족·합격 매수 부족·여재 장기 보유는 대응 후보, 납기 위험·불합격률 상승은 후보 없이 알림만 있다. includeClosed=true면 처리가 끝난 후보도.`,
      parameters: {
        type: 'object',
        properties: {
          riskType: { type: 'string', enum: RISK_TYPES, description: '위험 유형' },
          includeClosed: { type: 'boolean', description: 'true면 확정·반영·반려로 끝난 후보도 (기본은 열린 후보만)' },
        },
      },
    },
    async run(args, user) {
      const riskType = optionalEnum(args, 'riskType', RISK_TYPES);
      const includeClosed = optionalBoolean(args, 'includeClosed') ?? false;
      const alertOnly = riskType !== undefined && ALERT_TYPE_OF_RISK[riskType] !== undefined;
      const visible = canViewAgentCandidates(user);
      const candidates = visible && !alertOnly ? sortAgentCandidates((await agent.list(user)).filter((c) => (riskType === undefined || c.riskType === riskType) && (includeClosed || isOpenAgentCandidate(c)))) : [];
      const limited = limitRows(candidates);
      const alertTypes = riskType === undefined ? AGENT_NOTIFICATION_TYPES : [ALERT_TYPE_OF_RISK[riskType] ?? NOTIFICATION_TYPE.AGENT_CANDIDATE];
      const alerts = await collectNotifications(notifications, user, { types: alertTypes });
      const alertRows = riskType !== undefined && !alertOnly ? alerts.rows.filter((n) => n.notificationContent.includes(AGENT_RISK_TYPE_LABEL[riskType])) : alerts.rows;
      const showCandidates = visible || alertOnly;
      return {
        label: `Agent 위험${riskType ? ` · ${AGENT_RISK_TYPE_LABEL[riskType]}` : ''}`,
        data: {
          ...(showCandidates ? { [includeClosed ? '대응 후보 수' : '열린 대응 후보 수']: candidates.length, '대응 후보': limited.rows.map(candidateRow), '생략 줄 수': limited.omitted } : { '대응 후보 안내': `대응 후보는 ${AGENT_CANDIDATE_PERMISSIONS.map((p) => `'${PERMISSION_LABEL[p]}'`).join('·')} 조회 권한이 있는 사원만 볼 수 있어요. 이 사원은 볼 수 없어요` }),
          '안 읽은 Agent 알림 수': alerts.unread,
          'Agent 알림': alertRows.map(notificationRow),
          ...(alerts.unscanned > 0 ? { '확인하지 못한 알림 수': alerts.unscanned } : {}),
        },
      };
    },
  };
}
