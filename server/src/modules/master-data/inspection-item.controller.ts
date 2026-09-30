import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateInspectionItemDto } from './dto/create-inspection-item.dto';
import { ListInspectionItemsDto } from './dto/list-inspection-items.dto';
import { UpdateInspectionItemDto } from './dto/update-inspection-item.dto';
import { InspectionItemService } from './inspection-item.service';

@Controller('inspection-items')
export class InspectionItemController {
  constructor(private readonly service: InspectionItemService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListInspectionItemsDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateInspectionItemDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInspectionItemDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }
}
