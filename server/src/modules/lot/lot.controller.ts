import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { badInput } from '../../common/errors/app.exception';
import { ListLotsDto } from './dto/list-lots.dto';
import { SearchLotsDto } from './dto/search-lots.dto';
import { TraceLotDto } from './dto/trace-lot.dto';
import { LotTraceService } from './lot-trace.service';
import { LotService } from './lot.service';

const idPipe = new ParseIntPipe({ exceptionFactory: () => badInput('ID는 숫자여야 합니다') });

// 로그인한 사원은 모두 조회할 수 있다 (별도 권한 데코레이터 없음).
// 정적 경로(search, by-no)를 ':id'보다 먼저 선언한다.
@Controller('lots')
export class LotController {
  constructor(
    private readonly lots: LotService,
    private readonly trace: LotTraceService,
  ) {}

  @Get()
  list(@Query() q: ListLotsDto) {
    return this.lots.list(q);
  }

  @Get('search')
  search(@Query() q: SearchLotsDto) {
    return this.lots.search(q.q, q.limit);
  }

  @Get('by-no/:lotNo')
  byNo(@Param('lotNo') lotNo: string) {
    return this.lots.getByNo(lotNo);
  }

  @Get(':id/trace')
  traceLot(@Param('id', idPipe) id: number, @Query() q: TraceLotDto) {
    return this.trace.trace(id, q.direction ?? 'backward');
  }

  @Get(':id')
  detail(@Param('id', idPipe) id: number) {
    return this.lots.getById(id);
  }
}
