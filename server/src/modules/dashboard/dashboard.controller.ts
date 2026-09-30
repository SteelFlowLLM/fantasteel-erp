import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { DashboardLayoutService } from './dashboard-layout.service';
import { DashboardWidgetService } from './dashboard-widget.service';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { WidgetQueryDto } from './dto/widget-query.dto';

// 로그인한 사원은 모든 위젯을 볼 수 있다 (v2: 역할별 범위는 설계 문서 TBD). 배치는 본인 것만 읽고 쓴다.
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly layout: DashboardLayoutService,
    private readonly widgets: DashboardWidgetService,
  ) {}

  @Get('layout')
  getLayout(@CurrentUser() user: AuthUser) {
    return this.layout.get(user);
  }

  @Put('layout')
  saveLayout(@Body() dto: SaveLayoutDto, @CurrentUser() user: AuthUser) {
    return this.layout.save(dto, user);
  }

  @Get('widgets/:widgetCode')
  widget(@Param('widgetCode') widgetCode: string, @Query() q: WidgetQueryDto) {
    return this.widgets.get(widgetCode, q);
  }
}
