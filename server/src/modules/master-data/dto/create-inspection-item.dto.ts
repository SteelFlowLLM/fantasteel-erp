import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { NumericInput } from './numeric';
import { INSPECTION_PROCESS_CODES } from './list-inspection-items.dto';

export class CreateInspectionItemDto {
  /** 성분(히트) 검사는 강종 성분 규격을 쓰므로 연주·열연만 등록한다 */
  @IsIn(INSPECTION_PROCESS_CODES)
  processCode: string;

  /** null·생략 = 모든 강종 공통 */
  @IsOptional()
  @IsInt()
  steelGradeId?: number | null;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,49}$/, { message: '검사 항목 코드는 영문 대문자·숫자·_ 로 입력해 주세요 (예: TENSILE_STRENGTH)' })
  inspectionItemCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  inspectionItemName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  /** min·max는 경계 포함. 둘 중 하나는 있어야 하고, 둘 다 있으면 min ≤ max */
  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1000000)
  @Max(1000000)
  minValue?: number | null;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1000000)
  @Max(1000000)
  maxValue?: number | null;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
