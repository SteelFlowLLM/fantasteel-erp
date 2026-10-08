// 서버 모드 기준정보 표시값 보조. 화면의 고객사·규격·강종·야드 id는 서버 id 그대로다 (선택 목록도 서버, api/server/lookups.ts).
// 서버 응답에 없는 규격 표시값(유형·1매 이론중량·강종·기본 야드)만 규격 코드로 찾는다:
// 서버 규격 목록(GET /items, 기준정보 조회 권한)을 먼저 보고, 권한이 없으면(물류) 가짜 DB 시드의 같은 코드로 채운다(시드 코드는 서버와 같다).
// 여기서 찾은 값은 화면 표시용이다. id로 쓰지 않는다.
import type { ItemView, YardView } from '@fantasteel/shared';
import { ApiError } from '@/api/errors';
import { serverRequest } from '@/api/http';
import type { ItemType } from '@/codes';
import { getMockDb } from '@/mock/db';
import type { ItemRow, SteelGradeRow } from '@/mock/schema';

/** 규격 표시값 */
export interface ItemInfo {
  itemType: ItemType;
  itemName: string;
  theoreticalWeightTon: string | null;
  steelGradeCode: string | null;
  /** 기본 야드: 서버 목록을 읽었으면 서버 야드 id, 시드에서 채웠으면 null (이름만) */
  yardId: number | null;
  yardName: string | null;
}

/** 가짜 DB 시드의 같은 코드 규격 (서버 응답에 없는 표시값의 마지막 보조) */
export function seedItemOf(itemCode: string): ItemRow | undefined {
  return getMockDb().read((t) => t.item.find((i) => i.itemCode === itemCode));
}

/** 가짜 DB 시드의 같은 코드 강종 */
export function seedSteelGradeOf(steelGradeCode: string): SteelGradeRow | undefined {
  return getMockDb().read((t) => t.steelGrade.find((g) => g.steelGradeCode === steelGradeCode));
}

function seedInfoOf(itemCode: string): ItemInfo | undefined {
  return getMockDb().read((t) => {
    const item = t.item.find((i) => i.itemCode === itemCode);
    if (!item) return undefined;
    return {
      itemType: item.itemType,
      itemName: item.itemName,
      theoreticalWeightTon: item.theoreticalWeightTon,
      steelGradeCode: t.steelGrade.find((g) => g.id === item.steelGradeId)?.steelGradeCode ?? null,
      yardId: null,
      yardName: t.yard.find((y) => y.id === item.defaultYardId)?.yardName ?? null,
    };
  });
}

/**
 * 규격 코드 → 표시값. 한 번의 화면 조회 안에서 만들어 쓴다(서버에서 새로 등록한 규격도 바로 보이도록 캐시하지 않는다).
 * 서버 목록에 없는 코드는 시드에서 찾는다.
 */
export async function itemInfoReader(): Promise<(itemCode: string) => ItemInfo | undefined> {
  let items: ItemView[] = [];
  let yards: YardView[] = [];
  try {
    [items, yards] = await Promise.all([serverRequest<ItemView[]>('GET', '/items'), serverRequest<YardView[]>('GET', '/yards')]);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'COM-002')) throw error;
  }
  const byCode = new Map(
    items.map((i): [string, ItemInfo] => {
      const yard = yards.find((y) => y.id === i.defaultYardId);
      return [i.itemCode, { itemType: i.itemType, itemName: i.itemName, theoreticalWeightTon: i.theoreticalWeightTon, steelGradeCode: i.steelGradeCode, yardId: yard?.id ?? null, yardName: yard?.yardName ?? null }];
    }),
  );
  return (itemCode) => byCode.get(itemCode) ?? seedInfoOf(itemCode);
}
