import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { CreateGoodsReceiptDto, ListGoodsReceiptsDto } from './dto/goods-receipt.dto';
import { GoodsReceiptService } from './goods-receipt.service';

@Controller('goods-receipts')
export class GoodsReceiptController {
  constructor(private readonly service: GoodsReceiptService) {}

  @Get()
  @RequireView(PERMISSION.RECEIPT_CONFIRM, PERMISSION.PO_CONFIRM)
  list(@Query() q: ListGoodsReceiptsDto) {
    return this.service.list(q);
  }

  @Post()
  @RequireUse(PERMISSION.RECEIPT_CONFIRM)
  create(@Body() dto: CreateGoodsReceiptDto) {
    return this.service.create(dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequireUse(PERMISSION.RECEIPT_CONFIRM)
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user);
  }
}
