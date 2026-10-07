import { Controller, Get, Query } from '@nestjs/common';
import type { BusinessEventView, PageResult } from '@fantasteel/shared';
import { BusinessEventService } from './business-event.service';
import { ListBusinessEventsQuery } from './dto/list-business-events.query';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/business-event.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 작업 로그는 로그인한 전 역할이 보므로 권한 데코레이터를 두지 않는다 (API-238 권한: 없음).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class BusinessEventController {
  constructor(private readonly service: BusinessEventService) {}

  /** API-238 작업 로그·이력 재현 조회 (?salesOrderId= 수주 타임라인, ?lotId= LOT 타임라인) */
  @Get('business-events')
  list(@Query() query: ListBusinessEventsQuery): Promise<PageResult<BusinessEventView>> {
    return this.service.list(query);
  }
}
