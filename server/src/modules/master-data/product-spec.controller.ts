import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateProductSpecDto } from './dto/create-product-spec.dto';
import { ListProductSpecsDto } from './dto/list-product-specs.dto';
import { UpdateProductSpecDto } from './dto/update-product-spec.dto';
import { ProductSpecService } from './product-spec.service';

@Controller('product-specs')
export class ProductSpecController {
  constructor(private readonly service: ProductSpecService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListProductSpecsDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateProductSpecDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductSpecDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  @Post(':id/activate') @HttpCode(200) @RequireUse(PERMISSION.MASTER_MANAGE)
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.activate(id, user); }

  @Post(':id/deactivate') @HttpCode(200) @RequireUse(PERMISSION.MASTER_MANAGE)
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.deactivate(id, user); }
}
