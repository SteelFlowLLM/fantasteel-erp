import { Injectable } from '@nestjs/common';
import { DRAFT_STATUS, INSPECTION_RESULT, PERMISSION_LEVEL, SALES_ORDER_ITEM_STATUS, type Permission } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** 아직 처리되지 않은 초안 상태 (ERD 부분 unique action_draft_open_agent_target_key와 같은 목록). 같은 대상의 미처리 초안은 하나만 둔다 (REQ-AGT-005) */
export const OPEN_DRAFT_STATUSES = [DRAFT_STATUS.AI_GENERATED, DRAFT_STATUS.WAITING_APPROVAL, DRAFT_STATUS.APPROVED];

const draftSelect = {
  id: true,
  actionType: true,
  draftStatus: true,
  payload: true,
  requesterId: true,
  confirmedAt: true,
  rejectReason: true,
  executionErrorCode: true,
  executionAttemptCount: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { employeeName: true } },
  purchaseRequisition: { select: { id: true, purchaseRequisitionNo: true } },
} satisfies Prisma.ActionDraftSelect;

export type AgentDraftRow = Prisma.ActionDraftGetPayload<{ select: typeof draftSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class FactoryAgentRepository {
  /** payload.agent.targetKey가 같은 미처리 초안 */
  findOpenDraftByTarget(tx: Tx, targetKey: string) {
    return tx.actionDraft.findFirst({
      where: { messageId: null, draftStatus: { in: OPEN_DRAFT_STATUSES }, payload: { path: ['agent', 'targetKey'], equals: targetKey } },
      select: { id: true },
    });
  }

  /**
   * 같은 대상의 미처리 후보가 DB 부분 unique에 걸리면 만들지 않고 null을 돌려준다 (ON CONFLICT DO NOTHING).
   * 충돌에서 오류를 내면 Postgres가 트랜잭션을 중단시켜 같은 tx의 나머지 일을 할 수 없어서 이렇게 한다.
   */
  async createDraftIfNew(tx: Tx, data: { actionType: string; payload: Prisma.InputJsonValue }): Promise<AgentDraftRow | null> {
    // createManyAndReturn은 관계 칸을 고를 수 없어 id만 받아 다시 읽는다
    const [created] = await tx.actionDraft.createManyAndReturn({ data: [data], skipDuplicates: true, select: { id: true } });
    return created ? this.findDraft(tx, created.id) : null;
  }

  findDraft(tx: Tx, id: number) {
    return tx.actionDraft.findUnique({ where: { id }, select: draftSelect });
  }

  /** Agent가 만든 초안은 메시지가 없다 (메시지 초안과 구분). 최근 것 먼저 */
  findAgentDrafts(tx: Tx) {
    return tx.actionDraft.findMany({ where: { messageId: null }, orderBy: { id: 'desc' }, select: draftSelect });
  }

  update(tx: Tx, id: number, data: Prisma.ActionDraftUpdateInput) {
    return tx.actionDraft.update({ where: { id }, data, select: draftSelect });
  }

  /** 읽은 뒤 아무도 고치지 않았을 때만 바꾼다. 바꿨으면 true */
  async updateIfUnchanged(tx: Tx, id: number, readUpdatedAt: Date, data: Prisma.ActionDraftUncheckedUpdateManyInput): Promise<boolean> {
    const { count } = await tx.actionDraft.updateMany({ where: { id, updatedAt: readUpdatedAt }, data });
    return count === 1;
  }

  /** 검사한 LOT이 속한 계획의 수주 품목 (이벤트 트리거가 합격 매수 부족을 볼 대상) */
  findSalesOrderItemOfLot(tx: Tx, lotId: number) {
    return tx.lot.findUnique({ where: { id: lotId }, select: { productionResult: { select: { productionPlan: { select: { salesOrderItemId: true } } } } } });
  }

  /** 이미 구매요청이 있으면 후보를 만들지 않는 판단에 쓰는 원료 품목 */
  findItem(tx: Tx, id: number) {
    return tx.item.findUnique({ where: { id }, select: { id: true, itemCode: true, itemName: true } });
  }

  // ── 납기 위험·불합격률·여재 (REQ-AGT-004) ───────────────

  /** 납기일이 until 이하인 진행 중 수주 품목 (출하 매수는 서비스가 재생산 판단값으로 본다) */
  findOpenSalesOrderItemsDueUntil(tx: Tx, until: Date) {
    return tx.salesOrderItem.findMany({
      where: { salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] }, dueDate: { lte: until } },
      select: { id: true, salesOrderId: true, dueDate: true, salesOrder: { select: { salesOrderNo: true, ownerEmployeeId: true, salesOrderItems: { select: { id: true }, orderBy: { id: 'asc' } } } } },
      orderBy: { id: 'asc' },
    });
  }

  /** 같은 규격의 진행 중 수주 품목 (여재 대기 수주 후보) */
  findOpenSalesOrderItemsOfItem(tx: Tx, itemId: number) {
    return tx.salesOrderItem.findMany({
      where: { itemId, salesOrderItemStatus: { in: [SALES_ORDER_ITEM_STATUS.OPEN, SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED] } },
      select: { id: true, dueDate: true, salesOrder: { select: { salesOrderNo: true, salesOrderItems: { select: { id: true }, orderBy: { id: 'asc' } } } } },
      orderBy: { id: 'asc' },
    });
  }

  findProductionSetting(tx: Tx) {
    return tx.productionSetting.findFirst({ select: { deliveryRiskDays: true }, orderBy: { id: 'asc' } });
  }

  /** since 이후 합격·불합격 판정 검사의 강종 (히트는 LOT 강종, 슬래브·코일은 품목 강종) */
  findJudgedInspectionsSince(tx: Tx, since: Date) {
    return tx.qualityInspection.findMany({
      where: { inspectedAt: { gte: since }, inspectionResult: { in: [INSPECTION_RESULT.PASS, INSPECTION_RESULT.FAIL] } },
      select: { inspectionResult: true, lot: { select: { steelGrade: { select: { steelGradeCode: true } }, item: { select: { steelGrade: { select: { steelGradeCode: true } } } } } } },
    });
  }

  /** 그 기능의 사용(USE) 권한이 있는 재직 사원 (후보 확정 권한자, REQ-AGT-006) */
  async findActiveEmployeeIdsWithPermission(tx: Tx, permission: Permission): Promise<number[]> {
    const rows = await tx.employee.findMany({
      where: { isActive: true, role: { rolePermissions: { some: { permission, permissionLevel: PERMISSION_LEVEL.USE } } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  findDepartmentIdByCode(tx: Tx, departmentCode: string) {
    return tx.department.findUnique({ where: { departmentCode }, select: { id: true } });
  }

  /** 받는 사람이 아직 읽지 않은 같은 알림이 있는지 (같은 위험을 매 주기마다 다시 보내지 않는다). 유형은 여러 개를 함께 본다 */
  async hasUnreadSameNotification(tx: Tx, recipientId: number, notificationTypes: readonly string[], notificationContent: string): Promise<boolean> {
    return (await tx.notification.count({ where: { recipientId, notificationType: { in: [...notificationTypes] }, notificationContent, readAt: null } })) > 0;
  }
}
