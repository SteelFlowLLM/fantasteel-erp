import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';
import { RealtimeService } from '../../common/realtime/realtime.service';

export interface SendNotificationInput {
  notificationType: NotificationType;
  title: string;
  body?: string | null;
  /** 눌렀을 때 이동할 화면 경로. 예: "/sales-orders/12" */
  linkPath?: string | null;
  /** 같은 이벤트를 같은 수신자에게 두 번 보내지 않기 위한 키. 예: "PR_APPROVAL:15" */
  dedupeKey?: string | null;
  /** 이 사원에게는 보내지 않는다 (보통 행위자 본인) */
  excludeEmployeeId?: number | null;
}

/**
 * 알림 발송기 (REQ-NTF-002). 메신저·승인·업무 등 모든 모듈이 이 모듈로 알림을 보낸다.
 * 본 거래와 같은 tx에서 호출하고, 실시간 전달은 커밋 뒤에 나간다.
 */
@Injectable()
export class NotificationSender {
  constructor(private readonly realtime: RealtimeService) {}

  /** 개인 단위 알림 */
  async toEmployees(tx: Tx, employeeIds: number[], input: SendNotificationInput, departmentId?: number | null): Promise<void> {
    const ids = [...new Set(employeeIds)].filter((id) => id !== input.excludeEmployeeId);
    if (!ids.length) return;
    let targets = ids;
    if (input.dedupeKey) {
      const dup = await tx.notification.findMany({ where: { recipientId: { in: ids }, dedupeKey: input.dedupeKey }, select: { recipientId: true } });
      const seen = new Set(dup.map((d) => d.recipientId));
      targets = ids.filter((id) => !seen.has(id));
    }
    if (!targets.length) return;
    await tx.notification.createMany({
      data: targets.map((recipientId) => ({
        recipientId,
        departmentId: departmentId ?? null,
        notificationType: input.notificationType,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
    });
    this.realtime.toEmployees(targets, 'notification', { notificationType: input.notificationType, title: input.title, body: input.body ?? null, linkPath: input.linkPath ?? null });
  }

  /** 부서 단위 알림: 발송 시점의 ACTIVE 부서원에게 펼쳐 보낸다 (조직 정보 사용, REQ-ORG-004). */
  async toDepartment(tx: Tx, departmentId: number, input: SendNotificationInput): Promise<void> {
    const members = await tx.employee.findMany({ where: { departmentId, employeeStatus: 'ACTIVE' }, select: { id: true } });
    await this.toEmployees(tx, members.map((m) => m.id), input, departmentId);
  }

  /** 역할 단위 알림 (예: 생산계획이 필요해지면 생산 역할 전원). */
  async toRole(tx: Tx, roleCode: string, input: SendNotificationInput): Promise<void> {
    const members = await tx.employee.findMany({ where: { role: { roleCode }, employeeStatus: 'ACTIVE' }, select: { id: true } });
    await this.toEmployees(tx, members.map((m) => m.id), input);
  }
}
