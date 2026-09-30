import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PERMISSION, type AuthUser } from '@fantasteel/shared';
import { CurrentUser, RequireUse, RequireView } from '../../common/auth/auth.decorators';
import { SetDispositionDto } from './dto/set-disposition.dto';
import { RejectedLotService } from './rejected-lot.service';

/** 불합격 LOT (품질 화면). LOT 조회·추적 API는 lot 모듈에 있다. */
@Controller('lots')
export class RejectedLotController {
  constructor(private readonly service: RejectedLotService) {}

  @Get('rejected') @RequireView(PERMISSION.DISPOSITION_SET, PERMISSION.INSPECTION_REGISTER)
  list() {
    return this.service.list();
  }

  @Post(':id/disposition') @HttpCode(200) @RequireUse(PERMISSION.DISPOSITION_SET)
  setDisposition(@Param('id', ParseIntPipe) id: number, @Body() dto: SetDispositionDto, @CurrentUser() user: AuthUser) {
    return this.service.setDisposition(id, dto, user);
  }
}
