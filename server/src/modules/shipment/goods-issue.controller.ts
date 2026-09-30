import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION } from '@fantasteel/shared';
import { RequireView } from '../../common/auth/auth.decorators';
import { ListGoodsIssuesDto } from './dto/list-goods-issues.dto';
import { GoodsIssueService } from './goods-issue.service';

@Controller('goods-issues')
export class GoodsIssueController {
  constructor(private readonly service: GoodsIssueService) {}

  @Get()
  @RequireView(PERMISSION.GOODS_ISSUE_CONFIRM, PERMISSION.SHIPMENT_REQUEST)
  list(@Query() q: ListGoodsIssuesDto) {
    return this.service.list(q);
  }
}
