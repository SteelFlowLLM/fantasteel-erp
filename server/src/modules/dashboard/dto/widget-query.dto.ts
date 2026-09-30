import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class WidgetQueryDto {
  /** 기간(일): REJECT_RATE 기본 30, SHIPMENT_RESULT·PRODUCTION_VOLUME 기본 14 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days는 정수여야 합니다' })
  @Min(1, { message: 'days는 1 이상이어야 합니다' })
  @Max(90, { message: 'days는 90 이하여야 합니다' })
  days?: number;

  /** 목록 위젯의 최대 행 수 (RECENT_EVENTS 기본 10, 그 밖의 목록 위젯 기본 20) */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다' })
  @Min(1, { message: 'limit는 1 이상이어야 합니다' })
  @Max(50, { message: 'limit는 50 이하여야 합니다' })
  limit?: number;
}
