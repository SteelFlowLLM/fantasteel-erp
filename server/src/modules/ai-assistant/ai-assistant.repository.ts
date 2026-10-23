import { Injectable } from '@nestjs/common';
import { ITEM_TYPE, type Permission, type Role } from '@fantasteel/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class AiAssistantRepository {
  /**
   * 권한 밖 요청에 담당 역할을 안내할 때 쓴다 (REQ-AST-009). 권한이 없으면 행이 없으므로 행이 있는 역할 = VIEW 이상.
   * 역할은 따로 읽는다 (Prisma 7 중첩 select를 여러 행에 걸쳐 읽으면 실패할 수 있다, lot.md 구현 메모)
   */
  async findRoleCodesWithAnyPermission(tx: Tx, permissions: readonly Permission[]): Promise<Role[]> {
    if (permissions.length === 0) return [];
    const rows = await tx.rolePermission.findMany({ where: { permission: { in: [...permissions] } }, select: { roleId: true } });
    const roles = await tx.role.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.roleId))] } }, select: { roleCode: true }, orderBy: { id: 'asc' } });
    return roles.map((role) => role.roleCode as Role);
  }

  /** 실행 카드의 담당자·참석자 이름을 사원 id로 맞출 때 (사용 중인 사원만) */
  findActiveEmployees(tx: Tx) {
    return tx.employee.findMany({ where: { isActive: true }, select: { id: true, employeeName: true }, orderBy: { id: 'asc' } });
  }

  findActiveEmployeeIds(tx: Tx, ids: number[]) {
    return tx.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  }

  /** 구매요청 카드의 원료 품목 이름을 id로 맞출 때 */
  findRawMaterials(tx: Tx) {
    return tx.item.findMany({ where: { itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true, itemCode: true, itemName: true }, orderBy: { itemCode: 'asc' } });
  }

  findRawMaterialIds(tx: Tx, ids: number[]) {
    return tx.item.findMany({ where: { id: { in: ids }, itemType: ITEM_TYPE.RAW_MATERIAL }, select: { id: true } });
  }

  /** 수주 카드의 고객사 이름을 id로 맞출 때 */
  findCustomers(tx: Tx) {
    return tx.customer.findMany({ select: { id: true, customerCode: true, customerName: true }, orderBy: { id: 'asc' } });
  }

  /** 수주 카드의 규격(슬래브·코일)을 id로 맞출 때 */
  findProducts(tx: Tx) {
    return tx.item.findMany({ where: { itemType: { in: [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] } }, select: { id: true, itemCode: true, itemName: true }, orderBy: { itemCode: 'asc' } });
  }

  findProductionPlanByNo(tx: Tx, productionPlanNo: string) {
    return tx.productionPlan.findUnique({ where: { productionPlanNo }, select: { id: true } });
  }

  findLotByNo(tx: Tx, lotNo: string) {
    return tx.lot.findUnique({ where: { lotNo }, select: { id: true } });
  }

  createScheduleEvent(tx: Tx, data: Omit<Prisma.ScheduleEventUncheckedCreateInput, 'attendees'>, attendeeIds: number[]) {
    return tx.scheduleEvent.create({ data: { ...data, attendees: { create: attendeeIds.map((employeeId) => ({ employeeId })) } }, select: { id: true } });
  }

  /** 일정 고치기 카드를 만들 때 지금 값과 고칠 수 있는지(등록자·참석자·회의록 일정)를 본다 */
  findScheduleEventForCard(tx: Tx, id: number) {
    return tx.scheduleEvent.findUnique({
      where: { id },
      select: { id: true, scheduleEventTitle: true, scheduleEventDescription: true, startAt: true, endAt: true, creatorId: true, meetingMinutesId: true, attendees: { select: { employeeId: true } } },
    });
  }

  /** 업무 고치기 카드를 만들 때 지금 값과 고칠 수 있는지(등록자·담당자·상태)를 본다 */
  findTaskForCard(tx: Tx, id: number) {
    return tx.task.findUnique({ where: { id }, select: { id: true, taskTitle: true, taskDescription: true, dueDate: true, taskStatus: true, creatorId: true, assigneeId: true } });
  }
}
