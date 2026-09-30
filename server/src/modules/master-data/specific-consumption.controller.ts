import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { ListSpecificConsumptionsDto } from './dto/list-specific-consumptions.dto';
import { UpsertSpecificConsumptionDto } from './dto/upsert-specific-consumption.dto';
import { SpecificConsumptionService } from './specific-consumption.service';

@Controller('specific-consumptions')
export class SpecificConsumptionController {
  constructor(private readonly service: SpecificConsumptionService) {}

  @Get() @RequireView(PERMISSION.MASTER_MANAGE)
  list(@Query() q: ListSpecificConsumptionsDto) { return this.service.list(q); }

  /** 원료·강종 조합의 원단위를 저장 (있으면 수정, 없으면 등록) */
  @Put() @RequireUse(PERMISSION.MASTER_MANAGE)
  upsert(@Body() dto: UpsertSpecificConsumptionDto, @CurrentUser() user: AuthUser) { return this.service.upsert(dto, user); }

  @Delete(':id') @RequireUse(PERMISSION.MASTER_MANAGE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) { return this.service.remove(id, user); }
}
