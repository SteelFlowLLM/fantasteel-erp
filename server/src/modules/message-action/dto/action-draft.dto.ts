import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

/** PATCH action-drafts/:id. 보내지 않은 칸은 그대로 두고, null이면 비운다 */
export class UpdateActionDraftDto {
  @IsOptional()
  @IsInt({ message: '원료 품목을 골라 주세요' })
  itemId?: number | null;

  @IsOptional()
  @IsString({ message: '수량(톤)은 숫자로 입력해 주세요' })
  requestedTon?: string | null;

  @IsOptional()
  @IsString({ message: '희망 입고일은 YYYY-MM-DD로 입력해 주세요' })
  desiredReceiptDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '요청 근거는 500자까지 쓸 수 있어요' })
  requestReason?: string | null;

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
