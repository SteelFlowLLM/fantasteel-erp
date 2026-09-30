import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateShipmentRequestItemDto {
  @IsInt({ message: '출하할 수주 품목을 선택해 주세요' })
  salesOrderItemId: number;

  /** 출하 매수 (슬래브 매, 코일 개) */
  @IsInt({ message: '출하 매수는 1 이상의 정수로 입력해 주세요' })
  @Min(1, { message: '출하 매수는 1 이상의 정수로 입력해 주세요' })
  requestQty: number;
}

export class CreateShipmentRequestDto {
  @IsInt({ message: '고객사를 선택해 주세요' })
  customerId: number;

  /** 출하 요청일 (YYYY-MM-DD) */
  @IsDateString({}, { message: '출하 요청일은 YYYY-MM-DD 형식으로 입력해 주세요' })
  requestedShipDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '메모는 500자 이하로 입력해 주세요' })
  memo?: string;

  @IsArray({ message: '출하할 수주 품목을 1건 이상 넣어 주세요' })
  @ArrayMinSize(1, { message: '출하할 수주 품목을 1건 이상 넣어 주세요' })
  @ArrayUnique((i: CreateShipmentRequestItemDto) => i?.salesOrderItemId, { message: '같은 수주 품목을 한 출하요청에 두 번 넣을 수 없습니다' })
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentRequestItemDto)
  items: CreateShipmentRequestItemDto[];
}
