import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import { YARD_TYPE, type YardType } from '@fantasteel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
/** 코드: 영문 대문자·숫자로 시작하고 대문자·숫자·밑줄·하이픈 (예: CUS-05, YD-CL-02) */
const CODE = /^[A-Z0-9][A-Z0-9_-]*$/;

/** API-179 */
export class CreateCustomerDto {
  @Transform(upper)
  @Matches(CODE, { message: '고객사 코드는 영문 대문자·숫자·하이픈으로 입력해 주세요 (예: CUS-05)' })
  customerCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '고객사명을 입력해 주세요' })
  customerName!: string;
}

/** API-180. 코드는 만든 뒤 바꾸지 않는다 */
export class UpdateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '고객사명을 입력해 주세요' })
  customerName!: string;
}

/** API-182. 품목별 기본 공급업체는 품목 수정(API-167)에서 지정한다 */
export class CreateSupplierDto {
  @Transform(upper)
  @Matches(CODE, { message: '공급업체 코드는 영문 대문자·숫자·하이픈으로 입력해 주세요 (예: SUP-05)' })
  supplierCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '공급업체명을 입력해 주세요' })
  supplierName!: string;
}

/** API-183. 코드는 만든 뒤 바꾸지 않는다 */
export class UpdateSupplierDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '공급업체명을 입력해 주세요' })
  supplierName!: string;
}

/** API-185. 야드 안 위치는 관리하지 않는다 (REQ-MST-008) */
export class CreateYardDto {
  @Transform(upper)
  @Matches(CODE, { message: '야드 코드는 영문 대문자·숫자·하이픈으로 입력해 주세요 (예: YD-CL-02)' })
  yardCode!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '야드명을 입력해 주세요' })
  yardName!: string;

  @IsIn(Object.values(YARD_TYPE), { message: '야드 유형을 골라 주세요' })
  yardType!: YardType;
}

/** API-186. 코드·야드 유형은 만든 뒤 바꾸지 않는다 (품목 기본 야드·LOT가 유형에 맞게 쓰고 있음) */
export class UpdateYardDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '야드명을 입력해 주세요' })
  yardName!: string;
}
