import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** 밀시트 목록 조건 (API-232: shipmentRequestId·salesOrderId). 페이징은 page·size, 최신 발행순 */
export class ListMillSheetsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '출하요청 id는 정수여야 합니다' })
  shipmentRequestId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '수주 id는 정수여야 합니다' })
  salesOrderId?: number;

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
