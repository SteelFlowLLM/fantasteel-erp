import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ACTOR_TYPE, BUSINESS_EVENT_SORT, BUSINESS_EVENT_TYPE, type ActorType, type BusinessEventSort, type BusinessEventType } from '@fantasteel/shared';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 작업 로그 조건 (API-238, docs/backend/business-event.md 3장·구현 메모).
 * salesOrderId = 수주 타임라인, lotId = LOT 타임라인(business_event_lot). 기간은 서울 날짜로 시작·끝을 포함한다.
 * 정렬은 기본 오래된 순(이력 재현), sort=desc면 최신순. 같은 시각이면 이벤트 id 순.
 */
export class ListBusinessEventsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '수주 id는 정수여야 해요' })
  @Min(1, { message: '수주 id는 1 이상이어야 해요' })
  salesOrderId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'LOT id는 정수여야 해요' })
  @Min(1, { message: 'LOT id는 1 이상이어야 해요' })
  lotId?: number;

  @IsOptional()
  @IsIn(Object.values(BUSINESS_EVENT_TYPE), { message: '이벤트 유형이 올바르지 않아요' })
  businessEventType?: BusinessEventType;

  @IsOptional()
  @IsIn(Object.values(ACTOR_TYPE), { message: '주체 구분은 USER 또는 SYSTEM이에요' })
  actorType?: ActorType;

  /** 대상 테이블명 (ERD 이름, 예: sales_order) */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z_]+$/, { message: '대상 테이블명이 올바르지 않아요' })
  targetType?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: '시작일은 YYYY-MM-DD로 입력해 주세요' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: '종료일은 YYYY-MM-DD로 입력해 주세요' })
  to?: string;

  @IsOptional()
  @IsIn(Object.values(BUSINESS_EVENT_SORT), { message: 'sort는 asc 또는 desc예요' })
  sort: BusinessEventSort = BUSINESS_EVENT_SORT.ASC;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 1 이상의 정수여야 합니다' })
  @Min(1, { message: 'page는 1 이상의 정수여야 합니다' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 1~100 사이 정수여야 합니다' })
  @Min(1, { message: 'size는 1~100 사이 정수여야 합니다' })
  @Max(100, { message: 'size는 1~100 사이 정수여야 합니다' })
  size: number = 20;
}
