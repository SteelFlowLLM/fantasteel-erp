import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse } from '../../common/auth/auth.decorators';
import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

// 조회(목록·조직도)는 로그인한 누구나 볼 수 있다 (REQ-ORG-003). 변경만 ORG_MANAGE.
@Controller('departments')
export class DepartmentController {
  constructor(private readonly service: DepartmentService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('tree')
  tree() {
    return this.service.tree();
  }

  @Post() @RequireUse(PERMISSION.ORG_MANAGE)
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id') @RequireUse(PERMISSION.ORG_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }
}
