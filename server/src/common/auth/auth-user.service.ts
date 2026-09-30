import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthUserService {
  constructor(private readonly prisma: PrismaService) {}

  /** 사원 id로 인증 컨텍스트(역할·권한·부서장 여부)를 만든다. ACTIVE가 아니면 null. */
  async load(employeeId: number): Promise<AuthUser | null> {
    const e = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { department: true, role: { include: { rolePermissions: true } }, headDepartments: { select: { id: true } } },
    });
    if (!e || e.employeeStatus !== 'ACTIVE') return null;
    return {
      employeeId: e.id,
      employeeNo: e.employeeNo,
      employeeName: e.employeeName,
      roleCode: e.role.roleCode,
      departmentId: e.departmentId,
      departmentName: e.department.departmentName,
      jobGrade: e.jobGrade,
      headDepartmentIds: e.headDepartments.map((d) => d.id),
      permissions: Object.fromEntries(e.role.rolePermissions.map((p) => [p.permissionCode, p.permissionLevel as 'USE' | 'VIEW'])),
    };
  }
}
