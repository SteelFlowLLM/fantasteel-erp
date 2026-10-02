import { Type } from 'class-transformer';
import { Allow, ArrayNotEmpty, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class SalesOrderItemInput {
  @IsInt({ message: '규격을 골라 주세요' })
  itemId!: number;

  /**
   * 매수. 정수가 아니거나 1 미만이면 SO-002여야 해서(업무 프로세스 14.3) DTO 검증(COM-004)을 걸지 않고 service에서 본다.
   * 톤을 매수로 바꾸거나 반올림하지 않는다 (4.1).
   */
  @Allow()
  orderedQty!: unknown;

  /** 품목 납기 'YYYY-MM-DD' (ERD: 납기는 수주 품목 단위) */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '납기는 YYYY-MM-DD로 입력해 주세요' })
  dueDate!: string;
}

export class CreateSalesOrderDto {
  @IsInt({ message: '고객사를 골라 주세요' })
  customerId!: number;

  @ArrayNotEmpty({ message: '품목을 하나 이상 넣어 주세요' })
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemInput)
  items!: SalesOrderItemInput[];
}

export class CancelSalesOrderDto {
  /** 취소 사유. sales_order에 사유 컬럼이 없어 작업 로그 reason에만 남긴다 */
  @IsString()
  @IsNotEmpty({ message: '취소 사유를 입력해 주세요' })
  @MaxLength(200, { message: '취소 사유는 200자까지 쓸 수 있어요' })
  reason!: string;
}

export class ListSalesOrdersQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
