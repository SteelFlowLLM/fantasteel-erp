import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { PERMISSION, type AuthUser, type PastCaseDraftView, type PastCaseView } from '@fantasteel/shared';
import { CurrentUser, RequirePermission } from '../../common/auth/auth.decorators';
import { CreatePastCaseDto, SearchPastCasesDto, UpdatePastCaseDto } from './dto/past-case.dto';
import { PastCaseService } from './past-case.service';

/**
 * 과거 사례 (EX, API-267~270, BP-CASE-01). 검색·상세는 로그인한 전 역할(API 명세 "사례 검색은 전 역할").
 * 초안·등록·수정·삭제는 사례 등록 전용 권한 코드가 없어 API 명세의 🟡 제안대로 불합격 처리 상태 지정(DISPOSITION_SET) 사용 권한으로 막는다.
 * 수정·삭제는 API 명세에 없는 추가 기능이다 (이슈 #464).
 */
@Controller()
export class PastCaseController {
  constructor(private readonly service: PastCaseService) {}

  @Get('past-cases')
  search(@Query() query: SearchPastCasesDto): Promise<PastCaseView[]> {
    return this.service.search(query);
  }

  @Get('past-cases/:id')
  detail(@Param('id', ParseIntPipe) id: number): Promise<PastCaseView> {
    return this.service.detail(id);
  }

  @Post('lots/:id/past-case-drafts')
  @HttpCode(200)
  @RequirePermission(PERMISSION.DISPOSITION_SET, 'USE')
  createDraft(@Param('id', ParseIntPipe) lotId: number): Promise<PastCaseDraftView> {
    return this.service.createDraft(lotId);
  }

  @Post('past-cases')
  @RequirePermission(PERMISSION.DISPOSITION_SET, 'USE')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePastCaseDto): Promise<PastCaseView> {
    return this.service.create(user, dto);
  }

  @Patch('past-cases/:id')
  @RequirePermission(PERMISSION.DISPOSITION_SET, 'USE')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePastCaseDto): Promise<PastCaseView> {
    return this.service.update(user, id, dto);
  }

  @Delete('past-cases/:id')
  @RequirePermission(PERMISSION.DISPOSITION_SET, 'USE')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<PastCaseView> {
    return this.service.remove(user, id);
  }
}
