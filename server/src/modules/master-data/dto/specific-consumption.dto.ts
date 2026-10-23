import { IsInt, IsOptional, Matches } from 'class-validator';

/** 원단위 decimal(12,4): 정수 8자리·소수 4자리까지 (0보다 큰지는 service가 본다) */
const CONSUMPTION_RATE = /^\d{1,8}(\.\d{1,4})?$/;

/** API-176. 강종 null = 용선 1t당 t(철광석·석탄·석회석), 강종 있음 = 용강 1t당 합금철 kg (REQ-MST-006) */
export class CreateSpecificConsumptionDto {
  @IsInt({ message: '원료를 골라 주세요' })
  rawMaterialItemId!: number;

  @IsOptional()
  @IsInt({ message: '강종을 골라 주세요' })
  steelGradeId?: number | null;

  @Matches(CONSUMPTION_RATE, { message: '원단위는 소수 4자리까지의 숫자로 입력해 주세요' })
  consumptionRate!: string;
}

/** API-177. 원료·강종은 바꾸지 않는다 */
export class UpdateSpecificConsumptionDto {
  @Matches(CONSUMPTION_RATE, { message: '원단위는 소수 4자리까지의 숫자로 입력해 주세요' })
  consumptionRate!: string;
}
