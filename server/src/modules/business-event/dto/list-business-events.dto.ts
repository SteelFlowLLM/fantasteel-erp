import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ACTOR_TYPE, BUSINESS_EVENT_TYPE, EVENT_TARGET_TYPE, type ActorType, type BusinessEventType, type EventTargetType } from '@fantasteel/shared';

export class ListBusinessEventsDto {
  /** 수주 타임라인 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'salesOrderId는 정수여야 합니다' })
  @Min(1, { message: 'salesOrderId는 1 이상이어야 합니다' })
  salesOrderId?: number;

  /** LOT 타임라인 (이벤트의 lot_ids에 이 LOT이 들어 있는 것) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'lotId는 정수여야 합니다' })
  @Min(1, { message: 'lotId는 1 이상이어야 합니다' })
  lotId?: number;

  /** lotId와 함께: 이 LOT의 조상·자손 LOT의 이벤트도 포함 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean({ message: 'includeLineage는 true 또는 false여야 합니다' })
  includeLineage?: boolean;

  @IsOptional()
  @IsIn(Object.values(BUSINESS_EVENT_TYPE), { message: 'eventType 값이 올바르지 않습니다' })
  eventType?: BusinessEventType;

  @IsOptional()
  @IsIn(Object.values(ACTOR_TYPE), { message: 'actorType은 USER 또는 SYSTEM이어야 합니다' })
  actorType?: ActorType;

  @IsOptional()
  @IsIn(Object.values(EVENT_TARGET_TYPE), { message: 'targetType 값이 올바르지 않습니다' })
  targetType?: EventTargetType;

  /** ISO 8601 시각 또는 YYYY-MM-DD (날짜만 주면 한국 시간 그날 00:00부터) */
  @IsOptional()
  @IsDateString({}, { message: 'from은 ISO 8601 시각 또는 YYYY-MM-DD 형식이어야 합니다' })
  from?: string;

  /** ISO 8601 시각 또는 YYYY-MM-DD (날짜만 주면 한국 시간 그날 끝까지 포함) */
  @IsOptional()
  @IsDateString({}, { message: 'to는 ISO 8601 시각 또는 YYYY-MM-DD 형식이어야 합니다' })
  to?: string;

  /** 요약·대상 번호에 포함된 글자 */
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '검색어는 100자 이하로 입력해 주세요' })
  q?: string;

  /** 이전 응답의 nextCursor */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'cursor는 정수여야 합니다' })
  @Min(1, { message: 'cursor는 1 이상이어야 합니다' })
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다' })
  @Min(1, { message: 'limit는 1 이상이어야 합니다' })
  @Max(500, { message: 'limit는 500 이하여야 합니다' })
  limit?: number;

  /** 생략: 수주·LOT 지정이면 asc(시간순 타임라인), 아니면 desc(최근순) */
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order는 asc 또는 desc여야 합니다' })
  order?: 'asc' | 'desc';
}
