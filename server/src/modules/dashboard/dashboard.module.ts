import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

/** 대시보드 위젯 (REQ-DSH-001·002, BP-DSH-01). 영업 위젯(공정 흐름·수주 충족·제품 재고), 출하 실적, 공정별 수율. Agent 위험 감지·대응 후보는 P2 */
@Module({
  imports: [SalesOrderModule, InventoryModule, ProductionModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
