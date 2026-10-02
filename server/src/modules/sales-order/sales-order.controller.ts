import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSION,
  type AuthUser,
  type CancelSalesOrderResult,
  type CreateSalesOrderResult,
  type PageResult,
  type SalesOrderDetail,
  type SalesOrderFulfillment,
  type SalesOrderReservationView,
  type SalesOrderSummary,
} from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { CancelSalesOrderDto, CreateSalesOrderDto, ListSalesOrdersQuery } from './dto/sales-order.dto';
import { SalesOrderService } from './sales-order.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/sales-order.md.
 */
@Controller()
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}

  @Get('sales-orders')
  @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'VIEW')
  list(@Query() query: ListSalesOrdersQuery): Promise<PageResult<SalesOrderSummary>> {
    return this.service.list(query);
  }

  /** 화면은 저장 버튼마다 새 Idempotency-Key를 보내고, 다시 보낼 때는 같은 키를 쓴다 */
  @Post('sales-orders')
  @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'USE')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesOrderDto, @Headers('idempotency-key') idempotencyKey?: string): Promise<CreateSalesOrderResult> {
    return this.service.create(user, dto, idempotencyKey);
  }

  @Get('sales-orders/:id')
  @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'VIEW')
  detail(@Param('id', ParseIntPipe) id: number): Promise<SalesOrderDetail> {
    return this.service.detail(id);
  }

  @Get('sales-orders/:id/fulfillment')
  @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'VIEW')
  fulfillment(@Param('id', ParseIntPipe) id: number): Promise<SalesOrderFulfillment> {
    return this.service.fulfillment(id);
  }

  @Get('sales-orders/:id/reservations')
  @RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'VIEW')
  reservations(@Param('id', ParseIntPipe) id: number): Promise<SalesOrderReservationView[]> {
    return this.service.reservations(id);
  }

  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  @RequirePermission(PERMISSION.SALES_ORDER_CANCEL, 'USE')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelSalesOrderDto): Promise<CancelSalesOrderResult> {
    return this.service.cancel(user, id, dto);
  }
}
