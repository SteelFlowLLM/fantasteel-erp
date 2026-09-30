import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 원료 코드·원료 종류는 LOT 채번과 배합 원단위가 참조하므로 바꿀 수 없다. */
export class UpdateRawMaterialDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  itemName?: string;

  @IsOptional()
  @IsInt()
  yardId?: number | null;

  @IsOptional()
  @IsInt()
  defaultSupplierId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
