import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ALLOCATION_PURPOSE, type AllocationPurpose } from '@fantasteel/shared';

class AllocationTargetDto {
  @IsIn(Object.values(ALLOCATION_PURPOSE), { message: 'purpose는 SHIPMENT(출하) 또는 ROLLING(열연 투입)이어야 합니다' })
  purpose: AllocationPurpose;

  /** purpose = SHIPMENT: 배정할 출하요청 품목 */
  @ValidateIf((o: AllocationTargetDto) => o.purpose === ALLOCATION_PURPOSE.SHIPMENT)
  @IsInt({ message: '출하 배정에는 출하요청 품목(shipmentRequestItemId)이 필요합니다' })
  shipmentRequestItemId?: number;

  /** purpose = ROLLING: 열연에 투입할 코일 생산계획 */
  @ValidateIf((o: AllocationTargetDto) => o.purpose === ALLOCATION_PURPOSE.ROLLING)
  @IsInt({ message: '열연 투입 배정에는 생산계획(productionPlanId)이 필요합니다' })
  productionPlanId?: number;
}

export class RecommendAllocationDto extends AllocationTargetDto {}

export class ConfirmAllocationDto extends AllocationTargetDto {
  /** 확정할 LOT */
  @IsArray({ message: 'lotIds는 LOT id 배열이어야 합니다' })
  @ArrayMinSize(1, { message: '배정할 LOT을 1개 이상 골라 주세요' })
  @ArrayUnique({ message: '같은 LOT을 두 번 넣을 수 없습니다' })
  @IsInt({ each: true, message: 'lotIds에는 LOT id(정수)만 넣어 주세요' })
  lotIds: number[];

  /** 배정 변경: 같은 대상의 기존 배정 중 먼저 해제할 것 (해제와 새 확정이 한 트랜잭션) */
  @IsOptional()
  @IsArray({ message: 'releaseAllocationIds는 배정 id 배열이어야 합니다' })
  @ArrayUnique({ message: '같은 배정을 두 번 넣을 수 없습니다' })
  @IsInt({ each: true, message: 'releaseAllocationIds에는 배정 id(정수)만 넣어 주세요' })
  releaseAllocationIds?: number[];

  /** FIFO 추천과 다르게 고르거나 배정을 바꾸는 사유 */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '사유는 500자 이하로 입력해 주세요' })
  reason?: string;
}

export class ReleaseAllocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '사유는 500자 이하로 입력해 주세요' })
  reason?: string;
}
