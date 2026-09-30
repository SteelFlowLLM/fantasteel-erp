import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PURCHASE_REQUISITION_STATUS, REQUISITION_SOURCE_TYPE, type PurchaseRequisitionStatus, type RequisitionSourceType } from '@fantasteel/shared';
import { IsDateOnly, IsTonString } from '../purchasing.util';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

export class PurchaseRequisitionItemDto {
  @IsInt({ message: '원료를 선택해 주세요' })
  @Min(1, { message: '원료를 선택해 주세요' })
  rawMaterialId: number;

  @IsTonString()
  requiredTon: string;
}

export class CreatePurchaseRequisitionDto {
  @IsArray()
  @ArrayMinSize(1, { message: '원료 품목을 1개 이상 입력해 주세요' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequisitionItemDto)
  items: PurchaseRequisitionItemDto[];

  @IsDateOnly()
  desiredReceiptDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestReason?: string;

  /** 화면에서 직접 등록(DIRECT) 또는 MRP 결과에서 등록(MRP). MESSAGE는 Action Draft 확정으로만 생긴다. */
  @IsOptional()
  @IsIn([REQUISITION_SOURCE_TYPE.DIRECT, REQUISITION_SOURCE_TYPE.MRP])
  sourceType?: Extract<RequisitionSourceType, 'DIRECT' | 'MRP'>;

  /** true면 등록과 동시에 제출(승인 대기) */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdatePurchaseRequisitionDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '원료 품목을 1개 이상 입력해 주세요' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequisitionItemDto)
  items?: PurchaseRequisitionItemDto[];

  @IsOptional()
  @IsDateOnly()
  desiredReceiptDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestReason?: string;
}

export class RejectPurchaseRequisitionDto {
  @IsString({ message: '반려 사유를 입력해 주세요' })
  @MinLength(1, { message: '반려 사유를 입력해 주세요' })
  @MaxLength(500, { message: '반려 사유는 500자 이하로 입력해 주세요' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  rejectReason: string;
}

export class ListPurchaseRequisitionsDto {
  @IsOptional()
  @IsIn(Object.values(PURCHASE_REQUISITION_STATUS))
  status?: PurchaseRequisitionStatus;

  /** 내가 요청한 것만 */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;

  /** 내가 승인할 것만 (승인 대기 + 승인권자 = 나) */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  toApprove?: boolean;
}
