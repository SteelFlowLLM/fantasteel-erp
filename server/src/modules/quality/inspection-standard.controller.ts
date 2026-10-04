import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PERMISSION, type InspectionStandardDetail, type InspectionStandardListItem, type PageResult } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { ListInspectionStandardsDto } from './dto/list-inspection-standards.dto';
import { InspectionStandardService } from './inspection-standard.service';

/**
 * 검사 기준 (inspection-standards). 라우팅·DTO 검증·권한만 둔다 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/quality.md 3장. 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class InspectionStandardController {
  constructor(private readonly service: InspectionStandardService) {}

  /** 검사 기준 목록 조회 (API-221·119). 공정·강종마다 최신 버전, 필터 processType·steelGradeId */
  @Get('inspection-standards')
  @RequirePermission(PERMISSION.INSPECTION_STANDARD_MANAGE, 'VIEW')
  listInspectionStandards(@Query() query: ListInspectionStandardsDto): Promise<PageResult<InspectionStandardListItem>> {
    return this.service.listInspectionStandards(query);
  }

  /** 검사 기준 상세 조회 (API-120). :id는 기준 버전(inspection_standard) id, 옛 버전도 조회 */
  @Get('inspection-standards/:id')
  @RequirePermission(PERMISSION.INSPECTION_STANDARD_MANAGE, 'VIEW')
  getInspectionStandard(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '검사 기준 id는 정수여야 해요') })) id: number,
  ): Promise<InspectionStandardDetail> {
    return this.service.getInspectionStandard(id);
  }
}
