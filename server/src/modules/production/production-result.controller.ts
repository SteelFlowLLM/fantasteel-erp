import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CompleteProductionResultDto } from './dto/complete-production-result.dto';
import { ListProductionResultsDto } from './dto/list-production-results.dto';
import { ProductionResultService } from './production-result.service';

@Controller('production-results')
export class ProductionResultController {
  constructor(private readonly service: ProductionResultService) {}

  @Get() @RequireView(PERMISSION.RESULT_CONFIRM, PERMISSION.PLAN_CONFIRM)
  list(@Query() q: ListProductionResultsDto) {
    return this.service.list(q);
  }

  @Post(':id/start') @HttpCode(200) @RequireUse(PERMISSION.RESULT_CONFIRM)
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.start(id, user);
  }

  @Post(':id/complete') @HttpCode(200) @RequireUse(PERMISSION.RESULT_CONFIRM)
  complete(@Param('id', ParseIntPipe) id: number, @Body() dto: CompleteProductionResultDto, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, dto, user);
  }
}
