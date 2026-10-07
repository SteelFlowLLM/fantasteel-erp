import { IsInt, IsOptional, Matches, Min } from 'class-validator';

/** API-188. 보내지 않은 값은 그대로 둔다 (REQ-MST-009) */
export class UpdateProductionSettingDto {
  /** 용강 기준 톤, decimal(12,3). 0보다 큰지는 service가 본다 */
  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/, { message: '히트 용량은 소수 3자리까지의 톤으로 입력해 주세요' })
  heatCapacityTon?: string;

  @IsOptional()
  @IsInt({ message: '납기 위험 기준일은 0 이상의 정수예요' })
  @Min(0, { message: '납기 위험 기준일은 0 이상의 정수예요' })
  deliveryRiskDays?: number;
}
