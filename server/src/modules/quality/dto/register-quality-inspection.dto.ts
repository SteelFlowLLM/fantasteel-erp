import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Matches, Min, ValidateNested } from 'class-validator';

/** measured_value decimal(12,4): 정수 8자리·소수 4자리. 치수 공차는 음수가 있다 ([ERD], 시드 THICKNESS_TOL) */
const MEASURED_VALUE_PATTERN = /^-?\d{1,8}(\.\d{1,4})?$/;

export class QualityInspectionValueInput {
  @IsInt({ message: '검사 항목 id는 정수여야 해요' })
  @Min(1, { message: '검사 항목 id는 1 이상이어야 해요' })
  inspectionStandardItemId!: number;

  @IsString({ message: '측정값은 문자열로 보내 주세요' })
  @Matches(MEASURED_VALUE_PATTERN, { message: '측정값은 정수 8자리·소수 4자리 이하의 숫자여야 해요' })
  measuredValue!: string;
}

export class RegisterQualityInspectionDto {
  @IsInt({ message: 'LOT id는 정수여야 해요' })
  @Min(1, { message: 'LOT id는 1 이상이어야 해요' })
  lotId!: number;

  /** 입력한 항목만 보낸다. 빠진 필수 항목은 PENDING으로 판정한다 (API-224) */
  @IsArray({ message: '측정값 목록은 배열이어야 해요' })
  @ArrayMaxSize(100, { message: '측정값은 100개 이하로 보내 주세요' })
  @ValidateNested({ each: true })
  @Type(() => QualityInspectionValueInput)
  values!: QualityInspectionValueInput[];
}
