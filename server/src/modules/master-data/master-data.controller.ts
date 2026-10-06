import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION, type CustomerView, type ItemView } from '@fantasteel/shared';
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

  /** 고객사 목록 (수주 등록 고객사 선택) */
  @Get('customers')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listCustomers(): Promise<CustomerView[]> {
    return this.service.listCustomers();
  }

  /** 품목·규격 목록 (수주 등록 규격 선택에도 사용, 톤은 문자열) */
  @Get('items')
  @RequirePermission(PERMISSION.MASTER_MANAGE, 'VIEW')
  listItems(@Query() query: ListItemsQuery): Promise<ItemView[]> {
    return this.service.listItems(query.itemType);
  }
}
