import type { AuthUser } from '@fantasteel/shared';
import { AppException } from '../errors/app.exception';

/**
 * 구매요청 승인권자 확인 (REQ-AUTH-004, 컨벤션 6장): 요청자 소속 부서의 부서장만 승인·반려할 수 있다.
 * requesterDepartmentId는 service가 요청자 사원을 조회해서 넘긴다. 부서장이 아니면 COM-002.
 * 부서에 부서장이 없을 때(PUR-001)는 부서를 조회하는 service가 먼저 확인한다.
 */
export function assertDepartmentHead(user: AuthUser, requesterDepartmentId: number): void {
  if (!user.headDepartmentIds.includes(requesterDepartmentId)) {
    throw new AppException('COM-002', '요청자 소속 부서의 부서장만 승인할 수 있습니다');
  }
}
