import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { NumericInput } from './numeric';

export class UpdateRoutingYieldDto {
  /** null = 수율 없음 (열연·제선). 그 밖에는 0 초과 1 이하 */
  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: '계획 수율은 0보다 크고 1 이하여야 합니다' })
  @Max(1, { message: '계획 수율은 0보다 크고 1 이하여야 합니다' })
  plannedYieldRate?: number | null;
}
