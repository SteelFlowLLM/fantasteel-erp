import { Controller, Get } from '@nestjs/common';
import { PERMISSION } from '@fantasteel/shared';
import { RequireView } from '../../common/auth/auth.decorators';
import { LookupService } from './lookup.service';
import { ValidationService } from './validation.service';

@Controller('master-data')
export class MasterDataController {
  constructor(
    private readonly lookups: LookupService,
    private readonly validation: ValidationService,
  ) {}

  /** 선택 목록. 권한 데코레이터 없음 = 로그인한 모든 사원 (수주·생산·구매 화면이 쓴다) */
  @Get('lookups')
  getLookups() { return this.lookups.lookups(); }

  /** 기준정보 준비 상태 점검 (MST-001) */
  @Get('validation') @RequireView(PERMISSION.MASTER_MANAGE)
  check() { return this.validation.check(); }
}
