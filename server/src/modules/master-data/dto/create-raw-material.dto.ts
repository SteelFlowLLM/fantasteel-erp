import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RAW_MATERIAL_TYPE } from '@fantasteel/shared';

export class CreateRawMaterialDto {
  /** LOT 번호(RM-원료코드-YYMMDD-NNN)에 들어가는 코드. 등록 뒤에는 바꿀 수 없다. */
  @IsString()
  @Matches(/^[A-Z0-9]{1,10}$/, { message: '원료 코드는 영문 대문자·숫자 10자 이내로 입력해 주세요' })
  materialCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  itemName: string;

  @IsIn(Object.values(RAW_MATERIAL_TYPE))
  rawMaterialType: string;

  @IsOptional()
  @IsInt()
  yardId?: number | null;

  @IsOptional()
  @IsInt()
  defaultSupplierId?: number | null;
}
