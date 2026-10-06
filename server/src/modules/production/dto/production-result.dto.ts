import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PROCESS_TYPE, type ProcessType } from '@fantasteel/shared';

/** 고로·전로 코드: 대문자·숫자 2~10자 (예: BF2, BOF1). 설비 마스터는 없다 (BP-PRD-02) */
export const EQUIPMENT_CODE = /^[A-Z0-9]{2,10}$/;
/** 톤: 양수, 소수 3자리까지 */
export const TON = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;

/** 공정별로 쓰는 칸 (서비스에서 공정에 맞는지 확인한다) */
class WorkOutputFields {
  /** 연주: 연주할 히트 */
  @IsOptional()
  @IsInt({ message: '히트 id는 정수여야 해요' })
  @Min(1, { message: '히트 id는 1 이상이어야 해요' })
  heatLotId?: number;

  /** 제선: 용선량(t) */
  @IsOptional()
  @Matches(TON, { message: '용선량은 소수 3자리까지의 톤으로 입력해 주세요' })
  hotMetalTon?: string;

  /** 제강: 투입 용선량(t) */
  @IsOptional()
  @Matches(TON, { message: '투입 용선량은 소수 3자리까지의 톤으로 입력해 주세요' })
  inputHotMetalTon?: string;

  /** 연주: 슬래브 생산 매수 */
  @IsOptional()
  @IsInt({ message: '슬래브 매수는 정수로 입력해 주세요' })
  @Min(1, { message: '슬래브 매수는 1 이상이어야 해요' })
  @Max(999, { message: '슬래브 매수는 999 이하여야 해요' })
  slabQty?: number;

  /** 열연: 투입할 열연 배정 (없으면 이 계획의 확정 배정 전부) */
  @IsOptional()
  @ArrayNotEmpty({ message: '열연할 배정을 하나 이상 골라 주세요' })
  @ArrayUnique({ message: '같은 배정을 두 번 고를 수 없어요' })
  @IsInt({ each: true, message: '배정 id는 정수예요' })
  allocationIds?: number[];
}

/**
 * 작업 실적 등록 (API-208). completedAt이 없으면 작업 시작만 기록하고(PRODUCTION_STARTED),
 * 있으면 시작과 완료(실적 등록)를 한 번에 한다.
 */
export class RegisterProductionResultDto extends WorkOutputFields {
  @IsIn(Object.values(PROCESS_TYPE), { message: '공정은 제선·제강·연주·열연 중 하나여야 해요' })
  processType!: ProcessType;

  /** 제선은 선택(계획과 묶지 않고 작업 로그에만 남긴다), 나머지는 필수 */
  @IsOptional()
  @IsInt({ message: '생산계획 id는 정수여야 해요' })
  @Min(1, { message: '생산계획 id는 1 이상이어야 해요' })
  productionPlanId?: number;

  @IsOptional()
  @Matches(EQUIPMENT_CODE, { message: '고로 코드는 대문자·숫자 2~10자예요 (예: BF2)' })
  blastFurnaceCode?: string;

  @IsOptional()
  @Matches(EQUIPMENT_CODE, { message: '전로 코드는 대문자·숫자 2~10자예요 (예: BOF1)' })
  converterCode?: string;

  /** 없으면 지금 */
  @IsOptional()
  @IsDateString({}, { message: '작업 시작 일시는 ISO 8601 형식이어야 해요' })
  startedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: '작업 완료 일시는 ISO 8601 형식이어야 해요' })
  completedAt?: string;
}

/** 작업 완료·실적 등록 (POST production-results/:id/complete) */
export class CompleteProductionResultDto extends WorkOutputFields {
  /** 없으면 지금 */
  @IsOptional()
  @IsDateString({}, { message: '작업 완료 일시는 ISO 8601 형식이어야 해요' })
  completedAt?: string;
}

export class ListProductionResultsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '생산계획 id는 정수여야 해요' })
  @Min(1, { message: '생산계획 id는 1 이상이어야 해요' })
  productionPlanId?: number;

  @IsOptional()
  @IsIn(Object.values(PROCESS_TYPE), { message: '공정은 제선·제강·연주·열연 중 하나여야 해요' })
  processType?: ProcessType;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 해요' })
  @Min(1, { message: 'page는 1 이상이어야 해요' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 해요' })
  @Min(1, { message: 'size는 1 이상이어야 해요' })
  @Max(100, { message: 'size는 100 이하여야 해요' })
  size?: number;
}
