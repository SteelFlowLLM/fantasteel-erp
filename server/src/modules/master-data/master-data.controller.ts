import { Controller, Get, Query } from '@nestjs/common';
import {
  PERMISSION,
  type CustomerView,
  type ItemView,
  type ProductionSettingView,
  type RoutingView,
  type SpecificConsumptionView,
  type SpecMappingView,
  type SteelGradeView,
  type SupplierView,
  type YardView,
} from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { ListItemsQuery } from './dto/list-items.query';
import { MasterDataService } from './master-data.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/master-data.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}

  /** API-165 품목·규격 목록 (수주 등록 규격 선택에도 사용, 톤은 문자열) */
  @Get('items')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listItems(@Query() query: ListItemsQuery): Promise<ItemView[]> {
    return this.service.listItems(query.itemType);
  }

  /** API-168 강종 목록 */
  @Get('steel-grades')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listSteelGrades(): Promise<SteelGradeView[]> {
    return this.service.listSteelGrades();
  }

  /** API-170 규격 매핑 (열연 계획 수율은 계산값) */
  @Get('spec-mappings')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listSpecMappings(): Promise<SpecMappingView[]> {
    return this.service.listSpecMappings();
  }

  /** API-172 라우팅 */
  @Get('routings')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listRoutings(): Promise<RoutingView[]> {
    return this.service.listRoutings();
  }

  /** API-175 배합 원단위 */
  @Get('specific-consumptions')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listSpecificConsumptions(): Promise<SpecificConsumptionView[]> {
    return this.service.listSpecificConsumptions();
  }

  /** API-178 고객사 목록 (수주 등록 고객사 선택에도 사용) */
  @Get('customers')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listCustomers(): Promise<CustomerView[]> {
    return this.service.listCustomers();
  }

  /** API-181 공급업체 목록 (발주 화면에도 사용) */
  @Get('suppliers')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listSuppliers(): Promise<SupplierView[]> {
    return this.service.listSuppliers();
  }

  /** API-184 야드 목록 */
  @Get('yards')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listYards(): Promise<YardView[]> {
    return this.service.listYards();
  }

  /** API-187 생산 설정값 (단건 리소스라 :id 없음) */
  @Get('production-settings')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  getProductionSetting(): Promise<ProductionSettingView> {
    return this.service.getProductionSetting();
  }
}
