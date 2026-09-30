import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListMasterDto } from './dto/list-master.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierService } from './supplier.service';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListMasterDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupplierDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  /** 공급업체 삭제: 다른 데이터가 쓰고 있으면 거부하고 사용 중지(PATCH isActive=false)로 안내한다 */
  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }
}
