import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PERMISSION, type PageResult, type QualityInspectionDetail, type QualityInspectionListItem } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { ListQualityInspectionsDto } from './dto/list-quality-inspections.dto';
import { QualityService } from './quality.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/quality.md. 리소스가 여러 개라 메서드마다 전체 경로를 쓴다 (예: @Get('sales-orders/:id')).
 * 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class QualityController {
  constructor(private readonly service: QualityService) {}

  /** 검사 대기·검사 목록 조회 (API-125). status=pending(기본)·done, 판정 필터 inspectionResult는 done만 */
  @Get('quality-inspections')
  @RequirePermission(PERMISSION.INSPECTION_REGISTER, 'VIEW')
  listQualityInspections(@Query() query: ListQualityInspectionsDto): Promise<PageResult<QualityInspectionListItem>> {
    return this.service.listQualityInspections(query);
  }

  /** 검사 상세 조회 (API-116). :id는 검사(quality_inspection) id */
  @Get('quality-inspections/:id')
  @RequirePermission(PERMISSION.INSPECTION_REGISTER, 'VIEW')
  getQualityInspection(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '검사 id는 정수여야 해요') })) id: number,
  ): Promise<QualityInspectionDetail> {
    return this.service.getQualityInspection(id);
  }
}
