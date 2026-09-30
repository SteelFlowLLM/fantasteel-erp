import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { NumericInput } from './numeric';

export class UpdateProductionSettingDto {
  /** 히트 용량(t). 0보다 커야 한다 */
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001, { message: '히트 용량은 0보다 커야 합니다' })
  @Max(100000)
  heatCapacityTon: number;

  /** 납기 위험 기준일. 0 이상의 정수 */
  @IsInt({ message: '납기 위험 기준일은 0 이상의 정수로 입력해 주세요' })
  @Min(0, { message: '납기 위험 기준일은 0 이상의 정수로 입력해 주세요' })
  @Max(365)
  deliveryRiskDays: number;
}
