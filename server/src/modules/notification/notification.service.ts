import { Injectable } from '@nestjs/common';
import type { AuthUser, NotificationPage, NotificationReadAllResult, NotificationType, NotificationView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Notification } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { OrganizationService } from '../organization/organization.service';
import type { ListNotificationsQuery } from './dto/notification.dto';
import { NotificationRepository } from './notification.repository';

const DEFAULT_PAGE_SIZE = 20;

/** 알림 내용 (받는 사람 빼고). 메시지·작업 로그로 만든 알림은 그 id로 중복을 막는다 */
export interface NotificationInput {
  notificationType: NotificationType;
  notificationContent: string;
  linkPath?: string | null;
  messageId?: number | null;
  businessEventId?: number | null;
}

function toView(row: Notification): NotificationView {
  return {
    id: row.id,
    notificationType: row.notificationType as NotificationType,
    notificationContent: row.notificationContent,
    linkPath: row.linkPath,
    messageId: row.messageId,
    businessEventId: row.businessEventId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 알림 (REQ-NTF-002). 발송은 API가 아니라 다른 모듈이 본 거래와 같은 tx에서 부르는 함수다 (notifyEmployees·notifyDepartment).
 * 읽음 처리 API는 명세에 없어 임시로 둔다 (2026-10-07 사용자 결정, notification.md 8장).
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotificationRepository,
    private readonly organization: OrganizationService,
  ) {}

  /** 개인 알림. 받는 사람마다 한 행, 같은 메시지·작업 로그로 같은 사람에게 다시 보내면 건너뛴다. 만든 행 수를 돌려준다 */
  async notifyEmployees(tx: Tx, recipientIds: readonly number[], input: NotificationInput): Promise<number> {
    const rows = [...new Set(recipientIds)].map((recipientId) => ({ ...input, recipientId }));
    if (rows.length === 0) return 0;
    return (await this.repository.createNotifications(tx, rows)).count;
  }

  /** 부서 알림: 그 부서의 재직 중 사원별 행으로 펼친다 ([ERD] notification Note, REQ-ORG-004) */
  async notifyDepartment(tx: Tx, departmentId: number, input: NotificationInput): Promise<number> {
    return this.notifyEmployees(tx, await this.organization.findActiveMemberIds(tx, departmentId), input);
  }

  /** API-242. 내 알림만, 최신순 */
  async list(user: AuthUser, query: ListNotificationsQuery): Promise<NotificationPage> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const unreadOnly = query.unreadOnly ?? false;
    const [total, unreadCount, rows] = await Promise.all([
      this.repository.countNotifications(this.prisma, user.employeeId, unreadOnly),
      this.repository.countNotifications(this.prisma, user.employeeId, true),
      this.repository.findNotifications(this.prisma, user.employeeId, unreadOnly, { skip: (page - 1) * size, take: size }),
    ]);
    return { items: rows.map(toView), page, size, total, unreadCount };
  }

  /** 읽음 처리. 이미 읽은 알림은 그대로 돌려준다. 다른 사람의 알림이면 COM-002 */
  async read(user: AuthUser, id: number): Promise<NotificationView> {
    const found = await this.repository.findNotification(this.prisma, id);
    if (!found) throw new AppException('COM-003', '알림을 찾을 수 없어요');
    if (found.recipientId !== user.employeeId) throw new AppException('COM-002', '내 알림만 읽음으로 바꿀 수 있어요');
    await this.repository.markRead(this.prisma, { id, recipientId: user.employeeId }, new Date());
    return toView((await this.repository.findNotification(this.prisma, id)) ?? found);
  }

  async readAll(user: AuthUser): Promise<NotificationReadAllResult> {
    const { count } = await this.repository.markRead(this.prisma, { recipientId: user.employeeId }, new Date());
    return { readCount: count };
  }
}
