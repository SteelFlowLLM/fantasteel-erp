// 승인함 배지 숫자. 구매요청은 요청 시점 요청자 소속 부서(purchase_requisition.department_id)의 부서장이 승인한다 (REQ-AUTH-004).
// 승인함 화면은 3단계에서 만든다.
import { mockQuery } from '@/api/client';

export const approvalApi = {
  countWaiting: (employeeId: number): Promise<number> =>
    mockQuery((tables) => {
      const headOf = new Set(tables.department.filter((d) => d.headEmployeeId === employeeId).map((d) => d.id));
      return tables.purchaseRequisition.filter((pr) => pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' && headOf.has(pr.departmentId)).length;
    }),
};
