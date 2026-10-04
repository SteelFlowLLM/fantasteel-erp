import { IsIn, IsISO8601, IsNotEmpty, IsString } from 'class-validator';
import { DISPOSITION_STATUS, type DispositionStatus } from '@fantasteel/shared';

export class SetLotDispositionDto {
  /** [06] DISPOSITION_STATUS: 보류·격하·폐기 (quality.md 8장 "처리 상태 개수: [06]을 따른다") */
  @IsIn(Object.values(DISPOSITION_STATUS), { message: '처리 상태는 HOLD·DOWNGRADED·SCRAPPED 중 하나여야 해요' })
  dispositionStatus!: DispositionStatus;

  /** 필수, 길이 제한 없음 ([ERD] varchar, 2026-10-04 결정). 공백만이면 service가 거부한다 */
  @IsString({ message: '사유는 문자열이어야 해요' })
  @IsNotEmpty({ message: '사유를 입력해 주세요' })
  dispositionReason!: string;

  /** 불합격 LOT 목록 행의 updatedAt. 그 사이 LOT이 바뀌었으면 COM-001 (2026-10-04 결정) */
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt은 ISO 8601 시각이어야 해요' })
  expectedUpdatedAt!: string;
}
