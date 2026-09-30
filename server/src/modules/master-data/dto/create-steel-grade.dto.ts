import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CompositionSpecInputDto } from './composition-spec-input.dto';

export class CreateSteelGradeDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,19}$/, { message: '강종 코드는 영문 대문자·숫자·- 로 20자 이내로 입력해 주세요' })
  steelGradeCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  steelGradeName: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  standardNo?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CompositionSpecInputDto)
  compositionSpecs?: CompositionSpecInputDto[];
}
