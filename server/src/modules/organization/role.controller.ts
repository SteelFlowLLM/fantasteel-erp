import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { ReplaceRolePermissionsDto } from './dto/replace-role-permissions.dto';
import { RoleService } from './role.service';

@Controller('roles')
export class RoleController {
  constructor(private readonly service: RoleService) {}

  // 사원 등록·수정 화면에서 역할 목록이 필요하므로 사원 관리 권한으로도 볼 수 있다.
  @Get() @RequireView(PERMISSION.ORG_MANAGE, PERMISSION.EMPLOYEE_MANAGE)
  list() {
    return this.service.list();
  }

  @Get(':id/permissions') @RequireView(PERMISSION.ORG_MANAGE, PERMISSION.EMPLOYEE_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Put(':id/permissions') @RequireUse(PERMISSION.ORG_MANAGE)
  replacePermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: ReplaceRolePermissionsDto, @CurrentUser() user: AuthUser) {
    return this.service.replacePermissions(id, dto, user);
  }
}
