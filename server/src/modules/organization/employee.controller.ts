import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeService } from './employee.service';

@Controller('employees')
export class EmployeeController {
  constructor(private readonly service: EmployeeService) {}

  /** 로그인한 누구나. `:id`보다 위에 둔다. */
  @Get('directory')
  directory() {
    return this.service.directory();
  }

  @Get() @RequireView(PERMISSION.EMPLOYEE_MANAGE)
  list(@Query() q: ListEmployeesDto) {
    return this.service.list(q);
  }

  @Get(':id') @RequireView(PERMISSION.EMPLOYEE_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Post() @RequireUse(PERMISSION.EMPLOYEE_MANAGE)
  create(@Body() dto: CreateEmployeeDto) {
    return this.service.create(dto);
  }

  @Patch(':id') @RequireUse(PERMISSION.EMPLOYEE_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/unlock') @HttpCode(200) @RequireUse(PERMISSION.EMPLOYEE_MANAGE)
  unlock(@Param('id', ParseIntPipe) id: number) {
    return this.service.unlock(id);
  }

  @Post(':id/reset-password') @HttpCode(200) @RequireUse(PERMISSION.EMPLOYEE_MANAGE)
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(id, dto.newPassword);
  }
}
