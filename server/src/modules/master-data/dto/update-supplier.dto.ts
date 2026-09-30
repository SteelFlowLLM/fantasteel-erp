import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  supplierName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
