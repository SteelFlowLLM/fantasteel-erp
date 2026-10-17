import { AI_RESEARCH_LIMITS } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** int4 상한. 넘는 값은 DB 오류(500) 대신 입력 오류로 */
export const INT4_MAX = 2147483647;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 조사별 예산 (없으면 서버 기본값). 상한 안에서만 */
export class AiResearchBudgetDto {
  @IsOptional()
  @IsInt({ message: '단계 수는 정수로 써 주세요' })
  @Min(1)
  @Max(AI_RESEARCH_LIMITS.maxStepsCap, { message: `단계는 ${AI_RESEARCH_LIMITS.maxStepsCap}개까지예요` })
  maxSteps?: number;

  @IsOptional()
  @IsInt({ message: '출처 수는 정수로 써 주세요' })
  @Min(1)
  @Max(AI_RESEARCH_LIMITS.maxSourcesCap, { message: `출처는 ${AI_RESEARCH_LIMITS.maxSourcesCap}개까지예요` })
  maxSources?: number;
}

/** POST ai-research/runs */
export class CreateAiResearchRunDto {
  @Transform(trim)
  @IsString({ message: '조사할 질문을 써 주세요' })
  @MinLength(AI_RESEARCH_LIMITS.questionMin, { message: `질문은 ${AI_RESEARCH_LIMITS.questionMin}자 이상 써 주세요` })
  @MaxLength(AI_RESEARCH_LIMITS.questionMax, { message: `질문은 ${AI_RESEARCH_LIMITS.questionMax}자까지 쓸 수 있어요` })
  question!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiResearchBudgetDto)
  budget?: AiResearchBudgetDto;
}

export class AiResearchPlanStepDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '단계 이름을 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.stepTitleMax, { message: `단계 이름은 ${AI_RESEARCH_LIMITS.stepTitleMax}자까지 쓸 수 있어요` })
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '검색어를 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.queryMax, { message: `검색어는 ${AI_RESEARCH_LIMITS.queryMax}자까지 쓸 수 있어요` })
  query!: string;
}

export class AiResearchPlanDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '계획 제목을 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.planTitleMax, { message: `계획 제목은 ${AI_RESEARCH_LIMITS.planTitleMax}자까지 쓸 수 있어요` })
  title!: string;

  @IsArray()
  @ArrayMinSize(1, { message: '단계를 하나 이상 넣어 주세요' })
  @ArrayMaxSize(AI_RESEARCH_LIMITS.maxPlanSteps, { message: `단계는 ${AI_RESEARCH_LIMITS.maxPlanSteps}개까지예요` })
  @ValidateNested({ each: true })
  @Type(() => AiResearchPlanStepDto)
  steps!: AiResearchPlanStepDto[];
}

/** PUT ai-research/runs/:id/plan */
export class UpdateAiResearchPlanDto {
  @IsInt({ message: '계획 판(revision)이 올바르지 않아요' })
  @Min(0)
  @Max(INT4_MAX)
  revision!: number;

  @ValidateNested()
  @Type(() => AiResearchPlanDto)
  plan!: AiResearchPlanDto;
}

/** POST ai-research/runs/:id/start */
export class StartAiResearchRunDto {
  @IsInt({ message: '계획 판(revision)이 올바르지 않아요' })
  @Min(0)
  @Max(INT4_MAX)
  revision!: number;
}

/** GET ai-research/runs */
export class ListAiResearchRunsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // (page - 1) × size가 int4를 넘지 않게
  @Max(1_000_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size?: number;
}

/** GET ai-research/runs/:id */
export class GetAiResearchRunQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  afterSeq?: number;
}
