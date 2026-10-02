import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

@Injectable()
export class AuthUserRepository {
  /** 인증 컨텍스트에 필요한 사원·역할 권한·부서장 부서 */
  findEmployeeForAuth(tx: Tx, employeeId: number) {
    return tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeNo: true,
        employeeName: true,
        departmentId: true,
        jobGradeId: true,
        isActive: true,
        role: { select: { roleCode: true, rolePermissions: { select: { permission: true, permissionLevel: true } } } },
        departmentsAsHeadEmployee: { select: { id: true } },
      },
    });
  }
}
