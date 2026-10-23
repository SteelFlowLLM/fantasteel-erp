import { IsDateString, IsInt, IsOptional, Matches, Min } from 'class-validator';

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

  /** 불러온 시각. 그 사이 다른 사람이 고쳤으면 COM-001 (이슈 #498). 보내지 않으면 비교하지 않는다 */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'expectedUpdatedAt은 시각(ISO 8601)으로 보내 주세요' })
  expectedUpdatedAt?: string | null;
}
