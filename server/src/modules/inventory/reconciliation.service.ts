import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_TYPE, RECONCILIATION_STATUS, ROLE, type AuthUser, type ReservationReconciliationRow, type ReservationReconciliationView } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { reconciliationRows, type InventoryQtyRow } from './reconciliation.calculator';
import { ReconciliationRepository } from './reconciliation.repository';

/**
 * 🟡 알림 유형: 공통 코드에 보정 알림 유형이 없어 Factory Agent처럼 "업무 지정"을 쓴다 (2026-10-19 사용자 결정, inventory.md 9장).
 * 작업 로그 유형도 없어 보정 전·후 매수는 결과와 서버 로그에만 남긴다.
 */
const ALERT_NOTIFICATION_TYPE = NOTIFICATION_TYPE.TASK_ASSIGNED;
const INVENTORY_PATH = '/inventories';

/**
 * 예약 정합성 보정 (REQ-INV-010, BP-INV-02 P2, TRM-062): ACTIVE 예약 매수 합계와 inventory.reserved_qty를 비교해 재고 쪽을 맞춘다.
 * 예약은 지우지 않고, 실시간 동시성 통제를 대신하지 않는다. 점검은 모든 사원, 보정은 관리자(2026-10-19 사용자 결정)와 주기 실행(SYSTEM)이 한다.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReconciliationRepository,
    private readonly notification: NotificationService,
  ) {}

  /** 점검만: 아무것도 바꾸지 않는다 */
  async check(): Promise<ReservationReconciliationView> {
    const [inventories, sums] = await Promise.all([this.repository.findInventories(this.prisma), this.repository.sumActiveReservations(this.prisma)]);
    const rows = await this.rowsOf(this.prisma, inventories, sums);
    return view(rows, false);
  }

  /** 보정: 사람이 누르면 관리자만. user가 null이면 주기 실행(SYSTEM) */
  async reconcile(user: AuthUser | null): Promise<ReservationReconciliationView> {
    if (user && user.roleCode !== ROLE.ADMIN) throw new AppException('COM-002', '정합성 보정은 관리자만 실행할 수 있어요');
    const rows = await this.prisma.$transaction(async (tx) => {
      // 잠금 순서: inventory(item_id 순) → reservation (inventory.md 4장)
      const inventories = await this.repository.lockInventories(tx);
      const sums = await this.repository.sumActiveReservations(tx);
      const checked = await this.rowsOf(tx, inventories, sums);
      const result: ReservationReconciliationRow[] = [];
      for (const row of checked) {
        if (row.status !== RECONCILIATION_STATUS.MISMATCHED) {
          result.push(row);
          continue;
        }
        const ok = await this.repository.setReservedQty(tx, row.itemId, row.inventoryReservedQty ?? 0, row.activeReservedQty);
        result.push(ok ? { ...row, status: RECONCILIATION_STATUS.CORRECTED } : { ...row, status: RECONCILIATION_STATUS.UNFIXABLE, reason: '보정하는 사이 재고가 바뀌어 맞추지 못했어요. 다시 점검해 주세요' });
      }
      await this.notifyAdmins(tx, result);
      return result;
    });
    const fixed = rows.filter((r) => r.status === RECONCILIATION_STATUS.CORRECTED);
    const unfixable = rows.filter((r) => r.status === RECONCILIATION_STATUS.UNFIXABLE);
    const who = user ? `${user.employeeName}(${user.employeeNo})` : '주기 실행';
    if (fixed.length || unfixable.length) {
      this.logger.warn(
        `정합성 보정(${who}): 보정 ${fixed.length}건 [${fixed.map((r) => `${r.itemCode} ${r.inventoryReservedQty ?? 0}→${r.activeReservedQty}`).join(', ')}], 보정 불가 ${unfixable.length}건 [${unfixable.map((r) => r.itemCode).join(', ')}]`,
      );
    }
    return view(rows, true);
  }

  private async rowsOf(tx: Tx, inventories: InventoryQtyRow[], sums: Map<number, number>): Promise<ReservationReconciliationRow[]> {
    const items = await this.repository.findProductItems(tx, [...new Set([...inventories.map((r) => r.itemId), ...sums.keys()])]);
    return reconciliationRows(inventories, sums, items);
  }

  /** 보정했거나 보정할 수 없는 규격이 있으면 관리자에게 알린다 (본 보정과 같은 tx) */
  private async notifyAdmins(tx: Tx, rows: readonly ReservationReconciliationRow[]): Promise<void> {
    const content = alertContent(rows);
    if (!content) return;
    const admins = await this.repository.findActiveAdminIds(tx);
    if (admins.length === 0) return;
    const unread = await this.repository.findUnreadRecipients(tx, admins, ALERT_NOTIFICATION_TYPE, content);
    await this.notification.notifyEmployees(
      tx,
      admins.filter((id) => !unread.has(id)),
      { notificationType: ALERT_NOTIFICATION_TYPE, notificationContent: content, linkPath: INVENTORY_PATH },
    );
  }
}

/** 알림 문구 (알림 칸은 varchar라 앞 3개 규격만 적는다) */
export function alertContent(rows: readonly ReservationReconciliationRow[]): string | null {
  const fixed = rows.filter((r) => r.status === RECONCILIATION_STATUS.CORRECTED);
  const unfixable = rows.filter((r) => r.status === RECONCILIATION_STATUS.UNFIXABLE);
  if (!fixed.length && !unfixable.length) return null;
  const list = (items: readonly ReservationReconciliationRow[], text: (r: ReservationReconciliationRow) => string) =>
    `${items.slice(0, 3).map(text).join(', ')}${items.length > 3 ? ` 외 ${items.length - 3}개` : ''}`;
  return [
    '재고 정합성 보정:',
    fixed.length ? `예약 매수 ${fixed.length}개 규격을 맞췄어요 (${list(fixed, (r) => `${r.itemCode} ${r.inventoryReservedQty ?? 0}→${r.activeReservedQty}매`)}).` : null,
    unfixable.length ? `${unfixable.length}개 규격은 맞추지 못해 확인이 필요해요 (${list(unfixable, (r) => r.itemCode)}).` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function view(rows: readonly ReservationReconciliationRow[], applied: boolean): ReservationReconciliationView {
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    checkedAt: new Date().toISOString(),
    applied,
    checkedItemCount: rows.length,
    mismatchCount: rows.filter((r) => r.status !== RECONCILIATION_STATUS.MATCHED).length,
    correctedCount: count(RECONCILIATION_STATUS.CORRECTED),
    unfixableCount: count(RECONCILIATION_STATUS.UNFIXABLE),
    rows: rows.filter((r) => r.status !== RECONCILIATION_STATUS.MATCHED),
  };
}
