import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsISO8601, IsOptional, Matches, Min, ValidateNested } from 'class-validator';

export class CreateShipmentRequestItemDto {
  @IsInt({ message: '수주 품목 id는 정수여야 합니다' })
  @Min(1, { message: '수주 품목 id는 1 이상이어야 합니다' })
  salesOrderItemId!: number;

  @IsInt({ message: '요청 매수는 1 이상의 정수로 입력해 주세요' })
  @Min(1, { message: '요청 매수는 1 이상의 정수로 입력해 주세요' })
  requestQty!: number;
}

/** 출하요청 등록 (REQ-SHP-001). 같은 고객사의 수주 품목만 묶는다 */
export class CreateShipmentRequestDto {
  @IsInt({ message: '고객사 id는 정수여야 합니다' })
  @Min(1, { message: '고객사 id는 1 이상이어야 합니다' })
  customerId!: number;

  /** 출하 예정일 (ERD에서 선택 값) */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '출하 예정일은 YYYY-MM-DD 형식으로 입력해 주세요' })
  @IsISO8601({ strict: true }, { message: '출하 예정일이 올바른 날짜가 아닙니다' })
  shipDate?: string;

  @IsArray({ message: '출하요청 품목을 하나 이상 넣어 주세요' })
  @ArrayNotEmpty({ message: '출하요청 품목을 하나 이상 넣어 주세요' })
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentRequestItemDto)
  items!: CreateShipmentRequestItemDto[];
}
