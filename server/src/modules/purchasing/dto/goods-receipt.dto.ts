import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** 입고 확정 = 등록 (API-151). 야드는 품목 기본 야드로 자동 지정해 받지 않는다 */
export class CreateGoodsReceiptDto {
  @IsInt({ message: '발주 품목을 골라 주세요' })
  purchaseOrderItemId!: number;

  /** 톤 문자열(소수 3자리까지). 0 이하·미입고량 초과는 service에서 본다 */
  @IsString({ message: '입고량(톤)을 입력해 주세요' })
  receivedTon!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '입고일은 YYYY-MM-DD로 입력해 주세요' })
  receivedDate!: string;
}

export class ListGoodsReceiptsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '발주를 다시 골라 주세요' })
  purchaseOrderId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
