import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  customerName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
