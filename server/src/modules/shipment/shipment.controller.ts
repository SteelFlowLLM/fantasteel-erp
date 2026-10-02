import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSION,
  type AuthUser,
  type MillSheetDetail,
  type MillSheetSummary,
  type PageResult,
  type ShipmentRequestDetail,
  type ShipmentRequestSummary,
  type ShippableSalesOrderItem,
} from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { CreateShipmentRequestDto } from './dto/create-shipment-request.dto';
import { ListMillSheetsQuery } from './dto/list-mill-sheets.query';
import { ListShipmentRequestsQuery } from './dto/list-shipment-requests.query';
import { ShippableQuery } from './dto/shippable.query';
import { ShipmentService } from './shipment.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/shipment.md. 전역 prefix /api/v1은 main.ts가 붙인다.
 * 목록·상세는 "SHIPMENT_REQUEST_MANAGE 또는 GOODS_ISSUE_CONFIRM" VIEW라 service에서 권한을 본다.
 */
@Controller()
export class ShipmentController {
  constructor(private readonly service: ShipmentService) {}

  /** 출하 가능 품목 (API 목록 초안 행). 경로가 :id보다 먼저 와야 한다 */
  @Get('shipment-requests/shippable')
  @RequirePermission(PERMISSION.SHIPMENT_REQUEST_MANAGE, 'VIEW')
  shippable(@Query() query: ShippableQuery): Promise<ShippableSalesOrderItem[]> {
    return this.service.listShippable(query.customerId);
  }

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

  /** 출하요청 취소 (출고 확정 후면 SHP-003) */
  @Post('shipment-requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission(PERMISSION.SHIPMENT_REQUEST_MANAGE, 'USE')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<ShipmentRequestDetail> {
    return this.service.cancel(user, id);
  }

  /** API-232 밀시트 목록 */
  @Get('mill-sheets')
  @RequirePermission(PERMISSION.MILL_SHEET_READ, 'VIEW')
  listMillSheets(@Query() query: ListMillSheetsQuery): Promise<PageResult<MillSheetSummary>> {
    return this.service.listMillSheets(query);
  }

  /** API-233 밀시트 조회 (저장된 스냅샷) */
  @Get('mill-sheets/:id')
  @RequirePermission(PERMISSION.MILL_SHEET_READ, 'VIEW')
  findMillSheet(@Param('id', ParseIntPipe) id: number): Promise<MillSheetDetail> {
    return this.service.findMillSheet(id);
  }
}
