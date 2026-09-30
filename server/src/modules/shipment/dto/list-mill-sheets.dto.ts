import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListMillSheetsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  salesOrderId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  goodsIssueId?: number;

  /** 발행일 범위 (YYYY-MM-DD, 양 끝 포함, Asia/Seoul) */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** 밀시트 번호 부분 일치 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
