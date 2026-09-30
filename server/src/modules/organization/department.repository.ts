import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const departmentSelect = {
  id: true,
  departmentCode: true,
  departmentName: true,
  parentId: true,
  headEmployeeId: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  headEmployee: { select: { employeeName: true, jobGrade: true } },
  _count: { select: { employees: { where: { employeeStatus: 'ACTIVE' } } } },
} satisfies Prisma.DepartmentSelect;

export type DepartmentRow = Prisma.DepartmentGetPayload<{ select: typeof departmentSelect }>;

/** 승인권자 탐색용: 부서 + 부서장 상태 */
const departmentWithHeadSelect = {
  id: true,
  parentId: true,
  headEmployeeId: true,
  headEmployee: { select: { employeeStatus: true } },
} satisfies Prisma.DepartmentSelect;
export type DepartmentWithHead = Prisma.DepartmentGetPayload<{ select: typeof departmentWithHeadSelect }>;

@Injectable()
export class DepartmentRepository {
  list(tx: Tx): Promise<DepartmentRow[]> {
    return tx.department.findMany({ select: departmentSelect, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  findById(tx: Tx, id: number): Promise<DepartmentRow | null> {
    return tx.department.findUnique({ where: { id }, select: departmentSelect });
  }

  findByCode(tx: Tx, departmentCode: string) {
    return tx.department.findUnique({ where: { departmentCode }, select: { id: true } });
  }

  findWithHead(tx: Tx, id: number): Promise<DepartmentWithHead | null> {
    return tx.department.findUnique({ where: { id }, select: departmentWithHeadSelect });
  }

  /** 순환 검사용: 부서 id → 상위 부서 id */
  async parentMap(tx: Tx): Promise<Map<number, number | null>> {
    const rows = await tx.department.findMany({ select: { id: true, parentId: true } });
    return new Map(rows.map((r) => [r.id, r.parentId]));
  }

  create(tx: Tx, data: Prisma.DepartmentUncheckedCreateInput): Promise<DepartmentRow> {
    return tx.department.create({ data, select: departmentSelect });
  }

  update(tx: Tx, id: number, data: Prisma.DepartmentUncheckedUpdateInput): Promise<DepartmentRow> {
    return tx.department.update({ where: { id }, data, select: departmentSelect });
  }

  /** 조직도용: 부서별 ACTIVE 사원 */
  activeMembers(tx: Tx) {
    return tx.employee.findMany({
      where: { employeeStatus: 'ACTIVE' },
      select: { id: true, employeeNo: true, employeeName: true, jobGrade: true, departmentId: true, role: { select: { roleCode: true } } },
      orderBy: { employeeNo: 'asc' },
    });
  }
}
