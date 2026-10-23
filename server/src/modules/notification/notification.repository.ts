import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const whereOf = (recipientId: number, unreadOnly: boolean): Prisma.NotificationWhereInput => ({ recipientId, readAt: unreadOnly ? null : undefined });

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 */
@Injectable()
export class NotificationRepository {
  /** 부분 unique(메시지·작업 로그 + 받는 사람)에 걸리는 행은 건너뛴다 (중복 알림 방지, BP-MSG-01) */
  createNotifications(tx: Tx, rows: Prisma.NotificationCreateManyInput[]) {
    return tx.notification.createMany({ data: rows, skipDuplicates: true });
  }

  countNotifications(tx: Tx, recipientId: number, unreadOnly: boolean) {
    return tx.notification.count({ where: whereOf(recipientId, unreadOnly) });
  }

  findNotifications(tx: Tx, recipientId: number, unreadOnly: boolean, page: { skip: number; take: number }) {
    return tx.notification.findMany({ where: whereOf(recipientId, unreadOnly), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page });
  }

  findNotification(tx: Tx, id: number) {
    return tx.notification.findUnique({ where: { id } });
  }

  /** 안 읽은 것만 읽음으로 바꾼다. 이미 읽은 알림의 읽은 시각은 그대로 둔다 */
  markRead(tx: Tx, where: { id?: number; recipientId: number }, readAt: Date) {
    return tx.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt } });
  }
}
