import { Injectable } from '@nestjs/common';
import {
  PERMISSION,
  type DepartmentMemberView,
  type DepartmentNode,
  type EmployeeView,
  type JobGradeView,
  type PageResult,
  type Permission,
  type PermissionLevel,
  type Role,
  type RoleView,
} from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListEmployeesQuery } from './dto/list-employees.query';
import { OrganizationRepository } from './organization.repository';

const DEFAULT_PAGE_SIZE = 20;
const PERMISSION_ORDER: readonly string[] = Object.values(PERMISSION);

type EmployeeRow = Awaited<ReturnType<OrganizationRepository['findEmployees']>>[number];
type DepartmentRow = Awaited<ReturnType<OrganizationRepository['findDepartments']>>[number];

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 조직 변경에 맞는 BUSINESS_EVENT_TYPE이 없어 작업 로그는 남기지 않는다 (organization.md 5장).
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: OrganizationRepository,
  ) {}

  async listEmployees(query: ListEmployeesQuery): Promise<PageResult<EmployeeView>> {
    const filter = { departmentId: query.departmentId, roleCode: query.roleCode, isActive: query.isActive, keyword: query.keyword?.trim() || undefined };
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.repository.countEmployees(this.prisma, filter),
      this.repository.findEmployees(this.prisma, filter, { skip: (page - 1) * size, take: size }),
    ]);
    return { items: rows.map(toEmployeeView), page, size, total };
  }

  /** 부서 트리와 부서별 인원 (REQ-ORG-001·003). 최상위 부서부터 부서코드 순 */
  async listDepartments(): Promise<DepartmentNode[]> {
    const [departments, members] = await Promise.all([this.repository.findDepartments(this.prisma), this.repository.findActiveMembers(this.prisma)]);
    const membersOf = new Map<number, DepartmentMemberView[]>();
    const headOf = new Map(departments.map((d) => [d.id, d.headEmployeeId]));
    for (const m of members) {
      const list = membersOf.get(m.departmentId) ?? [];
      list.push({ id: m.id, employeeNo: m.employeeNo, employeeName: m.employeeName, jobGradeId: m.jobGradeId, jobGradeName: m.jobGrade.jobGradeName, isHead: headOf.get(m.departmentId) === m.id });
      membersOf.set(m.departmentId, list);
    }
    const childrenOf = new Map<number | null, DepartmentRow[]>();
    for (const d of departments) childrenOf.set(d.parentId, [...(childrenOf.get(d.parentId) ?? []), d]);
    // 순환은 등록·수정 때 막지만, 데이터가 꼬여 있어도 조회가 멈추지 않게 지나간 부서는 다시 펼치지 않는다
    const visited = new Set<number>();
    const build = (parentId: number | null): DepartmentNode[] =>
      (childrenOf.get(parentId) ?? [])
        .filter((d) => {
          if (visited.has(d.id)) return false;
          visited.add(d.id);
          return true;
        })
        .map((d) => ({
          id: d.id,
          departmentCode: d.departmentCode,
          departmentName: d.departmentName,
          parentId: d.parentId,
          headEmployeeId: d.headEmployeeId,
          headEmployeeName: d.headEmployee?.employeeName ?? null,
          members: membersOf.get(d.id) ?? [],
          children: build(d.id),
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        }));
    return build(null);
  }

  async listJobGrades(): Promise<JobGradeView[]> {
    const rows = await this.repository.findJobGrades(this.prisma);
    return rows.map((r) => ({
      id: r.id,
      jobGradeName: r.jobGradeName,
      sortOrder: r.sortOrder,
      employeeCount: r._count.employees,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listRoles(): Promise<RoleView[]> {
    const rows = await this.repository.findRoles(this.prisma);
    return rows.map((r) => ({
      id: r.id,
      roleCode: r.roleCode as Role,
      roleName: r.roleName,
      permissions: [...r.rolePermissions]
        .sort((a, b) => PERMISSION_ORDER.indexOf(a.permission) - PERMISSION_ORDER.indexOf(b.permission))
        .map((p) => ({ permission: p.permission as Permission, permissionLevel: p.permissionLevel as PermissionLevel })),
      employeeCount: r._count.employees,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}

function toEmployeeView(row: EmployeeRow): EmployeeView {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    employeeName: row.employeeName,
    departmentId: row.departmentId,
    departmentName: row.department.departmentName,
    jobGradeId: row.jobGradeId,
    jobGradeName: row.jobGrade.jobGradeName,
    roleId: row.roleId,
    roleCode: row.role.roleCode as Role,
    roleName: row.role.roleName,
    isActive: row.isActive,
    headDepartmentIds: row.departmentsAsHeadEmployee.map((d) => d.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
