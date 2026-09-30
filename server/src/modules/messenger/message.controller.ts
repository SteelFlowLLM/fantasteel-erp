import { Controller, Get, Header, Param, ParseIntPipe } from '@nestjs/common';
import type { AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { MessageService } from './message.service';

@Controller('messages')
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  /** 첨부 내려받기. 일반 링크(<a href>)로도 받을 수 있게 인증 가드가 `?access_token=`을 받아 준다. */
  @Get(':id/file')
  @Header('X-Content-Type-Options', 'nosniff')
  file(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.messages.openFile(id, user);
  }
}
