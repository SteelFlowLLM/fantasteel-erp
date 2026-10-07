import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export interface EmployeeFilter {
  departmentId?: number;
  roleCode?: string;
  isActive?: boolean;
  keyword?: string;
}

const whereOf = (f: EmployeeFilter): Prisma.EmployeeWhereInput => ({
  departmentId: f.departmentId,
  role: f.roleCode ? { roleCode: f.roleCode } : undefined,
  isActive: f.isActive,
  OR: f.keyword ? [{ employeeName: { contains: f.keyword } }, { employeeNo: { contains: f.keyword } }] : undefined,
});

/** passwordHash는 고르지 않는다 (응답·로그에 내보내지 않음) */
const employeeSelect = {
  id: true,
  employeeNo: true,
  employeeName: true,
  departmentId: true,
  jobGradeId: true,
  roleId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { departmentName: true } },
  jobGrade: { select: { jobGradeName: true } },
  role: { select: { roleCode: true, roleName: true } },
  departmentsAsHeadEmployee: { select: { id: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.EmployeeSelect;

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class OrganizationRepository {
  countEmployees(tx: Tx, filter: EmployeeFilter) {
    return tx.employee.count({ where: whereOf(filter) });
  }

  findEmployees(tx: Tx, filter: EmployeeFilter, page: { skip: number; take: number }) {
    return tx.employee.findMany({
      where: whereOf(filter),
      select: employeeSelect,
      orderBy: [{ department: { departmentCode: 'asc' } }, { jobGrade: { sortOrder: 'asc' } }, { employeeNo: 'asc' }],
      skip: page.skip,
      take: page.take,
    });
  }

  findDepartments(tx: Tx) {
    return tx.department.findMany({ orderBy: { departmentCode: 'asc' }, include: { headEmployee: { select: { employeeName: true } } } });
  }

  /** 조직도 인원: 사용 중인 사원만 */
  findActiveMembers(tx: Tx) {
    return tx.employee.findMany({
      where: { isActive: true },
      select: { id: true, employeeNo: true, employeeName: true, departmentId: true, jobGradeId: true, jobGrade: { select: { jobGradeName: true } } },
      orderBy: [{ jobGrade: { sortOrder: 'asc' } }, { employeeNo: 'asc' }],
    });
  }

  findJobGrades(tx: Tx) {
    return tx.jobGrade.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { _count: { select: { employees: { where: { isActive: true } } } } } });
  }

  findRoles(tx: Tx) {
    return tx.role.findMany({
      orderBy: { id: 'asc' },
      include: { rolePermissions: { select: { permission: true, permissionLevel: true } }, _count: { select: { employees: { where: { isActive: true } } } } },
    });
  }
}
