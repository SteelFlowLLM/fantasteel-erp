import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type PageResult, type PurchaseRequisitionDetail, type PurchaseRequisitionSummary } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { CreatePurchaseRequisitionDto, ListPurchaseRequisitionsQuery } from './dto/purchase-requisition.dto';
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
}
