import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { ListInspectionsDto } from './dto/list-inspections.dto';
import { RegisterInspectionDto } from './dto/register-inspection.dto';
import { QualityInspectionService } from './quality-inspection.service';
import { RejectedLotService } from './rejected-lot.service';

@Controller('quality-inspections')
export class QualityInspectionController {
  constructor(
    private readonly service: QualityInspectionService,
    private readonly rejectedLots: RejectedLotService,
  ) {}

  /** 검사 대기 LOT(status=pending, 기본) 또는 등록된 검사(status=done). */
  @Get() @RequireView(PERMISSION.INSPECTION_REGISTER)
  list(@Query() q: ListInspectionsDto) {
    return this.service.list(q);
  }

  /** `GET /lots/rejected`와 같은 응답. lot 모듈의 `/lots/:id`에 가려질 때를 위한 같은 내용의 경로 (`:id`보다 위에 둔다). */
  @Get('rejected-lots') @RequireView(PERMISSION.DISPOSITION_SET, PERMISSION.INSPECTION_REGISTER)
  rejected() {
    return this.rejectedLots.list();
  }

  @Get(':id') @RequireView(PERMISSION.INSPECTION_REGISTER)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  /** 측정값 등록 → 시스템이 합격·불합격을 판정한다. */
  @Post() @RequireUse(PERMISSION.INSPECTION_REGISTER)
  register(@Body() dto: RegisterInspectionDto, @CurrentUser() user: AuthUser) {
    return this.service.register(dto, user);
  }
}
