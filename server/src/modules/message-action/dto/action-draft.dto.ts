import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** GET action-drafts: chatRoomId가 있으면 그 방 메시지의 초안(방 멤버만), 없으면 내가 요청자인 초안 */
export class ListActionDraftsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '채팅방 id가 올바르지 않아요' })
  @Min(1)
  chatRoomId?: number;
}
