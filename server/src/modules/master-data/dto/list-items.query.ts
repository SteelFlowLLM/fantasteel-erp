import { IsIn, IsOptional } from 'class-validator';
import { ITEM_TYPE, type ItemType } from '@fantasteel/shared';

/** 품목·규격 목록 조건. 수주 등록 규격 선택은 itemType=SLAB·COIL로 나눠 부른다 */
export class ListItemsQuery {
  @IsOptional()
  @IsIn(Object.values(ITEM_TYPE), { message: '품목 유형 값이 올바르지 않습니다' })
  itemType?: ItemType;
}
