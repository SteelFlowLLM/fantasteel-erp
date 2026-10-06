import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LOT_STATUS, LOT_TYPE, TRACE_DIRECTION, type LotStatus, type LotType, type TraceDirection } from '@fantasteel/shared';

/** LOT 목록 조건 (API-235). 페이징 page·size, 생산완료일 최근 순 */
export class ListLotsQuery {
  @IsOptional()
  @IsIn(Object.values(LOT_TYPE), { message: 'LOT 유형이 올바르지 않아요' })
  lotType?: LotType;

  @IsOptional()
  @IsIn(Object.values(LOT_STATUS), { message: 'LOT 상태가 올바르지 않아요' })
  lotStatus?: LotStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '규격 id는 정수여야 합니다' })
  itemId?: number;

  /** LOT 번호 앞부분 (대소문자 구분 없음) */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lotNo?: string;

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

/** LOT 추적 조건 (API-237). direction을 생략하면 LOT 유형에 맞춰 정한다(코일·슬래브 = 역추적, 나머지 = 정추적) */
export class TraceLotQuery {
  @IsOptional()
  @IsIn(Object.values(TRACE_DIRECTION), { message: 'direction은 backward 또는 forward예요' })
  direction?: TraceDirection;
}
