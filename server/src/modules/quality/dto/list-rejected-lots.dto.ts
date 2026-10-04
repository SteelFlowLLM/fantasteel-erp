import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListRejectedLotsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 해요' })
  @Min(1, { message: 'page는 1 이상이어야 해요' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 해요' })
  @Min(1, { message: 'size는 1 이상이어야 해요' })
  @Max(100, { message: 'size는 100 이하여야 해요' })
  size?: number;
}
