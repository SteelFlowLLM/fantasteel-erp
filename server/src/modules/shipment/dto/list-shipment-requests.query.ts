import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

  /** 출하요청 번호 일부 (대소문자 무시) */
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '출하요청 번호는 30자까지 입력해 주세요' })
  shipmentRequestNo?: string;

  /** true면 목록 줄마다 상세(품목·배정)를 함께 준다. 화면이 줄마다 상세를 따로 부르지 않게 한다 (이슈 #476) */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'withItems는 true 또는 false여야 합니다' })
  withItems?: boolean;

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
