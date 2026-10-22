import { Logger } from '@nestjs/common';
import { PERMISSION, TASK_STATUS, type AuthUser, type TaskView } from '@fantasteel/shared';
import { hasPermission } from '../../../common/auth/auth.guard';
import { seoulToday } from '../../../common/time/seoul-date';
import type { FactoryAgentService } from '../../factory-agent/factory-agent.service';
import type { NotificationService } from '../../notification/notification.service';
import type { TaskService } from '../../notification/task.service';
import type { PurchasingService } from '../../purchasing/purchasing.service';
import type { SalesOrderService } from '../../sales-order/sales-order.service';
import type { ScheduleEventService } from '../../schedule-event/schedule-event.service';
import { candidateRow, canViewAgentCandidates, isOpenAgentCandidate, sortAgentCandidates } from './agent.tool';
import { approvalRow, NOT_DEPARTMENT_HEAD, readApprovalInbox } from './approval.tool';
import { daysUntil, OPEN_ACCESS, scanFiltered, seoulDateTimeText, type AssistantTool } from './assistant-tool';
import { AGENT_NOTIFICATION_TYPES, notificationRow, readUnreadNotifications, type UnreadNotifications } from './notification.tool';

const logger = new Logger('get_my_briefing');

/** 마감이 이 일수 안으로 다가온 업무를 "마감 임박"으로 본다 (가정값) */
export const BRIEFING_TASK_SOON_DAYS = 3;
/** 묶음마다 보여 주는 줄 수. 작은 모델의 문맥을 넘지 않게 짧게 (가정값) */
export const BRIEFING_ROWS = 5;
/** 먼저 할 일 후보 한 줄에 붙이는 예시 글자 수 */
const EXAMPLE_MAX = 60;
/** 먼저 할 일 후보로 올리는 줄 수 */
export const BRIEFING_TOP = 3;
const NONE = '없음';

export interface BriefingServices {
  scheduleEvents: ScheduleEventService;
  tasks: TaskService;
  purchasing: PurchasingService;
  notifications: NotificationService;
  agent: FactoryAgentService;
  salesOrders: SalesOrderService;
}

interface Omitted {
  묶음: string;
  이유: string;
}

/** 묶음 하나를 읽다 실패해도 나머지 브리핑은 준다 */
async function guarded<T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.error(`브리핑 묶음 실패 (${name})`, error instanceof Error ? error.stack : String(error));
    return fallback;
  }
}

const hhmm = (iso: string): string => seoulDateTimeText(iso).slice(11);

/** 묶음 하나: 모델에 줄 값(없으면 '없음')과, 먼저 할 일 후보에 올릴 한 줄(읽을 것이 없으면 null) */
interface Section {
  value: unknown;
  headline: string | null;
}

const empty: Section = { value: NONE, headline: null };

async function todaySchedule(s: BriefingServices, user: AuthUser, today: string): Promise<Section> {
  const events = await s.scheduleEvents.listMine(user, { from: today, to: today });
  const first = events[0];
  if (!first) return empty;
  return {
    value: {
      '일정 수': events.length,
      일정: events.slice(0, BRIEFING_ROWS).map((e) => ({ 제목: e.scheduleEventTitle, 시간: `${hhmm(e.startAt)}~${hhmm(e.endAt)}`, 참석자: e.attendees.map((a) => a.employeeName) })),
      ...(events.length > BRIEFING_ROWS ? { '더 있는 수': events.length - BRIEFING_ROWS } : {}),
    },
    headline: `오늘 일정 ${events.length}건 (첫 일정: ${first.scheduleEventTitle} ${hhmm(first.startAt)})`,
  };
}

interface MyTasks {
  overdue: Section;
  soon: Section;
  unscanned: number;
}

/** 내 담당 진행 업무 중 마감이 지난 것과 임박한 것 (마감일 빠른 순) */
async function myTasks(s: BriefingServices, user: AuthUser, today: string): Promise<MyTasks> {
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + BRIEFING_TASK_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const scan = await scanFiltered(
    (page, size) => s.tasks.list(user, { scope: 'mine', taskStatus: TASK_STATUS.OPEN, page, size }),
    (t) => t.dueDate <= limit,
  );
  const section = (rows: TaskView[], label: string, nearest: string): Section => {
    const first = rows[0];
    if (!first) return empty;
    return {
      value: { '업무 수': rows.length, 업무: rows.slice(0, BRIEFING_ROWS).map((t) => ({ 업무id: t.id, 제목: t.taskTitle, 마감일: t.dueDate, '마감까지 남은 일수': daysUntil(t.dueDate, today), 등록자: t.creatorName })) },
      headline: `${label} ${rows.length}건 (${nearest}: ${first.taskTitle}, 마감 ${first.dueDate})`,
    };
  };
  return { overdue: section(scan.rows.filter((t) => t.dueDate < today), '마감이 지난 내 업무', '가장 오래된 것'), soon: section(scan.rows.filter((t) => t.dueDate >= today), '마감 임박 내 업무', '가장 가까운 것'), unscanned: scan.unscanned };
}

/** 부서장이 아니면 null: 결재 묶음이 없다 */
async function approvals(s: BriefingServices, user: AuthUser): Promise<Section | null> {
  const inbox = await readApprovalInbox(s.purchasing, user, BRIEFING_ROWS);
  if (inbox.total === null) return null;
  const first = inbox.rows[0];
  if (inbox.total === 0 || !first) return empty;
  return {
    value: { '결재 대기 구매요청 수': inbox.total, 구매요청: inbox.rows.map(approvalRow), ...(inbox.total > inbox.rows.length ? { '더 있는 수': inbox.total - inbox.rows.length } : {}) },
    headline: `내 결재 대기 구매요청 ${inbox.total}건 (${first.purchaseRequisitionNo} ${first.itemName} ${first.requestedTon}t, 요청자 ${first.requesterName})`,
  };
}

/** 안 읽은 알림 중 Agent 알림(대응 후보·납기 위험·불합격률 상승)은 Agent 묶음에 있어서 뺀다: 한 알림을 두 묶음에서 세어 모델이 숫자를 겹쳐 말하지 않게 */
async function unreadNotifications(unreadRead: Promise<UnreadNotifications>): Promise<Section> {
  const unread = await unreadRead;
  const rows = unread.rows.filter((n) => !AGENT_NOTIFICATION_TYPES.includes(n.notificationType));
  if (rows.length === 0 && unread.unscanned === 0) return empty;
  return {
    value: {
      '안 읽은 알림 수(Agent 알림 제외)': rows.length,
      알림: rows.slice(0, BRIEFING_ROWS).map(notificationRow),
      ...(rows.length > BRIEFING_ROWS ? { '더 있는 수': rows.length - BRIEFING_ROWS } : {}),
      ...(unread.unscanned > 0 ? { '확인하지 못한 알림 수': unread.unscanned } : {}),
    },
    headline: rows.length > 0 ? `안 읽은 알림 ${rows.length}건` : null,
  };
}

/** 열린 대응 후보(볼 권한이 있을 때, 처리 전인 후보만 읽는다)와 안 읽은 Agent 알림(안 읽은 알림 목록을 알림 묶음과 나눠 쓴다) */
async function agentRisks(s: BriefingServices, user: AuthUser, unreadRead: Promise<UnreadNotifications>): Promise<Section> {
  const visible = canViewAgentCandidates(user);
  const candidates = visible ? sortAgentCandidates((await s.agent.list(user, { openOnly: true })).filter(isOpenAgentCandidate)) : [];
  const alerts = (await unreadRead).rows.filter((n) => AGENT_NOTIFICATION_TYPES.includes(n.notificationType));
  if (candidates.length === 0 && alerts.length === 0) return empty;
  const parts = [...(visible ? [`열린 Agent 대응 후보 ${candidates.length}건`] : []), `안 읽은 Agent 알림 ${alerts.length}건`];
  const example = candidates[0]?.summary ?? alerts[0]?.notificationContent;
  const exampleText = example && example.length > EXAMPLE_MAX ? `${example.slice(0, EXAMPLE_MAX)}…` : example;
  return {
    value: {
      ...(visible ? { '열린 대응 후보 수': candidates.length, '대응 후보': candidates.slice(0, BRIEFING_ROWS).map(candidateRow) } : {}),
      '안 읽은 Agent 알림 수': alerts.length,
      'Agent 알림': alerts.slice(0, BRIEFING_ROWS).map(notificationRow),
    },
    headline: `열린 Agent 위험: ${parts.join(', ')}${exampleText ? ` (예: ${exampleText})` : ''}`,
  };
}

/** 납기 위험 수주(진행 중 수주 중 납기까지 기준일 이하 + 미출하)를 납기 빠른 순으로. 수주 등록 조회 권한이 있을 때만 */
async function dueRiskSalesOrders(s: BriefingServices, today: string): Promise<Section> {
  const dueRisk = await s.salesOrders.listDueRisk();
  const first = dueRisk[0];
  if (!first) return empty;
  const days = first.earliestDueDate ? daysUntil(first.earliestDueDate, today) : null;
  return {
    value: {
      '납기 위험 수주 수': dueRisk.length,
      수주: dueRisk.slice(0, BRIEFING_ROWS).map((salesOrder) => ({
        수주번호: salesOrder.salesOrderNo,
        고객사: salesOrder.customerName,
        '가장 이른 납기': salesOrder.earliestDueDate,
        '납기까지 남은 일수': salesOrder.earliestDueDate ? daysUntil(salesOrder.earliestDueDate, today) : null,
        담당: salesOrder.ownerEmployeeName,
      })),
      ...(dueRisk.length > BRIEFING_ROWS ? { '더 있는 수': dueRisk.length - BRIEFING_ROWS } : {}),
    },
    headline: `납기 위험 수주 ${dueRisk.length}건 (가장 이른 것: ${first.salesOrderNo} ${first.customerName}, 납기 ${first.earliestDueDate ?? '미정'}${days === null ? '' : days < 0 ? `, ${-days}일 지남` : `, ${days}일 남음`})`,
  };
}

/**
 * 아침 브리핑 (문서에 없는 기능 이슈 #506). 로컬 모델이 도구를 여러 번 고르지 않아도 되게, 하루 시작에 볼 것을 한 번에 모은다:
 * 오늘 내 일정, 마감이 지났거나 임박한 내 업무, 내 결재 대기, 안 읽은 알림, 열린 Agent 위험, 납기 위험 수주.
 * 각 묶음은 묶음을 부르는 화면과 같은 service를 그 사원으로 부른다. 권한이 없거나 해당되지 않는 묶음(부서장이 아니면 결재, 수주 조회 권한이 없으면 납기)은 빼고 "제외한 묶음"에 이유를 적는다.
 * 읽을 것이 없는 묶음은 '없음'. '먼저 할 일 후보'는 급한 순서(PRIORITY)로 읽을 것이 있는 묶음의 한 줄을 서버가 앞에서 3개 골라 준다 —
 * 작은 모델이 우선순위를 스스로 따지다 흐려지는 것을 막고, 모델은 그 줄을 짧게 옮겨 쓴다. 사원 본인의 것이라 철강맨AI 패널에서만 알린다.
 */
export function myBriefingTool(s: BriefingServices, today: () => string = seoulToday): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_briefing',
      description:
        '아침 브리핑에 쓸 내 하루 현황을 한 번에 모아 준다(급한 순서): 마감이 지난 내 업무, 납기 위험 수주(수주 조회 권한이 있을 때), 열린 Agent 위험, 내 결재 대기(부서장일 때), 오늘 내 일정, 마감 임박 내 업무, 안 읽은 알림. "오늘 브리핑", "오늘 뭐부터 해야 해?", "오늘 할 일 정리해 줘" 같은 질문에 이 도구 하나만 부른다. 여러 도구를 따로 부르지 않는다.',
      parameters: { type: 'object', properties: {} },
    },
    async run(_args, user) {
      const date = today();
      const omitted: Omitted[] = [];
      const canViewSalesOrders = hasPermission(user, { permission: PERMISSION.SALES_ORDER_CREATE, level: 'VIEW' });
      const failed = { 오류: '이 묶음은 조회하지 못했어요' };
      const failure: Section = { value: failed, headline: null };
      // 안 읽은 알림은 한 번만 읽어 알림 묶음과 Agent 묶음이 나눠 쓴다 (두 묶음이 같은 목록을 1,000건까지 두 번 읽지 않게)
      const unreadRead = readUnreadNotifications(s.notifications, user);
      unreadRead.catch(() => undefined);
      const [schedule, tasks, approval, notifications, agent, salesOrders] = await Promise.all([
        guarded('오늘 내 일정', () => todaySchedule(s, user, date), failure),
        guarded('내 업무', () => myTasks(s, user, date), { overdue: failure, soon: failure, unscanned: 0 }),
        guarded('내 결재 대기', () => approvals(s, user), failure),
        guarded('안 읽은 알림', () => unreadNotifications(unreadRead), failure),
        guarded('열린 Agent 위험', () => agentRisks(s, user, unreadRead), failure),
        canViewSalesOrders ? guarded('납기 위험 수주', () => dueRiskSalesOrders(s, date), failure) : Promise.resolve(null),
      ]);
      if (approval === null) omitted.push({ 묶음: '내 결재 대기', 이유: NOT_DEPARTMENT_HEAD });
      if (salesOrders === null) omitted.push({ 묶음: '납기 위험 수주', 이유: '수주 등록 조회 권한이 없어 볼 수 없어요' });
      // 급한 순서: 지난 업무 → 납기 위험 수주 → Agent 위험 → 결재 → 일정 → 임박 업무 → 알림 (가정값)
      const ranked = [tasks.overdue, salesOrders, agent, approval, schedule, tasks.soon, notifications].flatMap((section) => (section?.headline ? [section.headline] : []));
      return {
        label: '오늘 브리핑',
        // 키 순서도 같은 우선순위다(작은 모델은 앞에 있는 묶음부터 본다)
        data: {
          기준일: date,
          [`먼저 할 일 후보(급한 순서, 최대 ${BRIEFING_TOP})`]: ranked.length === 0 ? NONE : ranked.slice(0, BRIEFING_TOP),
          '마감이 지난 내 업무': tasks.overdue.value,
          ...(salesOrders === null ? {} : { '납기 위험 수주': salesOrders.value }),
          '열린 Agent 위험': agent.value,
          ...(approval === null ? {} : { '내 결재 대기': approval.value }),
          '오늘 내 일정': schedule.value,
          [`마감 임박 내 업무 (${BRIEFING_TASK_SOON_DAYS}일 안)`]: tasks.soon.value,
          '안 읽은 알림': notifications.value,
          ...(omitted.length ? { '제외한 묶음': omitted } : {}),
          ...(tasks.unscanned > 0 ? { '확인하지 못한 업무 수': tasks.unscanned } : {}),
        },
      };
    },
  };
}
