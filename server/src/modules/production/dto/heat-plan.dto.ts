import { IsInt, IsOptional, Min } from 'class-validator';

/** 히트 편성 미리보기·확정 공통 입력. */
export class HeatPlanDto {
  /** 코일 계획에서 새로 만들지 않고 여재 슬래브로 채울 매수 (기본 0) */
  @IsOptional() @IsInt({ message: '여재 사용 매수는 0 이상의 정수로 입력해 주세요' }) @Min(0, { message: '여재 사용 매수는 0 이상의 정수로 입력해 주세요' })
  surplusUseQty?: number;
}
