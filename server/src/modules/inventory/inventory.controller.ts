import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AllocationRecommendation, AllocationView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { ConfirmAllocationDto, ListAllocationsQuery, RecommendAllocationDto, ReleaseAllocationDto } from './dto/allocation.dto';
import { InventoryService } from './inventory.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 배정 권한은 목적(출하·열연)에 따라 달라 데코레이터 대신 service에서 확인한다 (docs/backend/inventory.md 3장).
 */
@Controller()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('allocations')
  listAllocations(@CurrentUser() user: AuthUser, @Query() query: ListAllocationsQuery): Promise<AllocationView[]> {
    return this.service.listAllocations(user, query);
  }

  @Post('allocations/recommend')
  @HttpCode(200)
  recommend(@CurrentUser() user: AuthUser, @Body() dto: RecommendAllocationDto): Promise<AllocationRecommendation> {
    return this.service.recommendAllocations(user, dto);
  }

  @Post('allocations')
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmAllocationDto): Promise<AllocationView[]> {
    return this.service.confirmAllocations(user, dto);
  }

  @Post('allocations/:id/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ReleaseAllocationDto): Promise<AllocationView> {
    return this.service.releaseAllocation(user, id, dto);
  }
}
