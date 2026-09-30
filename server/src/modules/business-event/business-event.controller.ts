import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { badInput } from '../../common/errors/app.exception';
import { BusinessEventService } from './business-event.service';
import { ListBusinessEventsDto } from './dto/list-business-events.dto';

const idPipe = new ParseIntPipe({ exceptionFactory: () => badInput('ID는 숫자여야 합니다') });

// 로그인한 사원은 모두 조회할 수 있다 (REQ-LOG-003).
@Controller('business-events')
export class BusinessEventController {
  constructor(private readonly service: BusinessEventService) {}

  @Get()
  list(@Query() q: ListBusinessEventsDto) {
    return this.service.list(q);
  }

  @Get(':id')
  detail(@Param('id', idPipe) id: number) {
    return this.service.getById(id);
  }
}
