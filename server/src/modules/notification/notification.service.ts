import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationRepository, type NotificationRow } from './notification.repository';

const DEFAULT_LIMIT = 20;

export interface NotificationPage {
  items: NotificationRow[];
  /** 다음 페이지를 받을 때 cursor로 넘긴다. 더 없으면 null. */
  nextCursor: number | null;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async listMine(q: ListNotificationsDto, user: AuthUser): Promise<NotificationPage> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const rows = await this.notifications.listMine(this.prisma, user.employeeId, { unreadOnly: q.unreadOnly ?? false, cursor: q.cursor, take: limit + 1 });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    return { count: await this.notifications.countUnread(this.prisma, user.employeeId) };
  }

  /** 이미 읽은 알림을 다시 읽어도 성공 (멱등). 남의 알림·없는 알림은 404. */
  async markRead(id: number, user: AuthUser): Promise<NotificationRow> {
    return this.prisma.tx(async (tx) => {
      const changed = await this.notifications.markRead(tx, user.employeeId, id);
      const row = await this.notifications.findMine(tx, user.employeeId, id);
      if (!row) throw notFound('알림');
      // 같은 사원의 다른 화면(탭·기기)에서 안 읽은 수를 맞추도록 알린다
      if (changed) this.realtime.toEmployees([user.employeeId], 'notification-read', { id });
      return row;
    });
  }

  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    return this.prisma.tx(async (tx) => {
      const updated = await this.notifications.markAllRead(tx, user.employeeId);
      if (updated) this.realtime.toEmployees([user.employeeId], 'notification-read', { all: true });
      return { updated };
    });
  }
}
