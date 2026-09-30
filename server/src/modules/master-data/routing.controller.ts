import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { ReplaceRoutingDto } from './dto/replace-routing.dto';
import { UpdateRoutingYieldDto } from './dto/update-routing-yield.dto';
import { RoutingService } from './routing.service';

@Controller('routings')
export class RoutingController {
  constructor(private readonly service: RoutingService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list() { return this.service.list(); }

  @Get(':itemType') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('itemType') itemType: string) { return this.service.get(itemType); }

  /** 품목 유형(SLAB|COIL)의 공정 순서·수율 전체 교체 */
  @Put(':itemType') @RequireUse(PERMISSION.MASTER_MANAGE)
  replace(@Param('itemType') itemType: string, @Body() dto: ReplaceRoutingDto, @CurrentUser() user: AuthUser) { return this.service.replace(itemType, dto, user); }

  /** 공정 1개의 계획 수율 수정 */
  @Patch('processes/:id') @RequireUse(PERMISSION.MASTER_MANAGE)
  updateYield(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoutingYieldDto, @CurrentUser() user: AuthUser) { return this.service.updateYield(id, dto, user); }
}
