import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { GOODS_RECEIPT_STATUS, type GoodsReceiptStatus } from '@fantasteel/shared';
import { IsDateOnly, IsTonString } from '../purchasing.util';

export class CreateGoodsReceiptDto {
  @IsInt()
  @Min(1)
  purchaseOrderItemId: number;

  @IsTonString()
  receivedTon: string;

  @IsDateOnly()
  receiptDate: string;

  /** 비우면 원료의 기본 야드 */
  @IsOptional()
  @IsInt()
  @Min(1)
  yardId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListGoodsReceiptsDto {
  @IsOptional()
  @IsIn(Object.values(GOODS_RECEIPT_STATUS))
  status?: GoodsReceiptStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  purchaseOrderId?: number;
}
