import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MEDIA_TYPES, AI_REASONING_LEVELS, type AiImageMediaType, type AiReasoningLevel } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBase64, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 질문 길이·지난 대화 수 상한 (가정값). 서버는 이 중 최근 MAX_HISTORY_TURNS개만 쓴다 */
const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT_LENGTH = 4000;

export class AiAssistantScreenDto {
  @IsString()
  @MaxLength(300)
  path!: string;

  @IsString()
  @MaxLength(100)
  title!: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  label!: string | null;
}

export class AiAssistantTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(MAX_HISTORY_CONTENT_LENGTH)
  content!: string;
}

export class AiAssistantImageDto {
  @IsIn(AI_IMAGE_MEDIA_TYPES)
  mediaType!: AiImageMediaType;

  @IsString()
  @IsBase64()
  // base64는 4바이트로 3바이트를 담는다
  @MaxLength(Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4, { message: `사진 한 장은 ${AI_IMAGE_MAX_BYTES / 1_000_000}MB까지 보낼 수 있어요` })
  dataBase64!: string;
}

export class AskAiAssistantDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '질문을 입력해 주세요' })
  @MaxLength(MAX_QUESTION_LENGTH, { message: `질문은 ${MAX_QUESTION_LENGTH}자까지 입력할 수 있어요` })
  question!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiAssistantScreenDto)
  screen?: AiAssistantScreenDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  meetingMinutesId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantTurnDto)
  history?: AiAssistantTurnDto[];

  @IsOptional()
  @IsIn(AI_REASONING_LEVELS)
  reasoning?: AiReasoningLevel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_IMAGE_MAX_COUNT, { message: `사진은 ${AI_IMAGE_MAX_COUNT}장까지 보낼 수 있어요` })
  @ValidateNested({ each: true })
  @Type(() => AiAssistantImageDto)
  images?: AiAssistantImageDto[];
}
