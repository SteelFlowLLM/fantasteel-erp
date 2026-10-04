import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ProcessType } from '@fantasteel/shared';
import { INSPECTED_PROCESS_TYPES } from './list-quality-inspections.dto';

/** min/max decimal(12,4): 정수 8자리·소수 4자리. 치수 공차는 음수가 있다 ([ERD], 시드 THICKNESS_TOL) */
const LIMIT_PATTERN = /^-?\d{1,8}(\.\d{1,4})?$/;
/** 적용 두께 decimal(8,2): 정수 6자리·소수 2자리, 0 이상 */
const THICKNESS_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

export class InspectionStandardItemInput {
  @IsString({ message: '검사 항목 코드는 문자열이어야 해요' })
  @IsNotEmpty({ message: '검사 항목 코드를 입력해 주세요' })
  @MaxLength(50, { message: '검사 항목 코드는 50자 이하로 입력해 주세요' })
  inspectionItemCode!: string;

  @IsString({ message: '검사 항목 이름은 문자열이어야 해요' })
  @IsNotEmpty({ message: '검사 항목 이름을 입력해 주세요' })
  @MaxLength(100, { message: '검사 항목 이름은 100자 이하로 입력해 주세요' })
  inspectionItemName!: string;

  @IsOptional()
  @IsString({ message: '단위는 문자열이어야 해요' })
  @MaxLength(20, { message: '단위는 20자 이하로 입력해 주세요' })
  unit?: string | null;

  /** 이상 (경계 포함) */
  @IsOptional()
  @IsString({ message: '최솟값은 문자열로 보내 주세요' })
  @Matches(LIMIT_PATTERN, { message: '최솟값은 정수 8자리·소수 4자리 이하의 숫자여야 해요' })
  minValue?: string | null;

  /** 이하 (경계 포함) */
  @IsOptional()
  @IsString({ message: '최댓값은 문자열로 보내 주세요' })
  @Matches(LIMIT_PATTERN, { message: '최댓값은 정수 8자리·소수 4자리 이하의 숫자여야 해요' })
  maxValue?: string | null;

  /** 적용 두께 초과 (mm). 비우면 하한 없음 */
  @IsOptional()
  @IsString({ message: '적용 두께는 문자열로 보내 주세요' })
  @Matches(THICKNESS_PATTERN, { message: '적용 두께는 0 이상, 정수 6자리·소수 2자리 이하여야 해요' })
  thicknessOverMm?: string | null;

  /** 적용 두께 이하 (mm). 비우면 상한 없음 */
  @IsOptional()
  @IsString({ message: '적용 두께는 문자열로 보내 주세요' })
  @Matches(THICKNESS_PATTERN, { message: '적용 두께는 0 이상, 정수 6자리·소수 2자리 이하여야 해요' })
  thicknessUptoMm?: string | null;

  /** 생략하면 true ([ERD] is_required default true, 누락 시 PENDING) */
  @IsOptional()
  @IsBoolean({ message: '필수 여부는 true 또는 false여야 해요' })
  isRequired?: boolean;
}

export class CreateInspectionStandardDto {
  @IsIn(INSPECTED_PROCESS_TYPES, { message: '공정은 제강·연주·열연 중 하나여야 해요' })
  processType!: ProcessType;

  /** [ERD] steel_grade_id NOT NULL: 공통 기준은 없다 */
  @IsInt({ message: '강종 id는 정수여야 해요' })
  @Min(1, { message: '강종 id는 1 이상이어야 해요' })
  steelGradeId!: number;

  @IsArray({ message: '검사 항목 목록은 배열이어야 해요' })
  @ArrayMinSize(1, { message: '검사 항목을 1개 이상 넣어 주세요' })
  @ArrayMaxSize(100, { message: '검사 항목은 100개 이하로 넣어 주세요' })
  @ValidateNested({ each: true })
  @Type(() => InspectionStandardItemInput)
  items!: InspectionStandardItemInput[];
}
