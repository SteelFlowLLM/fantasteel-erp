import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PAST_CASE_CATEGORY, type CreatePastCaseInput, type PastCaseCategory, type PastCaseSearchInput } from '@fantasteel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CATEGORIES = Object.values(PAST_CASE_CATEGORY);

/** API-267 검색 조건 */
export class SearchPastCasesDto implements PastCaseSearchInput {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: PastCaseCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}

/** API-270 과거 사례 등록 (REQ-CASE-001 항목). 원인·조치·설비는 모를 수 있어 빈 값도 받는다 */
export class CreatePastCaseDto implements CreatePastCaseInput {
  @IsIn(CATEGORIES)
  caseCategory!: PastCaseCategory;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '제목을 입력해 주세요' })
  @MaxLength(200)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '현상을 입력해 주세요' })
  @MaxLength(2000)
  phenomenon!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  cause!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  actionTaken!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  equipmentText!: string;

  @IsDateString({ strict: true }, { message: '발생일은 YYYY-MM-DD로 입력해 주세요' })
  occurredDate!: string;

  @IsArray()
  @ArrayMinSize(1, { message: '관련 LOT을 하나 이상 골라 주세요' })
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  lotIds!: number[];
}
