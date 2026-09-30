import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EMPLOYEE_STATUS, type AuthUser } from '@fantasteel/shared';
import { badInput, forbidden, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { ListEmployeesDto } from './dto/list-employees.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import { DepartmentRepository } from './department.repository';
import { EmployeeRepository, type EmployeeRow } from './employee.repository';
import { RoleRepository } from './role.repository';

const BCRYPT_ROUNDS = 10;

export interface EmployeeView {
  id: number;
  employeeNo: string;
  employeeName: string;
  email: string | null;
  departmentId: number;
  departmentName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  jobGrade: string;
  employeeStatus: string;
  failedLoginCount: number;
  lastLoginAt: Date | null;
  isDepartmentHead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeDirectoryEntry {
  id: number;
  employeeNo: string;
  employeeName: string;
  departmentId: number;
  departmentName: string;
  jobGrade: string;
  roleCode: string;
  isDepartmentHead: boolean;
}

function toView(e: EmployeeRow): EmployeeView {
  return {
    id: e.id,
    employeeNo: e.employeeNo,
    employeeName: e.employeeName,
    email: e.email,
    departmentId: e.departmentId,
    departmentName: e.department.departmentName,
    roleId: e.roleId,
    roleCode: e.role.roleCode,
    roleName: e.role.roleName,
    jobGrade: e.jobGrade,
    employeeStatus: e.employeeStatus,
    failedLoginCount: e.failedLoginCount,
    lastLoginAt: e.lastLoginAt,
    isDepartmentHead: e.headDepartments.length > 0,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeeRepository,
    private readonly departments: DepartmentRepository,
    private readonly roles: RoleRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async list(q: ListEmployeesDto): Promise<EmployeeView[]> {
    return (await this.employees.list(this.prisma, q)).map(toView);
  }

  async get(id: number): Promise<EmployeeView> {
    const e = await this.employees.findById(this.prisma, id);
    if (!e) throw notFound('사원');
    return toView(e);
  }

  /** 로그인한 누구나 쓰는 가벼운 목록 (메신저 멤버 선택·업무 담당자 지정). 이메일·상태 같은 관리 정보는 없다. */
  async directory(): Promise<EmployeeDirectoryEntry[]> {
    const rows = await this.employees.directory(this.prisma);
    return rows.map((e) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      employeeName: e.employeeName,
      departmentId: e.departmentId,
      departmentName: e.department.departmentName,
      jobGrade: e.jobGrade,
      roleCode: e.role.roleCode,
      isDepartmentHead: e.headDepartments.length > 0,
    }));
  }

  async create(dto: CreateEmployeeDto): Promise<EmployeeView> {
    const passwordHash = await bcrypt.hash(dto.initialPassword, BCRYPT_ROUNDS);
    return this.prisma.tx(async (tx) => {
      if (await this.employees.findByEmployeeNo(tx, dto.employeeNo)) throw badInput('이미 사용 중인 사원번호입니다');
      if (!(await this.departments.findById(tx, dto.departmentId))) throw badInput('존재하지 않는 부서입니다');
      if (!(await this.roles.findById(tx, dto.roleId))) throw badInput('존재하지 않는 역할입니다');
      const row = await this.employees.create(tx, {
        employeeNo: dto.employeeNo,
        employeeName: dto.employeeName.trim(),
        passwordHash,
        email: dto.email ?? null,
        departmentId: dto.departmentId,
        roleId: dto.roleId,
        jobGrade: dto.jobGrade.trim(),
      });
      this.realtime.changed('employees', 'departments');
      return toView(row);
    });
  }

  async update(id: number, dto: UpdateEmployeeDto, user: AuthUser): Promise<EmployeeView> {
    return this.prisma.tx(async (tx) => {
      const current = await this.employees.findById(tx, id);
      if (!current) throw notFound('사원');

      const roleChanged = dto.roleId !== undefined && dto.roleId !== current.roleId;
      const deactivating = dto.employeeStatus === EMPLOYEE_STATUS.INACTIVE && current.employeeStatus !== EMPLOYEE_STATUS.INACTIVE;
      // 스스로 역할을 낮추거나 비활성화하면 관리자가 없어질 수 있다
      if (id === user.employeeId && (roleChanged || deactivating)) throw forbidden('본인의 역할과 사용 상태는 변경할 수 없습니다');
      if (deactivating) {
        const heads = await this.employees.headDepartmentIds(tx, id);
        if (heads.length) throw invalidState(`${heads.map((d) => d.departmentName).join(', ')}의 부서장입니다. 부서장을 먼저 바꿔 주세요`);
      }
      if (dto.departmentId !== undefined && !(await this.departments.findById(tx, dto.departmentId))) throw badInput('존재하지 않는 부서입니다');
      if (roleChanged && !(await this.roles.findById(tx, dto.roleId!))) throw badInput('존재하지 않는 역할입니다');

      const reactivating = dto.employeeStatus === EMPLOYEE_STATUS.ACTIVE && current.employeeStatus !== EMPLOYEE_STATUS.ACTIVE;
      const row = await this.employees.update(tx, id, {
        employeeName: dto.employeeName?.trim(),
        departmentId: dto.departmentId,
        roleId: dto.roleId,
        jobGrade: dto.jobGrade?.trim(),
        email: dto.email,
        employeeStatus: dto.employeeStatus,
        failedLoginCount: reactivating ? 0 : undefined,
      });
      this.realtime.changed('employees', 'departments');
      return toView(row);
    });
  }

  /** 로그인 실패로 잠긴 계정을 푼다 (LOCKED → ACTIVE, 실패 횟수 0). */
  async unlock(id: number): Promise<EmployeeView> {
    return this.prisma.tx(async (tx) => {
      const current = await this.employees.findStatus(tx, id);
      if (!current) throw notFound('사원');
      if (current.employeeStatus !== EMPLOYEE_STATUS.LOCKED) throw invalidState('잠긴 계정만 풀 수 있습니다');
      const row = await this.employees.update(tx, id, { employeeStatus: EMPLOYEE_STATUS.ACTIVE, failedLoginCount: 0 });
      this.realtime.changed('employees');
      return toView(row);
    });
  }

  /** 관리자가 정한 새 비밀번호로 바꾼다. 비밀번호는 응답·작업 로그에 남기지 않는다. */
  async resetPassword(id: number, newPassword: string): Promise<EmployeeView> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    return this.prisma.tx(async (tx) => {
      if (!(await this.employees.findStatus(tx, id))) throw notFound('사원');
      return toView(await this.employees.setPasswordHash(tx, id, passwordHash));
    });
  }
}
