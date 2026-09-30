import { IsIn, IsOptional } from 'class-validator';

export const TRACE_DIRECTION = { BACKWARD: 'backward', FORWARD: 'forward' } as const;
export type TraceDirection = (typeof TRACE_DIRECTION)[keyof typeof TRACE_DIRECTION];

export class TraceLotDto {
  /** 생략하면 backward(역추적) */
  @IsOptional()
  @IsIn(Object.values(TRACE_DIRECTION), { message: 'direction은 backward 또는 forward여야 합니다' })
  direction?: TraceDirection;
}
