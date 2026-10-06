import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION, type MrpRequirementsView } from '@fantasteel/shared';
import { RequirePermission } from '../../common/auth/auth.decorators';
import { MrpRequirementsQuery } from './dto/mrp.dto';
import { MrpService } from './mrp.service';

/**
 * 라우팅·DTO 검증·권한만 둔다. 업무 로직 금지 (컨벤션 6장).
 * 경로는 API 명세서와 docs/backend/mrp.md. 전역 prefix /api/v1은 main.ts가 붙인다.
 */
@Controller()
export class MrpController {
  constructor(private readonly service: MrpService) {}

  /** 저장 없이 계산 조회 (API-206). 권한은 공통 코드 "구매요청 등록·MRP" */
  @Get('mrp/requirements')
  @RequirePermission(PERMISSION.PURCHASE_REQUISITION_CREATE, 'VIEW')
  requirements(@Query() query: MrpRequirementsQuery): Promise<MrpRequirementsView> {
    return this.service.requirements(query);
  }
}
