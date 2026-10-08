import { Injectable } from '@nestjs/common';
import {
  PERMISSION,
  type DepartmentMemberView,
  type DepartmentNode,
  type DepartmentView,
  type EmployeeView,
  type JobGradeView,
  type PageResult,
  type Permission,
  type PermissionLevel,
  type Role,
  type RoleView,
} from '@fantasteel/shared';
import { hash } from 'bcryptjs';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import type { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import type { CreateJobGradeDto, UpdateJobGradeDto } from './dto/job-grade.dto';
import type { ListEmployeesQuery } from './dto/list-employees.query';
import type { UpdateRolePermissionsDto } from './dto/role-permission.dto';
import { OrganizationRepository } from './organization.repository';

const DEFAULT_PAGE_SIZE = 20;
/** 시드(prisma/seed.ts)와 같은 bcrypt 강도 */
const BCRYPT_ROUNDS = 10;
const PERMISSION_ORDER: readonly string[] = Object.values(PERMISSION);

type EmployeeRow = Awaited<ReturnType<OrganizationRepository['findEmployees']>>[number];
type DepartmentRow = Awaited<ReturnType<OrganizationRepository['findDepartments']>>[number];
type JobGradeRow = Awaited<ReturnType<OrganizationRepository['findJobGrades']>>[number];
type RoleRow = Awaited<ReturnType<OrganizationRepository['findRoles']>>[number];

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

  /** API-156. 사원번호가 겹치면 unique 위반을 전역 필터가 COM-001로 바꾼다 (organization.md 5장 🟡) */
  async createEmployee(dto: CreateEmployeeDto): Promise<EmployeeView> {
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    const { id } = await this.prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, dto);
      return this.repository.createEmployee(tx, {
        employeeNo: dto.employeeNo,
        employeeName: dto.employeeName,
        passwordHash,
        departmentId: dto.departmentId,
        jobGradeId: dto.jobGradeId,
        roleId: dto.roleId,
      });
    });
    return this.employeeView(id);
  }

  /** API-157. 부서장은 사용 중인 사원이어야 하므로 부서장인 사원은 퇴사 처리 전에 부서장을 먼저 바꾼다 */
  async updateEmployee(id: number, dto: UpdateEmployeeDto): Promise<EmployeeView> {
    await this.prisma.$transaction(async (tx) => {
      const employee = await this.repository.findEmployeeHeadships(tx, id);
      if (!employee) throw new AppException('COM-003', '사원을 찾을 수 없어요');
      await this.assertReferences(tx, dto);
      if (dto.isActive === false && employee.departmentsAsHeadEmployee.length > 0) {
        throw new AppException('COM-004', '부서장인 사원은 퇴사 처리할 수 없어요. 부서장을 먼저 바꿔 주세요');
      }
      await this.repository.updateEmployee(tx, id, {
        employeeName: dto.employeeName,
        departmentId: dto.departmentId,
        jobGradeId: dto.jobGradeId,
        roleId: dto.roleId,
        isActive: dto.isActive,
      });
    });
    return this.employeeView(id);
  }

  private async employeeView(id: number): Promise<EmployeeView> {
    const row = await this.repository.findEmployee(this.prisma, id);
    if (!row) throw new AppException('COM-003', '사원을 찾을 수 없어요');
    return toEmployeeView(row);
  }

  /** API-162 */
  async createJobGrade(dto: CreateJobGradeDto): Promise<JobGradeView> {
    const row = await this.repository.createJobGrade(this.prisma, { jobGradeName: dto.jobGradeName, sortOrder: dto.sortOrder });
    return toJobGradeView(row);
  }

  /** API-272 */
  async updateJobGrade(id: number, dto: UpdateJobGradeDto): Promise<JobGradeView> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.repository.findJobGrade(tx, id))) throw new AppException('COM-003', '직급을 찾을 수 없어요');
      await this.repository.updateJobGrade(tx, id, { jobGradeName: dto.jobGradeName, sortOrder: dto.sortOrder });
    });
    return this.jobGradeView(id);
  }

  /** API-273. 기준정보는 참조가 없을 때만 지운다 (컨벤션 7-2). 퇴사자도 직급을 참조하므로 함께 센다 */
  async deleteJobGrade(id: number): Promise<JobGradeView> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.repository.findJobGrade(tx, id);
      if (!row) throw new AppException('COM-003', '직급을 찾을 수 없어요');
      if ((await this.repository.countEmployeesOfJobGrade(tx, id)) > 0) throw new AppException('COM-004', '이 직급을 쓰는 사원(퇴사자 포함)이 있어 삭제할 수 없어요');
      await this.repository.deleteJobGrade(tx, id);
      return toJobGradeView(row);
    });
  }

  private async jobGradeView(id: number): Promise<JobGradeView> {
    const row = await this.repository.findJobGrade(this.prisma, id);
    if (!row) throw new AppException('COM-003', '직급을 찾을 수 없어요');
    return toJobGradeView(row);
  }

  /** 요청으로 받은 부서·직급·역할 id는 조회해서 확인한다 (컨벤션 7-2) */
  private async assertReferences(tx: Tx, ref: { departmentId?: number; jobGradeId?: number; roleId?: number }) {
    const found = await this.repository.findReferences(tx, ref);
    if (ref.departmentId !== undefined && !found.department) throw new AppException('COM-003', '부서를 찾을 수 없어요');
    if (ref.jobGradeId !== undefined && !found.jobGrade) throw new AppException('COM-003', '직급을 찾을 수 없어요');
    if (ref.roleId !== undefined && !found.role) throw new AppException('COM-003', '역할을 찾을 수 없어요');
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

  /** 부서 알림 대상: 그 부서의 재직 중 사원 (하위 부서 제외, 2026-10-07 사용자 결정). notification이 같은 tx에서 부른다 */
  async findActiveMemberIds(tx: Tx, departmentId: number): Promise<number[]> {
    return (await this.repository.findActiveMemberIdsOf(tx, departmentId)).map((e) => e.id);
  }

  async listJobGrades(): Promise<JobGradeView[]> {
    const rows = await this.repository.findJobGrades(this.prisma);
    return rows.map(toJobGradeView);
  }

  async listRoles(): Promise<RoleView[]> {
    const rows = await this.repository.findRoles(this.prisma);
    return rows.map(toRoleView);
  }

  /** API-159. 부서코드가 겹치면 unique 위반을 전역 필터가 COM-001로 바꾼다 (organization.md 5장 🟡) */
  async createDepartment(dto: CreateDepartmentDto): Promise<DepartmentView> {
    const parentId = dto.parentId ?? null;
    const { id } = await this.prisma.$transaction(async (tx) => {
      if (parentId !== null && !(await this.repository.findDepartment(tx, parentId))) throw new AppException('COM-003', '상위 부서를 찾을 수 없어요');
      return this.repository.createDepartment(tx, { departmentCode: dto.departmentCode, departmentName: dto.departmentName, parentId });
    });
    return this.departmentView(id);
  }

  /** API-160. 상위 부서 변경은 계층 순환을 막고(BP-AUTH-01), 부서장은 사용 중인 사원만 지정한다 (organization.md 8장) */
  async updateDepartment(id: number, dto: UpdateDepartmentDto): Promise<DepartmentView> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.repository.findDepartment(tx, id))) throw new AppException('COM-003', '부서를 찾을 수 없어요');
      if (dto.parentId !== undefined && dto.parentId !== null) await this.assertParentAllowed(tx, id, dto.parentId);
      if (dto.headEmployeeId !== undefined && dto.headEmployeeId !== null) {
        const head = await this.repository.findEmployeeStatus(tx, dto.headEmployeeId);
        if (!head) throw new AppException('COM-003', '부서장으로 지정할 사원을 찾을 수 없어요');
        if (!head.isActive) throw new AppException('COM-004', '퇴사한 사원은 부서장으로 지정할 수 없어요');
      }
      await this.repository.updateDepartment(tx, id, { departmentName: dto.departmentName, parentId: dto.parentId, headEmployeeId: dto.headEmployeeId });
    });
    return this.departmentView(id);
  }

  /** API-271. 하위 부서나 소속 사원(퇴사자 포함)이 있으면 지우지 않는다 (컨벤션 7-2). 부서장은 다른 부서 사원일 수 있어 따로 막지 않는다 */
  async deleteDepartment(id: number): Promise<DepartmentView> {
    const view = await this.departmentView(id);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.repository.findDepartment(tx, id))) throw new AppException('COM-003', '부서를 찾을 수 없어요');
      const refs = await this.repository.countDepartmentReferences(tx, id);
      if (refs.children > 0) throw new AppException('COM-004', '하위 부서가 있는 부서는 삭제할 수 없어요');
      if (refs.employees > 0) throw new AppException('COM-004', '소속 사원(퇴사자 포함)이 있는 부서는 삭제할 수 없어요');
      await this.repository.deleteDepartment(tx, id);
    });
    return view;
  }

  /** API-164. 같은 권한을 두 번 보내면 어느 수준인지 알 수 없어 거부한다 */
  async updateRolePermissions(roleId: number, dto: UpdateRolePermissionsDto): Promise<RoleView> {
    const permissions = dto.permissions.map((p) => p.permission);
    if (new Set(permissions).size !== permissions.length) throw new AppException('COM-004', '같은 권한을 두 번 넣었어요');
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.repository.findRole(tx, roleId))) throw new AppException('COM-003', '역할을 찾을 수 없어요');
      await this.repository.replaceRolePermissions(tx, roleId, dto.permissions);
    });
    const row = await this.repository.findRole(this.prisma, roleId);
    if (!row) throw new AppException('COM-003', '역할을 찾을 수 없어요');
    return toRoleView(row);
  }

  /** 새 상위 부서에서 위로 올라가며 자기 자신이 나오면 순환이다 (자기 자신을 상위로 지정 포함) */
  private async assertParentAllowed(tx: Tx, id: number, parentId: number) {
    const links = new Map((await this.repository.findDepartmentLinks(tx)).map((d) => [d.id, d.parentId]));
    if (!links.has(parentId)) throw new AppException('COM-003', '상위 부서를 찾을 수 없어요');
    const seen = new Set<number>();
    for (let cur: number | null | undefined = parentId; cur != null && !seen.has(cur); cur = links.get(cur)) {
      if (cur === id) throw new AppException('COM-004', '자기 자신이나 하위 부서를 상위 부서로 지정할 수 없어요');
      seen.add(cur);
    }
  }

  private async departmentView(id: number): Promise<DepartmentView> {
    const row = await this.repository.findDepartment(this.prisma, id);
    if (!row) throw new AppException('COM-003', '부서를 찾을 수 없어요');
    return {
      id: row.id,
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      parentId: row.parentId,
      headEmployeeId: row.headEmployeeId,
      headEmployeeName: row.headEmployee?.employeeName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function toRoleView(row: RoleRow): RoleView {
  return {
    id: row.id,
    roleCode: row.roleCode as Role,
    roleName: row.roleName,
    permissions: [...row.rolePermissions]
      .sort((a, b) => PERMISSION_ORDER.indexOf(a.permission) - PERMISSION_ORDER.indexOf(b.permission))
      .map((p) => ({ permission: p.permission as Permission, permissionLevel: p.permissionLevel as PermissionLevel })),
    employeeCount: row._count.employees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toJobGradeView(row: JobGradeRow): JobGradeView {
  return {
    id: row.id,
    jobGradeName: row.jobGradeName,
    sortOrder: row.sortOrder,
    employeeCount: row._count.employees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
