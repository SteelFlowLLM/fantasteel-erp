import { Type } from 'class-transformer';
import { Allow, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class CreateSalesOrderItemDto {
  // 규격·수량은 업무 에러 코드(SO-001·SO-002)로 답해야 해서 service에서 검증한다.
  // 여기서 숫자로 바꾸면 10.5가 걸러지기 전에 모양이 달라질 수 있어 받은 값 그대로 둔다.
  @Allow()
  productSpecId: unknown;

  @Allow()
  orderedQty: unknown;
}

export class CreateSalesOrderDto {
  @IsInt({ message: '고객사를 선택해 주세요' })
  customerId: number;

  /** 납기 (YYYY-MM-DD) */
  @IsDateString({}, { message: '납기는 YYYY-MM-DD 형식으로 입력해 주세요' })
  dueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '비고는 500자 이하로 입력해 주세요' })
  note?: string;

  @IsArray({ message: '수주 품목을 1건 이상 입력해 주세요' })
  @ArrayMinSize(1, { message: '수주 품목을 1건 이상 입력해 주세요' })
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items: CreateSalesOrderItemDto[];
}
