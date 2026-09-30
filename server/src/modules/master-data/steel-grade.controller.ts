import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateSteelGradeDto } from './dto/create-steel-grade.dto';
import { ListMasterDto } from './dto/list-master.dto';
import { PatchCompositionSpecsDto, ReplaceCompositionSpecsDto } from './dto/replace-composition-specs.dto';
import { UpdateSteelGradeDto } from './dto/update-steel-grade.dto';
import { SteelGradeService } from './steel-grade.service';

@Controller('steel-grades')
export class SteelGradeController {
  constructor(private readonly service: SteelGradeService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListMasterDto) { return this.service.list(q); }

  @Get(':id') @RequireView(PERMISSION.MASTER_MANAGE)
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post() @RequireUse(PERMISSION.MASTER_MANAGE)
  create(@Body() dto: CreateSteelGradeDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }

  @Patch(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSteelGradeDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user); }

  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }

  /** 성분 규격 전체 교체 */
  @Put(':id/composition-specs') @RequireUse(PERMISSION.MASTER_MANAGE)
  replaceCompositionSpecs(@Param('id', ParseIntPipe) id: number, @Body() dto: ReplaceCompositionSpecsDto, @CurrentUser() user: AuthUser) {
    return this.service.replaceCompositionSpecs(id, dto, user);
  }

  /** 성분 규격 일부 추가·수정·삭제 */
  @Patch(':id/composition-specs') @RequireUse(PERMISSION.MASTER_MANAGE)
  patchCompositionSpecs(@Param('id', ParseIntPipe) id: number, @Body() dto: PatchCompositionSpecsDto, @CurrentUser() user: AuthUser) {
    return this.service.patchCompositionSpecs(id, dto, user);
  }
}
