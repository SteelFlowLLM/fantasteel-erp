import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { ITEM_TYPE, PROCESS_TYPE, type ProcessType } from '@fantasteel/shared';

/** 계획 수율 decimal(5,4): 0~1, 소수 4자리까지 (범위 0 < 수율 ≤ 1은 service가 본다) */
const YIELD_RATE = /^\d(\.\d{1,4})?$/;
const PRODUCT_ITEM_TYPES = [ITEM_TYPE.SLAB, ITEM_TYPE.COIL] as const;

/** API-173. 열연·제선은 계획 수율을 넣지 않는다 (REQ-MST-005, master-data.md 8-1) */
export class CreateRoutingDto {
  @IsIn(PRODUCT_ITEM_TYPES, { message: '품목 유형은 슬래브 또는 코일이에요' })
  itemType!: (typeof PRODUCT_ITEM_TYPES)[number];

  @IsIn(Object.values(PROCESS_TYPE), { message: '공정 값이 올바르지 않습니다' })
  processType!: ProcessType;

  @IsInt({ message: '공정 순서는 1 이상의 정수예요' })
  @Min(1, { message: '공정 순서는 1 이상의 정수예요' })
  sequenceNo!: number;

  @IsOptional()
  @Matches(YIELD_RATE, { message: '계획 수율은 소수 4자리까지의 0~1 값으로 입력해 주세요 (예: 0.98)' })
  plannedYieldRate?: string | null;
}

/** API-174. 보내지 않은 값은 그대로 둔다. 품목 유형·공정은 바꾸지 않는다 */
export class UpdateRoutingDto {
  @IsOptional()
  @IsInt({ message: '공정 순서는 1 이상의 정수예요' })
  @Min(1, { message: '공정 순서는 1 이상의 정수예요' })
  sequenceNo?: number;

  @IsOptional()
  @Matches(YIELD_RATE, { message: '계획 수율은 소수 4자리까지의 0~1 값으로 입력해 주세요 (예: 0.98)' })
  plannedYieldRate?: string | null;
}
