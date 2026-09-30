import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, Matches, Min } from 'class-validator';

const FACILITY_NO = /^[A-Za-z0-9]{1,4}$/;

/** 공정 실적 완료 입력. 공정별로 쓰는 값이 다르다 (service에서 필수값을 검사한다). */
export class CompleteProductionResultDto {
  /** 제선: 고로 번호 */
  @IsOptional() @Matches(FACILITY_NO, { message: '고로 번호는 영문·숫자 4자 이내로 입력해 주세요' })
  blastFurnaceNo?: string;

  /** 제선: 용선량(t, 소수 3자리까지). 비우면 이 계획에 아직 필요한 양 */
  @IsOptional() @Transform(({ value }) => (typeof value === 'number' ? String(value) : value)) @Matches(/^\d{1,8}(\.\d{1,3})?$/, { message: '용선량은 0보다 큰 톤(소수 3자리까지)으로 입력해 주세요' })
  hotMetalTon?: string;

  /** 제강: 전로 번호 */
  @IsOptional() @Matches(FACILITY_NO, { message: '전로 번호는 영문·숫자 4자 이내로 입력해 주세요' })
  converterNo?: string;

  /** 연주: 슬래브 생산 매수 (0 이상, 히트당 계획 매수 이하) */
  @IsOptional() @IsInt({ message: '슬래브 생산 매수는 0 이상의 정수로 입력해 주세요' }) @Min(0, { message: '슬래브 생산 매수는 0 이상의 정수로 입력해 주세요' })
  outputQty?: number;

  /** 열연: 투입할 CONFIRMED 열연 배정 id. 비우면 이 계획의 CONFIRMED 열연 배정 전부 */
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsInt({ each: true })
  allocationIds?: number[];
}
