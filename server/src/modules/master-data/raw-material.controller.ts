import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ListRawMaterialsDto } from './dto/list-raw-materials.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { RawMaterialService } from './raw-material.service';

@Controller('raw-materials')
export class RawMaterialController {
  constructor(private readonly service: RawMaterialService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListRawMaterialsDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateRawMaterialDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRawMaterialDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }
}
