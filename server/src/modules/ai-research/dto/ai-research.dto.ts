import { AI_RESEARCH_LIMITS } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

export class AiResearchSeedSourceDto {
  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.seedTitleMax, { message: `출처 제목은 ${AI_RESEARCH_LIMITS.seedTitleMax}자까지예요` })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: '출처 주소가 비어 있어요' })
  @MaxLength(AI_RESEARCH_LIMITS.seedUrlMax, { message: `출처 주소는 ${AI_RESEARCH_LIMITS.seedUrlMax}자까지예요` })
  url!: string;
}

/** 철강맨AI에서 먼저 알아본 것 (이슈 #408). http(s)가 아닌 주소·같은 주소는 서버가 뺀다 */
export class AiResearchSeedDto {
  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.seedAnswerMax, { message: `간단 답은 ${AI_RESEARCH_LIMITS.seedAnswerMax}자까지 넘길 수 있어요` })
  answer!: string;

  @IsArray()
  @ArrayMaxSize(AI_RESEARCH_LIMITS.seedSourcesMax, { message: `출처는 ${AI_RESEARCH_LIMITS.seedSourcesMax}개까지 넘길 수 있어요` })
  @ValidateNested({ each: true })
  @Type(() => AiResearchSeedSourceDto)
  sources!: AiResearchSeedSourceDto[];
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

  @IsOptional()
  @ValidateNested()
  @Type(() => AiResearchSeedDto)
  seed?: AiResearchSeedDto;
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

  // ValidateNested만으론 plan이 빠진 요청이 통과해 서비스에서 500이 난다
  @IsObject({ message: '계획을 함께 보내 주세요' })
  @ValidateNested()
  @Type(() => AiResearchPlanDto)
  plan!: AiResearchPlanDto;
}

/** PATCH ai-research/runs/:id/title — 계획이 있는 조사의 제목만 (상태와 상관없이) */
export class RenameAiResearchRunDto {
  @IsInt({ message: '계획 판(revision)이 올바르지 않아요' })
  @Min(0)
  @Max(INT4_MAX)
  revision!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '제목을 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.planTitleMax, { message: `제목은 ${AI_RESEARCH_LIMITS.planTitleMax}자까지 쓸 수 있어요` })
  title!: string;
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
