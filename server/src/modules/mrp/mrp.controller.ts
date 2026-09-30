import { Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { MrpService } from './mrp.service';

@Controller('mrp-runs')
export class MrpController {
  constructor(private readonly service: MrpService) {}

  @Post()
  @RequireUse(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PLAN_CONFIRM)
  run(@CurrentUser() user: AuthUser) {
    return this.service.run(user);
  }

  @Get()
  @RequireView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PLAN_CONFIRM)
  list() {
    return this.service.list();
  }

  /** 가장 최근 실행 (없으면 null). `:id`보다 먼저 선언한다. */
  @Get('latest')
  @RequireView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PLAN_CONFIRM)
  latest() {
    return this.service.latest();
  }

  @Get(':id')
  @RequireView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PLAN_CONFIRM)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }
}
