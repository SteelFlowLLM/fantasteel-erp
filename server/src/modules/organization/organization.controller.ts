import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { PERMISSION, type DepartmentNode, type DepartmentView, type EmployeeView, type JobGradeView, type PageResult, type RoleView } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { CreateJobGradeDto } from './dto/job-grade.dto';
import { ListEmployeesQuery } from './dto/list-employees.query';
import { UpdateRolePermissionsDto } from './dto/role-permission.dto';
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

  /** API-156 사원 등록 */
  @Post('employees')
  @RequirePermission(PERMISSION.EMPLOYEE_MANAGE, 'USE')
  createEmployee(@Body() dto: CreateEmployeeDto): Promise<EmployeeView> {
    return this.service.createEmployee(dto);
  }

  /** API-157 사원 수정·퇴사 처리 */
  @Patch('employees/:id')
  @RequirePermission(PERMISSION.EMPLOYEE_MANAGE, 'USE')
  updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto): Promise<EmployeeView> {
    return this.service.updateEmployee(id, dto);
  }

  /** API-158 부서 트리·조직도. 로그인한 사원 모두 (메신저 멤버·알림 대상 선택에도 사용) */
  @Get('departments')
  listDepartments(): Promise<DepartmentNode[]> {
    return this.service.listDepartments();
  }

  /** API-159 부서 등록 */
  @Post('departments')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  createDepartment(@Body() dto: CreateDepartmentDto): Promise<DepartmentView> {
    return this.service.createDepartment(dto);
  }

  /** API-160 부서 수정·부서장 지정 */
  @Patch('departments/:id')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateDepartment(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDepartmentDto): Promise<DepartmentView> {
    return this.service.updateDepartment(id, dto);
  }

  /** API-161 직급 목록. 로그인한 사원 모두 */
  @Get('job-grades')
  listJobGrades(): Promise<JobGradeView[]> {
    return this.service.listJobGrades();
  }

  /** API-162 직급 등록. 직급 관리 권한 코드가 따로 없어 API 명세대로 사원 관리 권한을 쓴다 (organization.md 8장) */
  @Post('job-grades')
  @RequirePermission(PERMISSION.EMPLOYEE_MANAGE, 'USE')
  createJobGrade(@Body() dto: CreateJobGradeDto): Promise<JobGradeView> {
    return this.service.createJobGrade(dto);
  }

  /** API-163 역할·권한 */
  @Get('roles')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'VIEW')
  listRoles(): Promise<RoleView[]> {
    return this.service.listRoles();
  }

  /** API-164 역할별 권한 변경 */
  @Put('roles/:id/permissions')
  @RequirePermission(PERMISSION.ORG_MANAGE, 'USE')
  updateRolePermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRolePermissionsDto): Promise<RoleView> {
    return this.service.updateRolePermissions(id, dto);
  }
}
