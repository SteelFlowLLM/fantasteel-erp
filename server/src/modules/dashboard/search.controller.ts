import { Controller, Get, Query } from '@nestjs/common';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

// 통합 검색 상자. 로그인한 사원은 모두 쓸 수 있다.
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(@Query() q: SearchQueryDto) {
    return this.service.search(q.q);
  }
}
