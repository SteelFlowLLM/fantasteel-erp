import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { PROCESS_CODE } from '@fantasteel/shared';
import { NumericInput } from './numeric';

export class RoutingProcessInputDto {
  @IsIn(Object.values(PROCESS_CODE))
  processCode: string;

  /** 0 초과 1 이하. 열연(HOT_ROLLING)은 입력하지 않는다 (규격 매핑에서 계산). 제선처럼 수율을 쓰지 않는 공정은 비운다. */
  @IsOptional()
  @NumericInput()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: '계획 수율은 0보다 크고 1 이하여야 합니다' })
  @Max(1, { message: '계획 수율은 0보다 크고 1 이하여야 합니다' })
  plannedYieldRate?: number | null;
}

/** 배열 순서가 공정 순서(processSeq 1부터)가 된다. */
export class ReplaceRoutingDto {
  @IsArray()
  @ArrayNotEmpty({ message: '공정을 1개 이상 입력해 주세요' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RoutingProcessInputDto)
  processes: RoutingProcessInputDto[];
}
