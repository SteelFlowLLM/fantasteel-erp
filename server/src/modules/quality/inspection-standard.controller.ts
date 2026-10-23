import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSION,
  type InspectionStandardDeleteResult,
  type InspectionStandardDetail,
  type InspectionStandardListItem,
  type PageResult,
} from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { CreateInspectionStandardDto, CreateInspectionStandardVersionDto } from './dto/create-inspection-standard.dto';
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

  /** 검사 기준 등록 (API-121). 공정·강종의 첫 기준을 버전 1로 만든다. 응답은 등록된 기준 상세 */
  @Post('inspection-standards')
  @RequirePermission(PERMISSION.INSPECTION_STANDARD_MANAGE, 'USE')
  createInspectionStandard(@Body() dto: CreateInspectionStandardDto): Promise<InspectionStandardDetail> {
    return this.service.createInspectionStandard(dto);
  }

  /** 검사 기준 수정 = 새 버전 (API-122). :id는 최신 버전 id, body는 새 버전의 항목 전체. 응답은 새 버전 상세 */
  @Post('inspection-standards/:id/versions')
  @RequirePermission(PERMISSION.INSPECTION_STANDARD_MANAGE, 'USE')
  createInspectionStandardVersion(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '검사 기준 id는 정수여야 해요') })) id: number,
    @Body() dto: CreateInspectionStandardVersionDto,
  ): Promise<InspectionStandardDetail> {
    return this.service.createInspectionStandardVersion(id, dto);
  }

  /** 검사 기준 삭제. :id는 그 코드의 아무 버전 id. 검사가 쓴 기준이면 거부하고, 아니면 그 코드의 모든 버전을 지운다 */
  @Delete('inspection-standards/:id')
  @RequirePermission(PERMISSION.INSPECTION_STANDARD_MANAGE, 'USE')
  deleteInspectionStandard(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new AppException('COM-004', '검사 기준 id는 정수여야 해요') })) id: number,
  ): Promise<InspectionStandardDeleteResult> {
    return this.service.deleteInspectionStandard(id);
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
