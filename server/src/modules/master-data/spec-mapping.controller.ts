import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateSpecMappingDto } from './dto/create-spec-mapping.dto';
import { ListSpecMappingsDto } from './dto/list-spec-mappings.dto';
import { UpdateSpecMappingDto } from './dto/update-spec-mapping.dto';
import { SpecMappingService } from './spec-mapping.service';

@Controller('spec-mappings')
export class SpecMappingController {
  constructor(private readonly service: SpecMappingService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListSpecMappingsDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateSpecMappingDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSpecMappingDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }
}
