import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { DISPOSITION_STATUS } from '@fantasteel/shared';

/** 불합격 처리 상태 지정 (REQ-QC-004). */
export class SetDispositionDto {
  @IsIn(Object.values(DISPOSITION_STATUS), { message: '처리 상태는 보류·격하·폐기 중에서 골라 주세요' })
  dispositionStatus: string;

  @IsString() @MinLength(1, { message: '사유를 입력해 주세요' }) @MaxLength(500)
  reason: string;
}
