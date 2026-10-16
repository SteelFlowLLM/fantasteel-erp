import { AI_REASONING_LEVELS, type AiReasoningLevel } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
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

  @IsOptional()
  @IsIn(AI_REASONING_LEVELS)
  reasoning?: AiReasoningLevel;
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

const CARD_KINDS = ['TASK', 'EVENT', 'PURCHASE', 'SALES_ORDER', 'HOT_ROLLING', 'HEAT_PLAN', 'PAST_CASE'] as const;

/**
 * POST ai-assistant/action-cards/execute. 업무·일정·구매요청 칸은 회의록 후보 고치기와 같다(UpdateMeetingCandidateDto).
 * 나머지 종류의 칸은 선택으로 받고, 종류마다 필요한 칸이 있는지와 값의 뜻은 service가 본다.
 */
export class ExecuteAiActionCardDto extends UpdateMeetingCandidateDto {
  @IsIn(CARD_KINDS, { message: '카드 종류가 올바르지 않아요' })
  kind!: (typeof CARD_KINDS)[number];

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
