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

const roleInclude = {
  rolePermissions: { select: { permission: true, permissionLevel: true } },
  _count: { select: { employees: { where: { isActive: true } } } },
} satisfies Prisma.RoleInclude;

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

  findEmployee(tx: Tx, id: number) {
    return tx.employee.findUnique({ where: { id }, select: employeeSelect });
  }

  /** 수정 전 확인용: 부서장인 부서만 */
  findEmployeeHeadships(tx: Tx, id: number) {
    return tx.employee.findUnique({ where: { id }, select: { id: true, departmentsAsHeadEmployee: { select: { id: true } } } });
  }

  // 관계를 함께 고르면 쿼리가 동시에 나가 트랜잭션 연결에서 겹치므로, 쓰기는 id만 돌려받고 응답은 커밋 뒤 findEmployee로 읽는다
  createEmployee(tx: Tx, data: Prisma.EmployeeUncheckedCreateInput) {
    return tx.employee.create({ data, select: { id: true } });
  }

  updateEmployee(tx: Tx, id: number, data: Prisma.EmployeeUncheckedUpdateInput) {
    return tx.employee.update({ where: { id }, data, select: { id: true } });
  }

  /** 참조 확인용 (COM-003). 트랜잭션은 연결 하나라 동시에 보내지 않고 차례로 읽는다 */
  async findReferences(tx: Tx, ref: { departmentId?: number; jobGradeId?: number; roleId?: number }) {
    const department = ref.departmentId === undefined ? null : await tx.department.findUnique({ where: { id: ref.departmentId }, select: { id: true } });
    const jobGrade = ref.jobGradeId === undefined ? null : await tx.jobGrade.findUnique({ where: { id: ref.jobGradeId }, select: { id: true } });
    const role = ref.roleId === undefined ? null : await tx.role.findUnique({ where: { id: ref.roleId }, select: { id: true } });
    return { department, jobGrade, role };
  }

  createJobGrade(tx: Tx, data: { jobGradeName: string; sortOrder: number }) {
    return tx.jobGrade.create({ data, include: { _count: { select: { employees: { where: { isActive: true } } } } } });
  }

  /** 순환 확인용: 부서마다 상위 부서 */
  findDepartmentLinks(tx: Tx) {
    return tx.department.findMany({ select: { id: true, parentId: true } });
  }

  findDepartment(tx: Tx, id: number) {
    return tx.department.findUnique({ where: { id }, include: { headEmployee: { select: { employeeName: true } } } });
  }

  createDepartment(tx: Tx, data: { departmentCode: string; departmentName: string; parentId: number | null }) {
    return tx.department.create({ data, select: { id: true } });
  }

  updateDepartment(tx: Tx, id: number, data: Prisma.DepartmentUncheckedUpdateInput) {
    return tx.department.update({ where: { id }, data, select: { id: true } });
  }

  /** 부서장 지정 확인용 */
  findEmployeeStatus(tx: Tx, id: number) {
    return tx.employee.findUnique({ where: { id }, select: { id: true, isActive: true } });
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
    return tx.role.findMany({ orderBy: { id: 'asc' }, include: roleInclude });
  }

  findRole(tx: Tx, id: number) {
    return tx.role.findUnique({ where: { id }, include: roleInclude });
  }

  /** 역할의 권한 행을 통째로 바꾼다 */
  async replaceRolePermissions(tx: Tx, roleId: number, permissions: { permission: string; permissionLevel: string }[]) {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: permissions.map((p) => ({ roleId, ...p })) });
  }
}
