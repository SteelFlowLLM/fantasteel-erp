import { Controller, Get } from '@nestjs/common';
import type { AuthUser, OrderFulfillmentWidget, ProcessFlowWidget, ProductStockWidget } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { DashboardService } from './dashboard.service';

/**
 * 대시보드 위젯 조회. API 목록의 GET /dashboard/widgets(🟡 경로 제안) 아래에 위젯별로 둔다.
 * 위젯 권한은 단계마다 달라 service에서 확인한다. 위젯 구성 저장(PUT)은 이번 범위가 아니다.
 */
@Controller()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('dashboard/widgets/process-flow')
  processFlow(): Promise<ProcessFlowWidget> {
    return this.service.processFlow();
  }

  @Get('dashboard/widgets/order-fulfillment')
  orderFulfillment(@CurrentUser() user: AuthUser): Promise<OrderFulfillmentWidget> {
    return this.service.orderFulfillment(user);
  }

  @Get('dashboard/widgets/product-stock')
  productStock(): Promise<ProductStockWidget> {
    return this.service.productStock();
  }
}
