import { Body, Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse } from '../../common/auth/auth.decorators';
import { AllocationService } from './allocation.service';
import { ConfirmAllocationDto, RecommendAllocationDto, ReleaseAllocationDto } from './dto/allocation.dto';

// 출하 배정은 SHIPMENT_REQUEST, 열연 투입 배정은 ROLLING_ALLOCATE 권한이 필요하다.
// 어느 쪽인지는 요청 본문(purpose)에 달려 있어, 여기서는 둘 중 하나를 확인하고 service에서 목적별로 다시 확인한다.
@Controller('allocations')
export class AllocationController {
  constructor(private readonly service: AllocationService) {}

  @Post('recommend')
  @HttpCode(200)
  @RequireUse(PERMISSION.SHIPMENT_REQUEST, PERMISSION.ROLLING_ALLOCATE)
  recommend(@Body() dto: RecommendAllocationDto, @CurrentUser() user: AuthUser) {
    return this.service.recommend(dto, user);
  }

  @Post()
  @RequireUse(PERMISSION.SHIPMENT_REQUEST, PERMISSION.ROLLING_ALLOCATE)
  confirm(@Body() dto: ConfirmAllocationDto, @CurrentUser() user: AuthUser) {
    return this.service.confirm(dto, user);
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequireUse(PERMISSION.SHIPMENT_REQUEST, PERMISSION.ROLLING_ALLOCATE)
  release(@Param('id', ParseIntPipe) id: number, @Body() dto: ReleaseAllocationDto, @CurrentUser() user: AuthUser) {
    return this.service.release(id, dto, user);
  }
}
