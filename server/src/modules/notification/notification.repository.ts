import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const notificationSelect = {
  id: true,
  notificationType: true,
  title: true,
  body: true,
  linkPath: true,
  departmentId: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

@Injectable()
export class NotificationRepository {
  /** 최신순(id 내림차순). take는 호출한 쪽이 다음 페이지 확인용으로 1 더 요청한다. */
  listMine(tx: Tx, recipientId: number, opts: { unreadOnly: boolean; cursor?: number; take: number }): Promise<NotificationRow[]> {
    return tx.notification.findMany({
      where: { recipientId, isRead: opts.unreadOnly ? false : undefined, id: opts.cursor ? { lt: opts.cursor } : undefined },
      select: notificationSelect,
      orderBy: { id: 'desc' },
      take: opts.take,
    });
  }

  countUnread(tx: Tx, recipientId: number): Promise<number> {
    return tx.notification.count({ where: { recipientId, isRead: false } });
  }

  /** 내 알림만 읽음 처리한다. 이미 읽은 것은 그대로 (읽은 시각 유지). 바꾼 개수를 돌려준다. */
  async markRead(tx: Tx, recipientId: number, id: number): Promise<number> {
    const r = await tx.notification.updateMany({ where: { id, recipientId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return r.count;
  }

  async markAllRead(tx: Tx, recipientId: number): Promise<number> {
    const r = await tx.notification.updateMany({ where: { recipientId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return r.count;
  }

  findMine(tx: Tx, recipientId: number, id: number): Promise<NotificationRow | null> {
    return tx.notification.findFirst({ where: { id, recipientId }, select: notificationSelect });
  }
}
