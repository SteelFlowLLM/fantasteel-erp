import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  itemName?: string;

  /** null = 기본 공급업체 해제 */
  @IsOptional()
  @IsInt()
  defaultSupplierId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
