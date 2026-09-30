import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/** passwordHash는 어떤 조회에도 넣지 않는다. */
export const employeeSelect = {
  id: true,
  employeeNo: true,
  employeeName: true,
  email: true,
  departmentId: true,
  roleId: true,
  jobGrade: true,
  employeeStatus: true,
  failedLoginCount: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { departmentName: true } },
  role: { select: { roleCode: true, roleName: true } },
  headDepartments: { select: { id: true } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

export interface EmployeeFilter {
  departmentId?: number;
  roleCode?: string;
  employeeStatus?: string;
  keyword?: string;
}

@Injectable()
export class EmployeeRepository {
  list(tx: Tx, filter: EmployeeFilter): Promise<EmployeeRow[]> {
    const keyword = filter.keyword?.trim();
    return tx.employee.findMany({
      where: {
        departmentId: filter.departmentId,
        role: filter.roleCode ? { roleCode: filter.roleCode } : undefined,
        employeeStatus: filter.employeeStatus,
        OR: keyword ? [{ employeeName: { contains: keyword, mode: 'insensitive' } }, { employeeNo: { contains: keyword } }] : undefined,
      },
      select: employeeSelect,
      orderBy: { employeeNo: 'asc' },
    });
  }

  findById(tx: Tx, id: number): Promise<EmployeeRow | null> {
    return tx.employee.findUnique({ where: { id }, select: employeeSelect });
  }

  findByEmployeeNo(tx: Tx, employeeNo: string) {
    return tx.employee.findUnique({ where: { employeeNo }, select: { id: true } });
  }

  /** 상태 검사만 필요할 때 쓰는 가벼운 조회 */
  findStatus(tx: Tx, id: number) {
    return tx.employee.findUnique({ where: { id }, select: { id: true, employeeStatus: true, employeeName: true, departmentId: true } });
  }

  create(tx: Tx, data: Prisma.EmployeeUncheckedCreateInput): Promise<EmployeeRow> {
    return tx.employee.create({ data, select: employeeSelect });
  }

  update(tx: Tx, id: number, data: Prisma.EmployeeUncheckedUpdateInput): Promise<EmployeeRow> {
    return tx.employee.update({ where: { id }, data, select: employeeSelect });
  }

  setPasswordHash(tx: Tx, id: number, passwordHash: string): Promise<EmployeeRow> {
    return tx.employee.update({ where: { id }, data: { passwordHash }, select: employeeSelect });
  }

  /** 메신저 멤버 선택·업무 담당자 지정용 가벼운 목록 (ACTIVE만). */
  directory(tx: Tx) {
    return tx.employee.findMany({
      where: { employeeStatus: 'ACTIVE' },
      select: {
        id: true,
        employeeNo: true,
        employeeName: true,
        departmentId: true,
        jobGrade: true,
        department: { select: { departmentName: true } },
        role: { select: { roleCode: true } },
        headDepartments: { select: { id: true } },
      },
      orderBy: [{ departmentId: 'asc' }, { employeeNo: 'asc' }],
    });
  }

  headDepartmentIds(tx: Tx, employeeId: number) {
    return tx.department.findMany({ where: { headEmployeeId: employeeId }, select: { id: true, departmentName: true } });
  }
}
