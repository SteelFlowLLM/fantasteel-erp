import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional } from 'class-validator';

export class ListGoodsIssuesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shipmentRequestId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  salesOrderId?: number;

  /** 출고 확정일 범위 (YYYY-MM-DD, 양 끝 포함, Asia/Seoul) */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
