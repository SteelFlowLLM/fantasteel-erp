import { Injectable } from '@nestjs/common';
import { EMPLOYEE_STATUS } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';
import { DepartmentRepository } from './department.repository';
import { EmployeeRepository } from './employee.repository';

export interface ResolvedApprover {
  approverId: number;
  /** 요청자 소속 부서 (구매요청의 department_id). 상위 부서 부서장이 승인해도 요청자 부서를 돌려준다. */
  departmentId: number;
}

/**
 * 승인권자 결정 (REQ-AUTH-004, SERVER-GUIDE 6장 구매).
 *  1. 요청자 소속 부서의 부서장. 요청자 본인이면 안 된다.
 *  2. 요청자가 그 부서의 부서장이면 상위 부서의 부서장으로 올라간다 (같은 규칙을 위로 되풀이).
 *  3. 부서장이 비어 있거나 사용 중지(INACTIVE)면 못 찾은 것이다 → null (호출한 쪽이 PUR-001).
 * 잠김(LOCKED) 부서장은 승인권자로 인정한다: 계정을 풀면 승인할 수 있고, 그동안 요청은 대기한다.
 */
@Injectable()
export class ApproverResolver {
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly employees: EmployeeRepository,
  ) {}

  async resolveApprover(tx: Tx, requesterEmployeeId: number): Promise<ResolvedApprover | null> {
    const requester = await this.employees.findStatus(tx, requesterEmployeeId);
    if (!requester) return null;

    const visited = new Set<number>();
    let departmentId: number | null = requester.departmentId;
    while (departmentId !== null && !visited.has(departmentId)) {
      visited.add(departmentId);
      const dept = await this.departments.findWithHead(tx, departmentId);
      if (!dept) return null;
      const headId = dept.headEmployeeId;
      if (headId === null || dept.headEmployee?.employeeStatus === EMPLOYEE_STATUS.INACTIVE) return null;
      if (headId !== requesterEmployeeId) return { approverId: headId, departmentId: requester.departmentId };
      departmentId = dept.parentId;
    }
    return null;
  }
}
