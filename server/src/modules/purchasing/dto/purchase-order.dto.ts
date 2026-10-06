import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PURCHASE_ORDER_STATUS, type PurchaseOrderStatus } from '@fantasteel/shared';

/** 상태·공급업체별 조회 (API-147) */
export class ListPurchaseOrdersQuery {
  @IsOptional()
  @IsIn(Object.values(PURCHASE_ORDER_STATUS), { message: '발주 상태 값이 올바르지 않아요' })
  purchaseOrderStatus?: PurchaseOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '공급업체를 다시 골라 주세요' })
  supplierId?: number;

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
