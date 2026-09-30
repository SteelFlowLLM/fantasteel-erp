import { Injectable } from '@nestjs/common';
import { EMPLOYEE_STATUS } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

export interface ResolvedApprover {
  approverId: number;
  /** 요청자 소속 부서 (purchase_requisition.department_id에 그대로 넣는다) */
  departmentId: number;
}

/**
 * 승인권자 규칙 (REQ-AUTH-004, REQ-ORG-002·004, SERVER-GUIDE 6장).
 * 요청자 소속 부서의 부서장. 요청자가 그 부서의 부서장이면 상위 부서의 부서장. 요청자 자신은 승인권자가 될 수 없다.
 * 조직 모듈의 전역 `ApproverResolver`와 같은 규칙·같은 시그니처로 만든 구매 모듈 내부 구현이다 (나중에 하나로 합친다).
 */
@Injectable()
export class ApproverPolicy {
  async resolveApprover(tx: Tx, requesterEmployeeId: number): Promise<ResolvedApprover | null> {
    const requester = await tx.employee.findUnique({ where: { id: requesterEmployeeId }, select: { departmentId: true } });
    if (!requester) return null;
    const visited = new Set<number>();
    let departmentId: number | null = requester.departmentId;
    while (departmentId !== null && !visited.has(departmentId)) {
      visited.add(departmentId);
      const department: { parentId: number | null; headEmployee: { id: number; employeeStatus: string } | null } | null = await tx.department.findUnique({
        where: { id: departmentId },
        select: { parentId: true, headEmployee: { select: { id: true, employeeStatus: true } } },
      });
      // 부서장이 비어 있으면 상위로 넘기지 않는다: 지정 누락을 드러내야 한다 (PUR-001)
      if (!department?.headEmployee) return null;
      // 사용 중지된 부서장은 승인할 수 없으므로 지정되지 않은 것으로 본다
      if (department.headEmployee.employeeStatus === EMPLOYEE_STATUS.INACTIVE) return null;
      if (department.headEmployee.id !== requesterEmployeeId) return { approverId: department.headEmployee.id, departmentId: requester.departmentId };
      departmentId = department.parentId;
    }
    return null;
  }
}
