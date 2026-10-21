import { AI_AGENT_CONTROL_COMMANDS, AI_AGENT_INPUT_KEYS, AI_AGENT_INPUT_KINDS, AI_AGENT_INPUT_SCROLL_MAX, AI_AGENT_INPUT_TEXT_MAX, AI_AGENT_NOTE_MAX_CHARS, AI_DRIVE_ATTACH_MAX, AI_RESEARCH_LIMITS, AI_NOTION_CONTENT_MAX, AI_NOTION_EDIT_MAX, AI_NOTION_EDIT_TEXT_MAX, AI_NOTION_TITLE_MAX, AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MEDIA_TYPES, AI_REASONING_LEVELS, AI_SCREEN_ERROR_MAX, AI_SCREEN_MAP_MAX, AI_SCREEN_RESULT_MAX, type AiAgentControlCommand, type AiAgentInput, type AiAgentInputKey, type AiAgentInputKind, type AiImageMediaType, type AiReasoningLevel } from '@fantasteel/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBase64, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { UpdateMeetingCandidateDto } from '../../meeting-minutes/dto/meeting-minutes.dto';
import { AiResearchSeedDto } from '../../ai-research/dto/ai-research.dto';

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

/** POST ai-assistant/agent-control/:controlId (이슈 #425). 답하는 동안 브라우저·화면 조작을 멈춤·한 단계·계속 */
export class AgentControlDto {
  @IsIn(AI_AGENT_CONTROL_COMMANDS, { message: '명령은 pause·step·resume 중 하나예요' })
  command!: AiAgentControlCommand;
}

/** POST ai-assistant/agent-control/:controlId/notes (이슈 #430). 답하는 중에 덧붙이는 말 */
export class AgentNoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: '덧붙일 말을 적어 주세요' })
  @MaxLength(AI_AGENT_NOTE_MAX_CHARS)
  text!: string;
}

/**
 * POST ai-assistant/agent-control/:controlId/input (이슈 #433). 멈춘 동안 사람이 실시간 화면에서 보내는 조작.
 * 종류마다 쓰는 칸이 달라 그 종류의 칸만 검증하고 나머지는 무시한다(agentInputOf). 글(text)은 다듬지 않는다 — 공백도 입력이다
 */
export class AgentInputDto {
  @IsIn(AI_AGENT_INPUT_KINDS, { message: '조작은 click·type·key·scroll 중 하나예요' })
  kind!: AiAgentInputKind;

  @ValidateIf((o: AgentInputDto) => o.kind === 'click')
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  x?: number;

  @ValidateIf((o: AgentInputDto) => o.kind === 'click')
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  y?: number;

  @ValidateIf((o: AgentInputDto) => o.kind === 'type')
  @IsString()
  @IsNotEmpty({ message: '넣을 글을 적어 주세요' })
  @MaxLength(AI_AGENT_INPUT_TEXT_MAX)
  text?: string;

  @ValidateIf((o: AgentInputDto) => o.kind === 'key')
  @IsIn(AI_AGENT_INPUT_KEYS, { message: '보낼 수 없는 키예요' })
  key?: AiAgentInputKey;

  @ValidateIf((o: AgentInputDto) => o.kind === 'scroll')
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-AI_AGENT_INPUT_SCROLL_MAX)
  @Max(AI_AGENT_INPUT_SCROLL_MAX)
  deltaY?: number;
}

/** POST ai-assistant/browser/window (이슈 #433). 대화 열쇠의 빈 브라우저 탭을 미리 연다 */
export class BrowserWindowDto {
  @IsUUID('4', { message: '브라우저 대화 열쇠가 올바르지 않아요' })
  browserSessionId!: string;
}

/** 검증을 통과한 DTO에서 그 종류의 칸만 꺼낸다 */
export function agentInputOf(dto: AgentInputDto): AiAgentInput {
  switch (dto.kind) {
    case 'click':
      return { kind: 'click', x: dto.x ?? 0, y: dto.y ?? 0 };
    case 'type':
      return { kind: 'type', text: dto.text ?? '' };
    case 'key':
      return { kind: 'key', key: dto.key ?? 'Enter' };
    case 'scroll':
      return { kind: 'scroll', deltaY: dto.deltaY ?? 0 };
  }
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

  /** 대화마다 화면이 만든 열쇠. 같은 열쇠의 다음 질문은 열어 둔 브라우저 탭을 이어 쓴다 (이슈 #423) */
  @IsOptional()
  @IsUUID('4', { message: '브라우저 대화 열쇠가 올바르지 않아요' })
  browserSessionId?: string;

  /** 답마다 화면이 만든 열쇠. 답하는 동안 브라우저·화면 조작을 멈추고 이어 가게 한다 (이슈 #425) */
  @IsOptional()
  @IsUUID('4', { message: '멈춤 열쇠가 올바르지 않아요' })
  agentControlId?: string;

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

  /** Notion을 켠 질문이면 true. Notion이 연결돼 있고 상위 페이지가 정해져 있고 실시간 답 API일 때만 Notion 도구를 알린다 (이슈 #398) */
  @IsOptional()
  @IsBoolean()
  notion?: boolean;

  /** Drive를 켠 질문이면 true. Drive가 연결돼 있고 폴더가 정해져 있고 실시간 답 API일 때만 Drive 도구를 알린다 (이슈 #398 2단계) */
  @IsOptional()
  @IsBoolean()
  drive?: boolean;

  /** 입력칸에서 @로 고른 Drive 파일 id. 실시간 답 API에서만 읽어 질문에 붙인다 (이슈 #398 2단계) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_DRIVE_ATTACH_MAX, { message: `Drive 파일은 ${AI_DRIVE_ATTACH_MAX}개까지 붙일 수 있어요` })
  @ArrayUnique({ message: '같은 파일을 두 번 붙일 수 없어요' })
  @Matches(/^[A-Za-z0-9_-]{10,200}$/, { each: true, message: 'Drive 파일 id가 올바르지 않아요' })
  driveFileIds?: string[];
}

/** Notion 페이지 고치기 한 군데 (이슈 #398) */
export class AiNotionTextEditDto {
  @IsString()
  @MinLength(1, { message: '바꿀 글을 입력해 주세요' })
  @MaxLength(AI_NOTION_EDIT_TEXT_MAX)
  oldStr!: string;

  @IsString()
  @MaxLength(AI_NOTION_EDIT_TEXT_MAX)
  newStr!: string;
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

const CARD_KINDS = ['TASK', 'EVENT', 'PURCHASE', 'SALES_ORDER', 'HOT_ROLLING', 'HEAT_PLAN', 'PAST_CASE', 'NOTION_PAGE_CREATE', 'NOTION_PAGE_APPEND', 'NOTION_PAGE_UPDATE', 'SCHEDULE_EVENT_UPDATE', 'TASK_UPDATE', 'RESEARCH'] as const;

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

  // Notion 페이지 만들기·더하기·고치기 (이슈 #398). 대상이 상위 페이지 아래인지는 service가 Notion을 읽어 다시 본다
  @IsOptional()
  @IsUUID('4', { message: '카드 번호가 올바르지 않아요' })
  nonce?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notionPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_NOTION_TITLE_MAX, { message: `페이지 제목은 ${AI_NOTION_TITLE_MAX}자까지 쓸 수 있어요` })
  pageTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_NOTION_CONTENT_MAX, { message: `내용은 ${AI_NOTION_CONTENT_MAX}자까지 쓸 수 있어요` })
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_NOTION_EDIT_MAX, { message: `고칠 곳은 ${AI_NOTION_EDIT_MAX}군데까지예요` })
  @ValidateNested({ each: true })
  @Type(() => AiNotionTextEditDto)
  edits?: AiNotionTextEditDto[];

  // 일정·업무 고치기 (이슈 #398). 제목·설명·시각·마감일은 위 업무·일정 칸을 같이 쓴다
  @IsOptional()
  @IsInt({ message: '일정이 올바르지 않아요' })
  @Min(1)
  @Max(2147483647)
  scheduleEventId?: number;

  @IsOptional()
  @IsInt({ message: '업무가 올바르지 않아요' })
  @Min(1)
  @Max(2147483647)
  taskId?: number;

  @IsOptional()
  @IsBoolean()
  complete?: boolean;

  // 심층 조사 만들기 (이슈 #408). seed는 조사 만들기 API와 같은 검증
  @IsOptional()
  @IsString()
  @MaxLength(AI_RESEARCH_LIMITS.questionMax, { message: `질문은 ${AI_RESEARCH_LIMITS.questionMax}자까지 쓸 수 있어요` })
  question?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiResearchSeedDto)
  seed?: AiResearchSeedDto;
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
