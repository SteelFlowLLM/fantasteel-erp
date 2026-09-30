import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ITEM_TYPE, UNIT_TYPE } from '@fantasteel/shared';

/** 슬래브·코일 품목 등록. 원료는 POST /raw-materials 로 등록한다. */
export class CreateItemDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, { message: '품목 코드는 영문 대문자·숫자·-·_ 로 30자 이내로 입력해 주세요' })
  itemCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  itemName: string;

  @IsIn(Object.values(ITEM_TYPE))
  itemType: string;

  /** 생략하면 품목 유형에서 정한다 (제품 QTY, 원료 TON). 유형과 맞지 않으면 거부한다. */
  @IsOptional()
  @IsIn(Object.values(UNIT_TYPE))
  unitType?: string;

  @IsOptional()
  @IsInt()
  defaultSupplierId?: number | null;
}
