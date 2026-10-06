import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type PageResult, type PurchaseOrderView, type PurchaseRequisitionDetail, type PurchaseRequisitionSummary } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { ListPurchaseOrdersQuery } from './dto/purchase-order.dto';
import { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsQuery, RejectPurchaseRequisitionDto, ResubmitPurchaseRequisitionDto } from './dto/purchase-requisition.dto';
import { PurchasingService } from './purchasing.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/purchasing.md. 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  /** "권한 VIEW 또는 부서장"은 데코레이터 하나로 표현할 수 없어 service가 확인한다 */
  @Get('purchase-requisitions')
  listRequisitions(@CurrentUser() user: AuthUser, @Query() query: ListPurchaseRequisitionsQuery): Promise<PageResult<PurchaseRequisitionSummary>> {
    return this.service.listRequisitions(user, query);
  }

  @Post('purchase-requisitions')
  @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'USE')
  createRequisition(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    return this.service.create(user, dto);
  }

  /** 권한 VIEW 또는 그 요청의 승인권자 (service가 확인) */
  @Get('purchase-requisitions/:id')
  requisitionDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<PurchaseRequisitionDetail> {
    return this.service.requisitionDetail(user, id);
  }

  /** 승인 권한 코드는 없다. 요청자 소속 부서의 부서장인지 service가 확인한다 (REQ-AUTH-004) */
  @Post('purchase-requisitions/:id/approve')
  @HttpCode(200)
  approveRequisition(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<PurchaseRequisitionDetail> {
    return this.service.approve(user, id);
  }

  @Post('purchase-requisitions/:id/reject')
  @HttpCode(200)
  rejectRequisition(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    return this.service.reject(user, id, dto);
  }

  /** 요청자 본인인지는 service가 확인한다 */
  @Post('purchase-requisitions/:id/resubmit')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'USE')
  resubmitRequisition(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResubmitPurchaseRequisitionDto): Promise<PurchaseRequisitionDetail> {
    return this.service.resubmit(user, id, dto);
  }

  @Get('purchase-orders')
  @RequirePermission(PERMISSION.PURCHASE_ORDER_CONFIRM, 'VIEW')
  listPurchaseOrders(@Query() query: ListPurchaseOrdersQuery): Promise<PageResult<PurchaseOrderView>> {
    return this.service.listPurchaseOrders(query);
  }

  @Get('purchase-orders/:id')
  @RequirePermission(PERMISSION.PURCHASE_ORDER_CONFIRM, 'VIEW')
  purchaseOrderDetail(@Param('id', ParseIntPipe) id: number): Promise<PurchaseOrderView> {
    return this.service.purchaseOrderDetail(id);
  }
}
