// 알림 만들기 (REQ-NTF-002, REQ-ORG-004, BP-MSG-01). 가짜 서버의 NotificationService 자리.
// - 개인 발송: 받는 사원 id 목록. 부서 발송: 그 부서의 사용 중 사원 수만큼 행을 만들고 departmentId를 남긴다 (ERD notification).
// - 같은 작업 로그(businessEventId)와 받는 사람 조합은 한 번만 만든다 (ERD 메모의 부분 unique).
// - 메신저(멘션·업무방 메시지), 구매요청 승인 요청·결과 등 모든 영역이 이 함수 하나로 알림을 만든다.
import type { NotificationType } from '@/codes';
import type { NotificationRow } from '@/mock/schema';
import { insertRow, type MockTx } from '@/mock/store';

export interface CreateNotificationsInput {
  notificationType: NotificationType;
  title: string;
  body?: string | null;
  /** 누르면 이동할 화면 주소 (왼쪽 메뉴의 같은 화면) */
  linkPath?: string | null;
  /** 개인 발송 대상 */
  recipientEmployeeIds?: readonly number[];
  /** 부서 발송 대상. 그 부서 소속의 사용 중 사원 모두에게 간다 */
  departmentId?: number | null;
  /** 알림을 만든 작업 로그 */
  businessEventId?: number | null;
  /** 받지 않을 사원 (예: 메시지를 보낸 사람 자신) */
  excludeEmployeeIds?: readonly number[];
}

export function createNotifications(tx: MockTx, input: CreateNotificationsInput): NotificationRow[] {
  const departmentId = input.departmentId ?? null;
  const excluded = new Set(input.excludeEmployeeIds ?? []);
  const recipients = new Set<number>();
  for (const id of input.recipientEmployeeIds ?? []) recipients.add(id);
  if (departmentId !== null) {
    for (const employee of tx.tables.employee) {
      if (employee.departmentId === departmentId && employee.isActive) recipients.add(employee.id);
    }
  }

  const businessEventId = input.businessEventId ?? null;
  const created: NotificationRow[] = [];
  for (const recipientId of recipients) {
    if (excluded.has(recipientId)) continue;
    const recipient = tx.tables.employee.find((employee) => employee.id === recipientId);
    if (!recipient || !recipient.isActive) continue;
    if (
      businessEventId !== null &&
      tx.tables.notification.some((n) => n.businessEventId === businessEventId && n.recipientId === recipientId)
    ) {
      continue;
    }
    created.push(
      insertRow(tx, 'notification', {
        recipientId,
        departmentId,
        businessEventId,
        notificationType: input.notificationType,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
        isRead: false,
        readAt: null,
      }),
    );
  }
  return created;
}
