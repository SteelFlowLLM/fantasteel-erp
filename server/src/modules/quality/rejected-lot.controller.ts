import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type PageResult, type RejectedLotListItem } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { ListRejectedLotsDto } from './dto/list-rejected-lots.dto';
import { SetLotDispositionDto } from './dto/set-lot-disposition.dto';
import { RejectedLotService } from './rejected-lot.service';

/**
 * 불합격 LOT. 라우팅·DTO 검증·권한만 둔다 (컨벤션 6장). 전역 prefix /api/v1은 main.ts가 붙인다.
 * quality.module.ts에서 QualityController보다 먼저 등록해야 한다: 아니면 rejected-lots가 quality-inspections/:id에 잡힌다.
 */
@Controller()
export class RejectedLotController {
  constructor(private readonly service: RejectedLotService) {}

  /**
   * 불합격 LOT 목록 조회 (API-123). 명세 경로 /lots/rejected는 lot 모듈의 lots/:id와 겹쳐 대안 경로만 둔다
   * (quality.md 8장, 2026-10-04 결정). 권한(DISPOSITION_SET 또는 INSPECTION_REGISTER VIEW)은 service가 확인한다
   */
  @Get('quality-inspections/rejected-lots')
  listRejectedLots(@Query() query: ListRejectedLotsDto, @CurrentUser() user: AuthUser): Promise<PageResult<RejectedLotListItem>> {
    return this.service.listRejectedLots(query, user);
  }

  /** 불합격 처리 상태 지정 (API-226·124). 다시 지정해 바꿀 수 있다. 응답은 지정한 LOT의 불합격 LOT 목록 행 */
  @Post('lots/:id/disposition')
  @RequirePermission(PERMISSION.DISPOSITION_SET, 'USE')
  setLotDisposition(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', 'LOT id는 정수여야 해요') })) id: number,
    @Body() dto: SetLotDispositionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RejectedLotListItem> {
    return this.service.setLotDisposition(id, dto, user);
  }
}
