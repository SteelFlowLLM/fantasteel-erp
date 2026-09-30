import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ACTION_TYPE, DRAFT_STATUS, type ActionType, type DraftStatus } from '@fantasteel/shared';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

export class CreateActionDraftDto {
  @IsIn(Object.values(ACTION_TYPE), { message: '지원하지 않는 업무 유형입니다' })
  actionType: ActionType;
}

export class UpdateActionDraftDto {
  /** 유형별 추출 스키마 값. 바꿀 항목만 보낸다 (null = 아직 모름). 검증은 유형 정의가 한다. */
  @IsObject({ message: 'payload에 바꿀 값을 넣어 주세요' })
  payload: Record<string, unknown>;
}

export class RejectActionDraftDto {
  @IsString({ message: '반려 사유를 입력해 주세요' })
  @MinLength(1, { message: '반려 사유를 입력해 주세요' })
  @MaxLength(500, { message: '반려 사유는 500자 이하로 입력해 주세요' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  rejectReason: string;
}

export class ListActionDraftsDto {
  /** 내가 확정할 초안만 */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsIn(Object.values(DRAFT_STATUS))
  status?: DraftStatus;
}
