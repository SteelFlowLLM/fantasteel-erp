import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** 출하 가능 품목 조건. 고객사를 주면 그 고객사 수주 품목만 (같은 고객사끼리만 묶으므로) */
export class ShippableQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '고객사 id는 정수여야 합니다' })
  @Min(1, { message: '고객사 id는 1 이상이어야 합니다' })
  customerId?: number;
}
