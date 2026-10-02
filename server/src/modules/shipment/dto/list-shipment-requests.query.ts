import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SHIPMENT_REQUEST_STATUS, type ShipmentRequestStatus } from '@fantasteel/shared';

/** 출하요청 목록 조건. 페이징은 page·size (컨벤션 5장), 최신 등록순 */
export class ListShipmentRequestsQuery {
  @IsOptional()
  @IsIn(Object.values(SHIPMENT_REQUEST_STATUS), { message: '출하요청 상태 값이 올바르지 않습니다' })
  shipmentRequestStatus?: ShipmentRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '고객사 id는 정수여야 합니다' })
  customerId?: number;

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
