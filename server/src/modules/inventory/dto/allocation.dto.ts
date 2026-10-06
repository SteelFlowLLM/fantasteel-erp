import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ALLOCATION_PURPOSE, type AllocationPurpose } from '@fantasteel/shared';

// 열연 투입 배정(HOT_ROLLING)은 같은 allocation 테이블을 쓰지만, API를 하나로 쓸지 생산 담당과 정한 뒤 연다 (API 목록 비고).
const OPEN_PURPOSES = [ALLOCATION_PURPOSE.SHIPMENT];
const PURPOSE_MESSAGE = '배정 목적은 출하(SHIPMENT)만 받아요';

export class RecommendAllocationDto {
  @IsIn(OPEN_PURPOSES, { message: PURPOSE_MESSAGE })
  allocationPurpose!: AllocationPurpose;

  @IsInt({ message: '출하요청 품목을 골라 주세요' })
  shipmentRequestItemId!: number;
}

export class ConfirmAllocationDto {
  @IsIn(OPEN_PURPOSES, { message: PURPOSE_MESSAGE })
  allocationPurpose!: AllocationPurpose;

  @IsInt({ message: '출하요청 품목을 골라 주세요' })
  shipmentRequestItemId!: number;

  @ArrayNotEmpty({ message: '배정할 LOT을 하나 이상 골라 주세요' })
  @ArrayUnique({ message: '같은 LOT을 두 번 고를 수 없어요' })
  @IsInt({ each: true, message: 'LOT id는 정수예요' })
  lotIds!: number[];
}

export class ReleaseAllocationDto {
  /** 있으면 변경(기존 해제 + 새 LOT 확정), 없으면 해제 */
  @IsOptional()
  @IsInt({ message: '새 LOT id는 정수예요' })
  newLotId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '사유는 200자까지 쓸 수 있어요' })
  reason?: string;
}

export class ListAllocationsQuery {
  @IsIn(OPEN_PURPOSES, { message: PURPOSE_MESSAGE })
  allocationPurpose!: AllocationPurpose;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shipmentRequestId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shipmentRequestItemId?: number;
}

export class AllocationCandidatesQuery {
  @IsIn(OPEN_PURPOSES, { message: PURPOSE_MESSAGE })
  allocationPurpose!: AllocationPurpose;

  @Type(() => Number)
  @IsInt({ message: '출하요청을 골라 주세요' })
  @Min(1)
  shipmentRequestId!: number;
}
