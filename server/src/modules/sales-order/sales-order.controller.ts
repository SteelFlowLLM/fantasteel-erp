import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ListSalesOrdersDto } from './dto/list-sales-orders.dto';
import { SalesOrderService } from './sales-order.service';

// 수주 조회는 영업 외에 생산(계획)·물류(출하)도 본다.
const READ_PERMISSIONS = [PERMISSION.ORDER_CREATE, PERMISSION.PLAN_CONFIRM, PERMISSION.SHIPMENT_REQUEST] as const;

@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}

  @Get()
  @RequireView(...READ_PERMISSIONS)
  list(@Query() q: ListSalesOrdersDto) {
    return this.service.list(q);
  }

  @Post()
  @RequireUse(PERMISSION.ORDER_CREATE)
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.service.create(dto, user, idempotencyKey);
  }

  @Get(':id')
  @RequireView(...READ_PERMISSIONS)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Get(':id/fulfillment')
  @RequireView(...READ_PERMISSIONS)
  fulfillment(@Param('id', ParseIntPipe) id: number) {
    return this.service.fulfillment(id);
  }

  @Get(':id/reservations')
  @RequireView(...READ_PERMISSIONS)
  reservations(@Param('id', ParseIntPipe) id: number) {
    return this.service.reservations(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireUse(PERMISSION.ORDER_CANCEL)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, dto, user);
  }
}
