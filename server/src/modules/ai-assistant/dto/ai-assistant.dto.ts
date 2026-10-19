import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MEDIA_TYPES, AI_REASONING_LEVELS, AI_SCREEN_ERROR_MAX, AI_SCREEN_MAP_MAX, AI_SCREEN_RESULT_MAX, type AiImageMediaType, type AiReasoningLevel } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBase64, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { UpdateMeetingCandidateDto } from '../../meeting-minutes/dto/meeting-minutes.dto';

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

/** 화면 조작 때 열 수 있는 화면 한 개 (이슈 #382). 쿼리 없는 앱 안 경로만 */
export class AiScreenMapEntryDto {
  @IsString()
  @MaxLength(200)
  @Matches(/^\/[A-Za-z0-9\-/]*$/)
  path!: string;

  @IsString()
  @MaxLength(60)
  title!: string;
}

/** POST ai-assistant/ui-actions/:actionId (이슈 #382). 화면이 동작을 한 결과 */
export class ScreenActionResultDto {
  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(AI_SCREEN_RESULT_MAX)
  result?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_SCREEN_ERROR_MAX)
  error?: string;
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

  /** 심층 조사 보고서에 대해 묻는 질문이면 그 조사 id (내 완료한 조사만, 이슈 #384) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  researchRunId?: number;

  /** 철강맨AI 패널만 true로 보낸다. 사내 채팅 @AI·회의 질문은 카드를 보여 줄 곳이 없어 보내지 않는다 */
  @IsOptional()
  @IsBoolean()
  actionCards?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantTurnDto)
  history?: AiAssistantTurnDto[];

  /** 이어 묻는 저장한 대화 (이슈 #399). 내 대화가 아니거나 없으면 AST-001 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  threadId?: number;

  /** 철강맨AI 패널만 true: 답이 끝나면 질문과 답을 저장한다 (이슈 #399) */
  @IsOptional()
  @IsBoolean()
  saveThread?: boolean;

  @IsOptional()
  @IsIn(AI_REASONING_LEVELS)
  reasoning?: AiReasoningLevel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_IMAGE_MAX_COUNT, { message: `사진은 ${AI_IMAGE_MAX_COUNT}장까지 보낼 수 있어요` })
  @ValidateNested({ each: true })
  @Type(() => AiAssistantImageDto)
  images?: AiAssistantImageDto[];

  /** 웹 검색을 켠 질문이면 true. 실시간 답 API에서만 웹 도구를 알린다 (이슈 #367) */
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  /** 브라우저 사용을 켠 질문이면 true. 서버 설정이 켜져 있고 실시간 답 API일 때만 브라우저 도구를 알린다 (이슈 #373) */
  @IsOptional()
  @IsBoolean()
  browser?: boolean;

  /** 화면 조작을 켠 질문이면 true. 서버 설정이 켜져 있고 실시간 답 API일 때만 화면 도구를 알린다 (이슈 #382, 시험 중) */
  @IsOptional()
  @IsBoolean()
  screenControl?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_SCREEN_MAP_MAX)
  @ValidateNested({ each: true })
  @Type(() => AiScreenMapEntryDto)
  screenMap?: AiScreenMapEntryDto[];
}

/** 수주 등록 카드의 품목 줄. 매수·규격·납기의 뜻은 수주 등록 service가 본다 */
export class ExecuteSalesOrderLineDto {
  @IsOptional()
  @IsInt({ message: '규격이 올바르지 않아요' })
  itemId?: number;

  /** 정수가 아니거나 1 미만이면 SO-002여야 해서 여기서 막지 않는다 (수주 등록 DTO와 같음) */
  @IsOptional()
  orderedQty?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '납기는 YYYY-MM-DD로 입력해 주세요' })
  dueDate?: string;
}

/** 실행한 카드가 있는 저장한 답 (이슈 #399) */
export class AiChatCardRefDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  messageId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  cardKey!: string;
}

const CARD_KINDS = ['TASK', 'EVENT', 'PURCHASE', 'SALES_ORDER', 'HOT_ROLLING', 'HEAT_PLAN', 'PAST_CASE'] as const;

/**
 * POST ai-assistant/action-cards/execute. 업무·일정·구매요청 칸은 회의록 후보 고치기와 같다(UpdateMeetingCandidateDto).
 * 나머지 종류의 칸은 선택으로 받고, 종류마다 필요한 칸이 있는지와 값의 뜻은 service가 본다.
 */
export class ExecuteAiActionCardDto extends UpdateMeetingCandidateDto {
  @IsIn(CARD_KINDS, { message: '카드 종류가 올바르지 않아요' })
  kind!: (typeof CARD_KINDS)[number];

  /** 저장한 대화의 카드면 그 자리. 실행하면 서버가 그 카드를 실행됨으로 바꾼다 (이슈 #399) */
  @IsOptional()
  @ValidateNested()
  @Type(() => AiChatCardRefDto)
  chat?: AiChatCardRefDto;

  // 수주 등록
  @IsOptional()
  @IsInt({ message: '고객사가 올바르지 않아요' })
  customerId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: '품목은 10줄까지 넣을 수 있어요' })
  @ValidateNested({ each: true })
  @Type(() => ExecuteSalesOrderLineDto)
  lines?: ExecuteSalesOrderLineDto[];

  // 열연 배정·히트 편성
  @IsOptional()
  @IsInt({ message: '생산계획이 올바르지 않아요' })
  @Min(1)
  @Max(2147483647)
  productionPlanId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique({ message: '같은 슬래브를 두 번 고를 수 없어요' })
  @IsInt({ each: true, message: 'LOT id는 정수예요' })
  lotIds?: number[];

  // 과거 사례 등록
  @IsOptional()
  @IsInt({ message: '관련 LOT이 올바르지 않아요' })
  @Min(1)
  @Max(2147483647)
  lotId?: number;

  @IsOptional()
  @IsIn(['QUALITY', 'EQUIPMENT'], { message: '구분이 올바르지 않아요' })
  caseCategory?: 'QUALITY' | 'EQUIPMENT';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  phenomenon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  actionTaken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  equipmentText?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '발생일은 YYYY-MM-DD로 입력해 주세요' })
  occurredDate?: string;
}

/** GET ai-assistant/threads (이슈 #399) */
export class ListAiChatThreadsQuery {
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
