import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { NumericInput } from './numeric';

/** 성분 규격 1개. 값은 % 단위. min·max 중 하나는 있어야 한다. */
export class CompositionSpecInputDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,9}$/, { message: '성분 기호는 영문으로 시작하는 10자 이내로 입력해 주세요 (예: C, Si, Mn)' })
  elementCode: string;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  minValue?: number | null;

  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  maxValue?: number | null;

  /** 생략하면 배열 순서(등록 시·교체 시) 또는 기존 값(부분 수정 시)을 쓴다 */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
