import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreatePurchaseOrderDto, ListPurchaseOrdersDto } from './dto/purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @RequireView(PERMISSION.PO_CONFIRM, PERMISSION.RECEIPT_CONFIRM, PERMISSION.PURCHASE_REQUISITION_CREATE)
  list(@Query() q: ListPurchaseOrdersDto) {
    return this.service.list(q);
  }

  /** 발주할 수 있는 구매요청 품목 (기본 공급업체별 묶음). `:id`보다 먼저 선언한다. */
  @Get('orderable')
  @RequireView(PERMISSION.PO_CONFIRM)
  orderable() {
    return this.service.orderable();
  }

  @Get(':id')
  @RequireView(PERMISSION.PO_CONFIRM, PERMISSION.RECEIPT_CONFIRM, PERMISSION.PURCHASE_REQUISITION_CREATE)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post()
  @RequireUse(PERMISSION.PO_CONFIRM)
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }
}
