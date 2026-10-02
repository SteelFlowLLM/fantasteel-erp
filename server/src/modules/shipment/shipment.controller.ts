import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type PageResult, type ShipmentRequestDetail, type ShipmentRequestSummary } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { CreateShipmentRequestDto } from './dto/create-shipment-request.dto';
import { ListShipmentRequestsQuery } from './dto/list-shipment-requests.query';
import { ShipmentService } from './shipment.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/shipment.md. 전역 prefix /api/v1은 main.ts가 붙인다.
 * 목록·상세는 "SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM" VIEW라 service에서 권한을 본다.
 */
@Controller()
export class ShipmentController {
  constructor(private readonly service: ShipmentService) {}

  /** API-227 출하요청 목록 */
  @Get('shipment-requests')
  list(@CurrentUser() user: AuthUser, @Query() query: ListShipmentRequestsQuery): Promise<PageResult<ShipmentRequestSummary>> {
    return this.service.list(user, query);
  }

  /** API-228 출하요청 등록 */
  @Post('shipment-requests')
  @RequirePermission(PERMISSION.SHIPMENT_REQUEST_MANAGE, 'USE')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentRequestDto): Promise<ShipmentRequestDetail> {
    return this.service.create(user, dto);
  }

  /** API-229 출하요청 상세 */
  @Get('shipment-requests/:id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ShipmentRequestDetail> {
    return this.service.findOne(user, id);
  }
}
