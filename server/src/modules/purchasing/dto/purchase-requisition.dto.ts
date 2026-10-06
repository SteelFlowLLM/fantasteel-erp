import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
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

export class RejectPurchaseRequisitionDto {
  /** 요청자가 무엇을 고쳐 재요청할지 알 수 있게 필수로 받는다 */
  @IsString({ message: '반려 사유를 입력해 주세요' })
  @MaxLength(500, { message: '반려 사유는 500자까지 쓸 수 있어요' })
  rejectReason!: string;
}

/** 재요청은 수량·희망 입고일·요청 근거만 고친다 (원료 품목은 그대로) */
export class ResubmitPurchaseRequisitionDto {
  @IsString({ message: '수량(톤)을 입력해 주세요' })
  requestedTon!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '희망 입고일은 YYYY-MM-DD로 입력해 주세요' })
  desiredReceiptDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '요청 근거는 500자까지 쓸 수 있어요' })
  requestReason?: string | null;
}

export class ListPurchaseRequisitionsQuery {
  @IsOptional()
  @IsIn(Object.values(PURCHASE_REQUISITION_STATUS), { message: '구매요청 상태 값이 올바르지 않아요' })
  purchaseRequisitionStatus?: PurchaseRequisitionStatus;

  /** true면 승인함: 내가 부서장인 부서원의 승인 대기 요청만 (내 요청 제외) */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'approvable은 true 또는 false여야 해요' })
  approvable?: boolean;

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
