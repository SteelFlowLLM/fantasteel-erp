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

/** 조사가 완료·실패로 끝났을 때 만든 사원에게 알린다. 취소는 본인이 한 일이라 알리지 않는다 */
export async function notifyResearchFinished(notifications: NotificationService, tx: Tx, run: AiResearchRun, status: typeof AI_RESEARCH_STATUS.COMPLETED | typeof AI_RESEARCH_STATUS.FAILED): Promise<void> {
  const title = cutText((storedPlan(run.plan)?.title ?? run.question).replace(/\s+/g, ' ').trim(), 80);
  const content = status === AI_RESEARCH_STATUS.COMPLETED ? `심층 조사 완료 · ${title}` : `심층 조사 실패 · ${title}`;
  await notifications.notifyEmployees(tx, [run.employeeId], { notificationType: RESEARCH_NOTIFICATION_TYPE, notificationContent: content, linkPath: researchLink(run.id) });
}
