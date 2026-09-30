import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CancelShipmentRequestDto } from './dto/cancel-shipment-request.dto';
import { CreateShipmentRequestDto } from './dto/create-shipment-request.dto';
import { ListShipmentRequestsDto, ListShippableDto } from './dto/list-shipment-requests.dto';
import { GoodsIssueService } from './goods-issue.service';
import { ShipmentRequestService } from './shipment-request.service';

// 출하요청은 영업이 만들고 물류가 출고 확정한다. 두 쪽 모두 조회한다.
const READ_PERMISSIONS = [PERMISSION.SHIPMENT_REQUEST, PERMISSION.GOODS_ISSUE_CONFIRM] as const;

@Controller('shipment-requests')
export class ShipmentRequestController {
  constructor(
    private readonly service: ShipmentRequestService,
    private readonly goodsIssues: GoodsIssueService,
  ) {}

  @Get()
  @RequireView(...READ_PERMISSIONS)
  list(@Query() q: ListShipmentRequestsDto) {
    return this.service.list(q);
  }

  /** 지금 출하요청할 수 있는 수주 품목. `:id`보다 먼저 선언해야 한다. */
  @Get('shippable')
  @RequireView(PERMISSION.SHIPMENT_REQUEST)
  shippable(@Query() q: ListShippableDto) {
    return this.service.shippable(q);
  }

  @Post()
  @RequireUse(PERMISSION.SHIPMENT_REQUEST)
  create(@Body() dto: CreateShipmentRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @RequireView(...READ_PERMISSIONS)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireUse(PERMISSION.SHIPMENT_REQUEST)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelShipmentRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, dto, user);
  }

  /** 출고 확정 (Goods Issue). */
  @Post(':id/goods-issue')
  @HttpCode(200)
  @RequireUse(PERMISSION.GOODS_ISSUE_CONFIRM)
  confirmGoodsIssue(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.goodsIssues.confirm(id, user, idempotencyKey);
  }
}
