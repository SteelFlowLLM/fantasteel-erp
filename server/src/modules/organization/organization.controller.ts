import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION, type DepartmentNode, type EmployeeView, type JobGradeView, type PageResult, type RoleView } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { OrganizationService } from './organization.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/organization.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  /** API-155 사원 목록 */
  @Get('employees')
  @RequirePermission(PERMISSION.EMPLOYEE_MANAGE, 'VIEW')
  listEmployees(@Query() query: ListEmployeesQuery): Promise<PageResult<EmployeeView>> {
    return this.service.listEmployees(query);
  }

  /** API-158 부서 트리·조직도. 로그인한 사원 모두 (메신저 멤버·알림 대상 선택에도 사용) */
  @Get('departments')
  listDepartments(): Promise<DepartmentNode[]> {
    return this.service.listDepartments();
  }

  /** API-161 직급 목록. 로그인한 사원 모두 */
  @Get('job-grades')
  listJobGrades(): Promise<JobGradeView[]> {
    return this.service.listJobGrades();
  }

  /** API-163 역할·권한 */
  @Get('roles')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  listRoles(): Promise<RoleView[]> {
    return this.service.listRoles();
  }
}
