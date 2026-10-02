import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  INSPECTION_RESULT,
  PROCESS_TYPE,
  QUALITY_INSPECTION_LIST_STATUS,
  type InspectionResult,
  type ProcessType,
  type QualityInspectionListStatus,
} from '@fantasteel/shared';

/** 검사하는 공정만 (REQ-QC-001: 제강·연주·열연) */
export const INSPECTED_PROCESS_TYPES = [
  PROCESS_TYPE.STEELMAKING,
  PROCESS_TYPE.CONTINUOUS_CASTING,
  PROCESS_TYPE.HOT_ROLLING,
] as const;

/** 판정 필터는 판정이 끝난 검사에만 쓴다 (quality.md 3장 "판정 필터로 불합격 관리 목록에도 사용") */
export const JUDGED_INSPECTION_RESULTS = [INSPECTION_RESULT.PASS, INSPECTION_RESULT.FAIL] as const;

export class ListQualityInspectionsDto {
  @IsOptional()
  @IsIn(Object.values(QUALITY_INSPECTION_LIST_STATUS), { message: 'status는 pending 또는 done이어야 해요' })
  status?: QualityInspectionListStatus;

  @IsOptional()
  @IsIn(INSPECTED_PROCESS_TYPES, { message: '공정은 제강·연주·열연 중 하나여야 해요' })
  processType?: ProcessType;

  @IsOptional()
  @IsIn(JUDGED_INSPECTION_RESULTS, { message: '판정 필터는 PASS 또는 FAIL이어야 해요' })
  inspectionResult?: InspectionResult;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'LOT id는 정수여야 해요' })
  @Min(1, { message: 'LOT id는 1 이상이어야 해요' })
  lotId?: number;

  @IsOptional()
  @IsString({ message: 'LOT 번호는 문자열이어야 해요' })
  @MaxLength(50, { message: 'LOT 번호는 50자 이하로 입력해 주세요' })
  lotNo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 해요' })
  @Min(1, { message: 'page는 1 이상이어야 해요' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 해요' })
  @Min(1, { message: 'size는 1 이상이어야 해요' })
  @Max(100, { message: 'size는 100 이하여야 해요' })
  size?: number;
}
