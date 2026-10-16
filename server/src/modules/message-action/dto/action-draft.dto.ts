import { Type } from 'class-transformer';
import { ACTION_TYPE, type ActionType } from '@fantasteel/shared';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** GET action-drafts: chatRoomId가 있으면 그 방 메시지의 초안(방 멤버만), 없으면 내가 요청자인 초안 */
export class ListActionDraftsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '채팅방 id가 올바르지 않아요' })
  @Min(1)
  chatRoomId?: number;

  /** agent이면 AI Factory Agent 대응 후보 목록 (API-252, REQ-AGT-005) */
  @IsOptional()
  @IsIn(['agent'], { message: 'source는 agent만 쓸 수 있어요' })
  source?: 'agent';
}

/** POST messages/:id/action-drafts. 유형이 없으면 구매요청 생성 */
export class CreateActionDraftDto {
  @IsOptional()
  @IsIn(Object.values(ACTION_TYPE), { message: '업무 유형이 올바르지 않아요' })
  actionType?: ActionType;
}

/** PATCH action-drafts/:id. payload의 보내지 않은 칸은 그대로 두고, null이면 비운다. 칸 검증은 유형 정의가 한다 */
export class UpdateActionDraftDto {
  @IsOptional()
  @IsObject({ message: 'payload는 객체여야 해요' })
  payload?: Record<string, unknown>;

  /** 화면을 연 시점의 updatedAt. 그 사이 바뀌었으면 COM-001 */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt은 ISO 8601 시각이어야 해요' })
  expectedUpdatedAt?: string | null;
}

/** POST action-drafts/:id/confirm */
export class ConfirmActionDraftDto {
  /** 화면을 연 시점의 updatedAt. 그 사이 바뀌었으면 COM-001 */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt은 ISO 8601 시각이어야 해요' })
  expectedUpdatedAt?: string | null;
}

/** POST action-drafts/:id/reject */
export class RejectActionDraftDto extends ConfirmActionDraftDto {
  @IsString({ message: '반려 사유를 입력해 주세요' })
  @IsNotEmpty({ message: '반려 사유를 입력해 주세요' })
  @MaxLength(500, { message: '반려 사유는 500자까지 쓸 수 있어요' })
  rejectReason!: string;
}
