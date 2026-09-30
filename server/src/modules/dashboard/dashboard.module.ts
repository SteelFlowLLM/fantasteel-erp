import { Module } from '@nestjs/common';
import { DashboardLayoutService } from './dashboard-layout.service';
import { DashboardWidgetService } from './dashboard-widget.service';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [DashboardController, SearchController],
  providers: [DashboardRepository, DashboardLayoutService, DashboardWidgetService, SearchService],
})
export class DashboardModule {}
