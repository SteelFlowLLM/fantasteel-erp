import { Controller, Get, Query } from '@nestjs/common';
import { ListInventoriesDto, ListSurplusDto } from './dto/list-inventories.dto';
import { InventoryService } from './inventory.service';

// 재고는 수주 입력(가용 매수)·생산·구매·출하·품질 화면이 모두 보므로 로그인한 사원이면 조회할 수 있다.
@Controller('inventories')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  list(@Query() q: ListInventoriesDto) {
    return this.service.list(q);
  }

  @Get('surplus')
  surplus(@Query() q: ListSurplusDto) {
    return this.service.surplus(q);
  }
}
