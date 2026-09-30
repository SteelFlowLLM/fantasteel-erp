import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { NumericInput } from './numeric';

/**
 * 배합 원단위 저장 (있으면 수정, 없으면 등록).
 * 철광석·석탄·석회석: steelGradeId 없음(공통), 단위 t/t. 합금철: steelGradeId 필수, 단위 kg/t. 단위는 원료 종류로 서버가 정한다.
 */
export class UpsertSpecificConsumptionDto {
  @IsInt()
  rawMaterialId: number;

  @IsOptional()
  @IsInt()
  steelGradeId?: number | null;

  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: '원단위는 0보다 커야 합니다' })
  @Max(100000)
  consumptionRate: number;
}
