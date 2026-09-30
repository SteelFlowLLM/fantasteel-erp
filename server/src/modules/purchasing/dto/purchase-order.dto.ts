import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { PURCHASE_ORDER_STATUS, type PurchaseOrderStatus } from '@fantasteel/shared';
import { IsDateOnly, IsTonString } from '../purchasing.util';

export class PurchaseOrderItemDto {
  @IsInt()
  @Min(1)
  purchaseRequisitionItemId: number;

  @IsTonString()
  orderedTon: string;
}

export class CreatePurchaseOrderDto {
  @IsInt()
  @Min(1)
  supplierId: number;

  @IsDateOnly()
  dueDate: string;

  @IsArray()
  @ArrayMinSize(1, { message: '발주할 품목을 1개 이상 선택해 주세요' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}

export class ListPurchaseOrdersDto {
  @IsOptional()
  @IsIn(Object.values(PURCHASE_ORDER_STATUS))
  status?: PurchaseOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;
}
