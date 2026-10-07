import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ITEM_TYPE, RAW_MATERIAL_TYPE, type ItemType, type RawMaterialType } from '@fantasteel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
/** 원료 코드: 영문 3자 + 숫자 2자리 (REQ-MST-001, 예: ORE01) */
const RAW_MATERIAL_CODE = /^[A-Z]{3}\d{2}$/;
/** 치수 decimal(8,2): 정수 6자리·소수 2자리까지 */
const DIMENSION_MM = /^\d{1,6}(\.\d{1,2})?$/;
const isRawMaterial = (o: { itemType?: ItemType }) => o.itemType === ITEM_TYPE.RAW_MATERIAL;

/**
 * API-166. 원료는 원료 코드·이름·원료 유형, 슬래브·코일은 강종·치수를 받는다.
 * 규격 코드·품목명·단위·1매 이론중량은 서버가 만든다 (REQ-MST-001·003, master-data.md 4장).
 */
export class CreateItemDto {
  @IsIn(Object.values(ITEM_TYPE), { message: '품목 유형 값이 올바르지 않습니다' })
  itemType!: ItemType;

  @ValidateIf(isRawMaterial)
  @Transform(upper)
  @Matches(RAW_MATERIAL_CODE, { message: '원료 코드는 영문 대문자 3자 + 숫자 2자리예요 (예: ORE01)' })
  itemCode?: string;

  @ValidateIf(isRawMaterial)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '원료명을 입력해 주세요' })
  itemName?: string;

  @ValidateIf(isRawMaterial)
  @IsIn(Object.values(RAW_MATERIAL_TYPE), { message: '원료 유형을 골라 주세요' })
  rawMaterialType?: RawMaterialType;

  @ValidateIf((o: CreateItemDto) => !isRawMaterial(o))
  @IsInt({ message: '강종을 골라 주세요' })
  steelGradeId?: number;

  @ValidateIf((o: CreateItemDto) => !isRawMaterial(o))
  @Matches(DIMENSION_MM, { message: '두께는 소수 2자리까지의 mm로 입력해 주세요' })
  thicknessMm?: string;

  @ValidateIf((o: CreateItemDto) => !isRawMaterial(o))
  @Matches(DIMENSION_MM, { message: '폭은 소수 2자리까지의 mm로 입력해 주세요' })
  widthMm?: string;

  @ValidateIf((o: CreateItemDto) => !isRawMaterial(o))
  @Matches(DIMENSION_MM, { message: '길이는 소수 2자리까지의 mm로 입력해 주세요' })
  lengthMm?: string;

  @IsInt({ message: '기본 야드를 골라 주세요' })
  defaultYardId!: number;

  /** 원료만 */
  @IsOptional()
  @IsInt({ message: '기본 공급업체를 골라 주세요' })
  defaultSupplierId?: number | null;
}

/**
 * API-167. 보내지 않은 값은 그대로 둔다. 품목 유형·원료 코드·원료 유형은 바꾸지 않는다.
 * 원료는 이름·기본 야드·기본 공급업체(null이면 비움), 규격은 강종·치수·기본 야드를 바꾼다.
 */
export class UpdateItemDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '원료명을 입력해 주세요' })
  itemName?: string;

  @IsOptional()
  @IsInt({ message: '강종을 골라 주세요' })
  steelGradeId?: number;

  @IsOptional()
  @Matches(DIMENSION_MM, { message: '두께는 소수 2자리까지의 mm로 입력해 주세요' })
  thicknessMm?: string;

  @IsOptional()
  @Matches(DIMENSION_MM, { message: '폭은 소수 2자리까지의 mm로 입력해 주세요' })
  widthMm?: string;

  @IsOptional()
  @Matches(DIMENSION_MM, { message: '길이는 소수 2자리까지의 mm로 입력해 주세요' })
  lengthMm?: string;

  @IsOptional()
  @IsInt({ message: '기본 야드를 골라 주세요' })
  defaultYardId?: number;

  @IsOptional()
  @IsInt({ message: '기본 공급업체를 골라 주세요' })
  defaultSupplierId?: number | null;
}
