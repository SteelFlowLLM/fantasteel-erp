import { AI_RESEARCH_LIMITS, AI_RESEARCH_SCHEDULE_FREQUENCY, AI_RESEARCH_SCHEDULE_TIME_PATTERN, type AiResearchScheduleFrequency } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

/** 말로 고치기에 보내는 지금 계획: 고치던 중이라 빈 칸·같은 검색어가 있을 수 있다 (모델에만 보이고, 돌려줄 계획은 서버가 다시 확인한다) */
export class AiResearchDraftStepDto {
  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.stepTitleMax, { message: `단계 이름은 ${AI_RESEARCH_LIMITS.stepTitleMax}자까지 쓸 수 있어요` })
  title!: string;

  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.queryMax, { message: `검색어는 ${AI_RESEARCH_LIMITS.queryMax}자까지 쓸 수 있어요` })
  query!: string;
}

export class AiResearchDraftPlanDto {
  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.planTitleMax, { message: `계획 제목은 ${AI_RESEARCH_LIMITS.planTitleMax}자까지 쓸 수 있어요` })
  title!: string;

  @IsArray()
  @ArrayMaxSize(AI_RESEARCH_LIMITS.maxPlanSteps, { message: `단계는 ${AI_RESEARCH_LIMITS.maxPlanSteps}개까지예요` })
  @ValidateNested({ each: true })
  @Type(() => AiResearchDraftStepDto)
  steps!: AiResearchDraftStepDto[];
}

/** POST ai-research/runs/:id/plan/suggest (이슈 #416) */
export class SuggestAiResearchPlanDto {
  @Transform(trim)
  @IsString({ message: '어떻게 고칠지 써 주세요' })
  @IsNotEmpty({ message: '어떻게 고칠지 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.instructionMax, { message: `부탁은 ${AI_RESEARCH_LIMITS.instructionMax}자까지 쓸 수 있어요` })
  instruction!: string;

  @IsObject({ message: '지금 계획을 함께 보내 주세요' })
  @ValidateNested()
  @Type(() => AiResearchDraftPlanDto)
  plan!: AiResearchDraftPlanDto;
}

/** POST ai-research/runs/:id/revisions (이슈 #418) */
export class CreateAiResearchRevisionDto {
  @Transform(trim)
  @IsString({ message: '보고서를 어떻게 고칠지 써 주세요' })
  @IsNotEmpty({ message: '보고서를 어떻게 고칠지 써 주세요' })
  @MaxLength(AI_RESEARCH_LIMITS.instructionMax, { message: `부탁은 ${AI_RESEARCH_LIMITS.instructionMax}자까지 쓸 수 있어요` })
  instruction!: string;

  /** 필요하면 더 검색 (없으면 true) */
  @IsOptional()
  @IsBoolean({ message: '더 검색할지는 true·false로 보내 주세요' })
  search?: boolean;
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

/** PUT ai-research/runs/:id/schedule (이슈 #521). 매일이면 요일을 보내지 않거나 빈 배열, 매주면 1(월)~7(일) 중 하나 이상 */
export class SetAiResearchScheduleDto {
  @IsIn(Object.values(AI_RESEARCH_SCHEDULE_FREQUENCY), { message: '반복은 매일(DAILY)이나 매주(WEEKLY)로 골라 주세요' })
  frequency!: AiResearchScheduleFrequency;

  @IsOptional()
  @IsArray({ message: '요일은 목록으로 보내 주세요' })
  @ArrayMaxSize(7, { message: '요일은 7개까지예요' })
  @ArrayUnique({ message: '같은 요일을 두 번 골랐어요' })
  @IsInt({ each: true, message: '요일은 1(월)~7(일)로 보내 주세요' })
  @Min(1, { each: true, message: '요일은 1(월)~7(일)로 보내 주세요' })
  @Max(7, { each: true, message: '요일은 1(월)~7(일)로 보내 주세요' })
  weekdays?: number[];

  @IsString({ message: '실행 시각을 HH:MM으로 써 주세요' })
  @Matches(AI_RESEARCH_SCHEDULE_TIME_PATTERN, { message: '실행 시각을 00:00~23:59의 HH:MM으로 써 주세요' })
  time!: string;
}

/** GET ai-research/runs/:id/pdf (이슈 #521). version이 없으면 지금 보고서 */
export class AiResearchPdfQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '판 번호는 정수로 보내 주세요' })
  @Min(1)
  @Max(INT4_MAX)
  version?: number;
}

/** POST ai-research/runs/:id/notion-export (이슈 #521). version이 없으면 지금 판 */
export class ExportAiResearchNotionDto {
  @IsOptional()
  @IsInt({ message: '판 번호는 정수로 보내 주세요' })
  @Min(1)
  @Max(INT4_MAX)
  version?: number;
}
