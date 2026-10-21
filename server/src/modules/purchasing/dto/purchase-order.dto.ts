import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PURCHASE_ORDER_STATUS, type PurchaseOrderStatus } from '@fantasteel/shared';

/** 발주 품목 1행 = 승인된 구매요청 1건 (ERD purchase_order_item.purchase_requisition_id unique) */
export class PurchaseOrderLineInput {
  @IsInt({ message: '구매요청을 골라 주세요' })
  purchaseRequisitionId!: number;

  /** 톤 문자열(소수 3자리까지). 0 이하·요청량 초과는 service에서 본다 */
  @IsString({ message: '발주량(톤)을 입력해 주세요' })
  orderedTon!: string;

  /** 비우면 구매요청의 희망 입고일 (MRP 입고예정 필요일 판단에 쓴다) */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '입고 예정일은 YYYY-MM-DD로 입력해 주세요' })
  expectedReceiptDate?: string | null;
}

/** 공급업체 1곳당 발주 1건으로 여러 품목을 묶는다 (REQ-PUR-003) */
export class CreatePurchaseOrderDto {
  @IsInt({ message: '공급업체를 골라 주세요' })
  supplierId!: number;

  @ArrayNotEmpty({ message: '발주할 구매요청을 하나 이상 넣어 주세요' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInput)
  items!: PurchaseOrderLineInput[];
}

/** 발주 취소·잔량 마감 사유 (API-284·285). purchase_order에 칸이 없어 작업 로그 reason에만 남긴다. 길이는 반려 사유와 같다 */
export class PurchaseOrderReasonDto {
  @IsString({ message: '사유를 입력해 주세요' })
  @IsNotEmpty({ message: '사유를 입력해 주세요' })
  @MaxLength(500, { message: '사유는 500자까지 쓸 수 있어요' })
  reason!: string;
}

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
