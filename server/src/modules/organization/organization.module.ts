import { Global, Module } from '@nestjs/common';
import { ApproverResolver } from './approver.resolver';
import { DepartmentController } from './department.controller';
import { DepartmentRepository } from './department.repository';
import { DepartmentService } from './department.service';
import { EmployeeController } from './employee.controller';
import { EmployeeRepository } from './employee.repository';
import { EmployeeService } from './employee.service';
import { RoleController } from './role.controller';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';

export { ApproverResolver, type ResolvedApprover } from './approver.resolver';

// 전역: 구매 모듈 등이 imports 없이 ApproverResolver를 주입받는다.
@Global()
@Module({
  controllers: [EmployeeController, DepartmentController, RoleController],
  providers: [EmployeeService, EmployeeRepository, DepartmentService, DepartmentRepository, RoleService, RoleRepository, ApproverResolver],
  exports: [ApproverResolver],
})
export class OrganizationModule {}
