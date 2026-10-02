import { Injectable } from '@nestjs/common';
import type { AuthUser, Permission, PermissionLevel, Role } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserRepository } from './auth-user.repository';

@Injectable()
export class AuthUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthUserRepository,
  ) {}

  /** 사원 id로 인증 컨텍스트를 만든다. 없거나 퇴사(is_active = false)면 null */
  async load(employeeId: number): Promise<AuthUser | null> {
    const employee = await this.repository.findEmployeeForAuth(this.prisma, employeeId);
    if (!employee || !employee.isActive) return null;
    return {
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      employeeName: employee.employeeName,
      roleCode: employee.role.roleCode as Role,
      departmentId: employee.departmentId,
      jobGradeId: employee.jobGradeId,
      headDepartmentIds: employee.departmentsAsHeadEmployee.map((d) => d.id),
      permissions: Object.fromEntries(
        employee.role.rolePermissions.map((p) => [p.permission as Permission, p.permissionLevel as PermissionLevel]),
      ),
    };
  }
}
