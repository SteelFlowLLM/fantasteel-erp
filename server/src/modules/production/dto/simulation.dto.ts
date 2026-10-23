import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_RANDOM_SEED } from '../simulation.calculator';

export class SimulateResultsDto {
  /** 재현 가능한 난수 시드 (04 8장). 없으면 지금 시각으로 정하고 결과에 돌려준다 */
  @IsOptional()
  @IsInt({ message: '난수 시드는 정수여야 해요' })
  @Min(0, { message: '난수 시드는 0 이상이어야 해요' })
  @Max(MAX_RANDOM_SEED, { message: `난수 시드는 ${MAX_RANDOM_SEED} 이하여야 해요` })
  randomSeed?: number;
}
