import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PURCHASE_REQUISITION_STATUS, type PurchaseRequisitionStatus } from '@fantasteel/shared';

export class CreatePurchaseRequisitionDto {
  @IsInt({ message: '원료 품목을 골라 주세요' })
  itemId!: number;

  /** 톤 문자열(소수 3자리까지). 0 이하·자리수 검사는 Message → ERP 경로와 함께 쓰도록 service(createRequisition)에서 한다 */
  @IsString({ message: '수량(톤)을 입력해 주세요' })
  requestedTon!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '희망 입고일은 YYYY-MM-DD로 입력해 주세요' })
  desiredReceiptDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '요청 근거는 500자까지 쓸 수 있어요' })
  requestReason?: string | null;

  /** MRP 근거 생산계획 (같은 계획·품목 중복 요청 방지) */
  @IsOptional()
  @IsInt({ message: '생산계획을 다시 골라 주세요' })
  productionPlanId?: number | null;
}

export class ListPurchaseRequisitionsQuery {
  @IsOptional()
  @IsIn(Object.values(PURCHASE_REQUISITION_STATUS), { message: '구매요청 상태 값이 올바르지 않아요' })
  purchaseRequisitionStatus?: PurchaseRequisitionStatus;

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
