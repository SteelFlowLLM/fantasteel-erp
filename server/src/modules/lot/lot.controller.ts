import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { LotDetail, LotSummary, LotTrace, PageResult } from '@fantasteel/shared';
import { ListLotsQuery, TraceLotQuery } from './dto/lot.query';
import { LotService } from './lot.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * LOT 추적 화면은 로그인한 전 역할이 보므로 권한 데코레이터를 두지 않는다 (docs/backend/lot.md 3장).
 * GET lots/rejected(quality)가 lots/:id보다 먼저 잡히도록 app.module에서 QualityModule을 먼저 등록한다.
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class LotController {
  constructor(private readonly service: LotService) {}

  /** API-235 LOT 목록 */
  @Get('lots')
  list(@Query() query: ListLotsQuery): Promise<PageResult<LotSummary>> {
    return this.service.list(query);
  }

  /** API-236 LOT 상세 */
  @Get('lots/:id')
  detail(@Param('id', ParseIntPipe) id: number): Promise<LotDetail> {
    return this.service.detail(id);
  }

  /** API-237 LOT 정·역추적 (?direction=backward|forward, 생략하면 유형에 맞춰) */
  @Get('lots/:id/trace')
  trace(@Param('id', ParseIntPipe) id: number, @Query() query: TraceLotQuery): Promise<LotTrace> {
    return this.service.trace(id, query.direction);
  }
}
