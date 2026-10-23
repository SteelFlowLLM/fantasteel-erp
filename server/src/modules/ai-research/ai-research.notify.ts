import { AI_RESEARCH_STATUS, NOTIFICATION_TYPE } from '@fantasteel/shared';
import type { AiResearchRun } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import type { NotificationService } from '../notification/notification.service';
import { cutText } from '../ai-assistant/web/web-text';
import { storedPlan } from './ai-research.rules';

/**
 * 🟡 알림 유형: 심층 조사 완료에 맞는 NOTIFICATION_TYPE이 공통 코드 정의서에 없다(공통 코드는 정의서에서 생성한 값이라 더하지 않는다).
 * 정의서에 유형이 생길 때까지 factory-agent처럼 확인할 일을 알리는 "업무 지정"을 쓴다 (docs/backend/ai-research.md).
 */
export const RESEARCH_NOTIFICATION_TYPE = NOTIFICATION_TYPE.TASK_ASSIGNED;

export const researchLink = (id: number): string => `/ai-research?id=${id}`;

/** 알림에 넣을 조사 제목 (계획 제목, 없으면 질문, 80자) */
export const researchTitleOf = (run: Pick<AiResearchRun, 'plan' | 'question'>): string => cutText((storedPlan(run.plan)?.title ?? run.question).replace(/\s+/g, ' ').trim(), 80);

/** 조사가 완료·실패로 끝났을 때 만든 사원에게 알린다. 취소는 본인이 한 일이라 알리지 않는다. 반복이 만든 조사는 반복이라고 밝힌다 (이슈 #521) */
export async function notifyResearchFinished(notifications: NotificationService, tx: Tx, run: AiResearchRun, status: typeof AI_RESEARCH_STATUS.COMPLETED | typeof AI_RESEARCH_STATUS.FAILED): Promise<void> {
  const title = researchTitleOf(run);
  const kind = run.scheduleId !== null ? '반복 심층 조사' : '심층 조사';
  const content = status === AI_RESEARCH_STATUS.COMPLETED ? `${kind} 완료 · ${title}` : `${kind} 실패 · ${title}`;
  await notifications.notifyEmployees(tx, [run.employeeId], { notificationType: RESEARCH_NOTIFICATION_TYPE, notificationContent: content, linkPath: researchLink(run.id) });
}

/** 반복 차례를 건너뛰었을 때 (이슈 #521). 이동 경로는 반복을 건 조사 */
export async function notifyResearchScheduleSkipped(notifications: NotificationService, tx: Tx, input: { employeeId: number; runId: number; title: string; reason: string }): Promise<void> {
  await notifications.notifyEmployees(tx, [input.employeeId], {
    notificationType: RESEARCH_NOTIFICATION_TYPE,
    notificationContent: `반복 심층 조사 건너뜀 · ${input.title} (${input.reason})`,
    linkPath: researchLink(input.runId),
  });
}
