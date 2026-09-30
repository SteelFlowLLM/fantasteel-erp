import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 강종 코드는 규격 코드·LOT에 쓰이므로 바꿀 수 없다. */
export class UpdateSteelGradeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  steelGradeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  standardNo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
