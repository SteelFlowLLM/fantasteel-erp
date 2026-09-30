import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import {
  CreatePurchaseRequisitionDto, ListPurchaseRequisitionsDto, RejectPurchaseRequisitionDto, UpdatePurchaseRequisitionDto,
} from './dto/purchase-requisition.dto';
import { PurchaseRequisitionService } from './purchase-requisition.service';

@Controller('purchase-requisitions')
export class PurchaseRequisitionController {
  constructor(private readonly service: PurchaseRequisitionService) {}

  @Get()
  @RequireView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PO_CONFIRM)
  list(@Query() q: ListPurchaseRequisitionsDto, @CurrentUser() user: AuthUser) {
    return this.service.list(q, user);
  }

  /** 승인권자는 역할과 무관하므로 권한 데코레이터 없이 service에서 요청자·승인권자·조회 권한을 본다. */
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.detail(id, user);
  }

  @Post()
  @RequireUse(PERMISSION.PURCHASE_REQUISITION_CREATE)
  create(@Body() dto: CreatePurchaseRequisitionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequireUse(PERMISSION.PURCHASE_REQUISITION_CREATE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePurchaseRequisitionDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequireUse(PERMISSION.PURCHASE_REQUISITION_CREATE)
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  /** 승인·반려는 역할 권한이 아니라 구매요청에 지정된 승인권자인지로 판단한다 (service). */
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectPurchaseRequisitionDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto.rejectReason, user);
  }
}

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly service: PurchaseRequisitionService) {}

  /** 내가 승인할 것. 로그인한 누구나 부를 수 있다 (부서장이 아니면 빈 목록). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.approvals(user);
  }
}
