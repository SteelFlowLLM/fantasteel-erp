import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SearchLotsDto {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '검색어는 60자 이하로 입력해 주세요' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit는 정수여야 합니다' })
  @Min(1, { message: 'limit는 1 이상이어야 합니다' })
  @Max(50, { message: 'limit는 50 이하여야 합니다' })
  limit?: number;
}
