import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateYardDto } from './dto/create-yard.dto';
import { ListYardsDto } from './dto/list-yards.dto';
import { UpdateYardDto } from './dto/update-yard.dto';
import { YardService } from './yard.service';

@Controller('yards')
export class YardController {
  constructor(private readonly service: YardService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListYardsDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateYardDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateYardDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  /** 야드 삭제: 다른 데이터가 쓰고 있으면 거부하고 사용 중지(PATCH isActive=false)로 안내한다 */
  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }
}
