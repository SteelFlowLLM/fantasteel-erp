import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PROCESS_CODE } from '@fantasteel/shared';

/** 실적 시뮬레이션 (REQ-PRD-007). */
export class SimulateResultsDto {
  /** 난수 시드. 같은 시드면 같은 손실률이 나온다. 비우면 서버가 정해 응답에 돌려준다 */
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647)
  seed?: number;

  /** 검사까지 자동 합격값으로 등록할지 (기본 true) */
  @IsOptional() @IsBoolean()
  includeInspection?: boolean;

  /** 이 공정까지만 진행 (비우면 끝까지) */
  @IsOptional() @IsIn(Object.values(PROCESS_CODE))
  untilProcess?: string;
}
