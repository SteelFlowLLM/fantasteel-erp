import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { SHIPMENT_REQUEST_STATUS, type ShipmentRequestStatus } from '@fantasteel/shared';

export class ListShipmentRequestsDto {
  @IsOptional()
  @IsIn(Object.values(SHIPMENT_REQUEST_STATUS), { message: `status는 ${Object.values(SHIPMENT_REQUEST_STATUS).join(', ')} 중 하나여야 합니다` })
  status?: ShipmentRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  salesOrderId?: number;

  /** 출하 요청일 범위 (YYYY-MM-DD, 양 끝 포함) */
  @IsOptional()
  @IsDateString()
  shipFrom?: string;

  @IsOptional()
  @IsDateString()
  shipTo?: string;

  /** 출하번호·고객사명·수주번호 부분 일치 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

export class ListShippableDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  salesOrderId?: number;
}
