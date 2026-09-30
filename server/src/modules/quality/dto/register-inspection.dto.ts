import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class InspectionValueDto {
  /** 검사 항목 코드. 성분 검사는 원소 코드(C, Si, Mn, P, S) */
  @IsString() @MinLength(1) @MaxLength(50)
  inspectionItemCode: string;

  /** 측정값 (숫자 또는 숫자 문자열, 소수 4자리까지) */
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^-?\d{1,8}(\.\d{1,4})?$/, { message: '측정값은 숫자(소수 4자리까지)로 입력해 주세요' })
  measuredValue: string;
}

export class RegisterInspectionDto {
  @IsInt()
  lotId: number;

  @IsArray() @ArrayMinSize(1, { message: '측정값을 입력해 주세요' }) @ValidateNested({ each: true }) @Type(() => InspectionValueDto)
  values: InspectionValueDto[];

  @IsOptional() @IsString() @MaxLength(500)
  memo?: string;
}
