import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ITEM_TYPE, SALES_ORDER_STATUS, type SalesOrderStatus } from '@fantasteel/shared';

export class ListSalesOrdersDto {
  /** 수주 헤더 상태 (품목 상태에서 계산한 값) */
  @IsOptional()
  @IsIn(Object.values(SALES_ORDER_STATUS), { message: `status는 ${Object.values(SALES_ORDER_STATUS).join(', ')} 중 하나여야 합니다` })
  status?: SalesOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsIn([ITEM_TYPE.SLAB, ITEM_TYPE.COIL], { message: 'itemType은 SLAB 또는 COIL이어야 합니다' })
  itemType?: 'SLAB' | 'COIL';

  /** 납기 범위 (YYYY-MM-DD, 양 끝 포함) */
  @IsOptional()
  @IsDateString({}, { message: '납기 범위는 YYYY-MM-DD 형식으로 입력해 주세요' })
  dueFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: '납기 범위는 YYYY-MM-DD 형식으로 입력해 주세요' })
  dueTo?: string;

  /** 수주번호·고객사명·규격 코드 부분 일치 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean({ message: 'deliveryRiskOnly는 true 또는 false여야 합니다' })
  deliveryRiskOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number;
}
