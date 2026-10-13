import { ITEM_TYPE_LABEL } from '@fantasteel/shared';
import type { InventoryService } from '../../inventory/inventory.service';
import { limitRows, looseIncludes, optionalEnum, optionalString, type AssistantTool } from './assistant-tool';

const CATEGORIES = ['PRODUCT', 'RAW_MATERIAL', 'SURPLUS'] as const;

/** 재고 (GET /inventories, 로그인한 전 역할) */
export function inventoryTool(inventory: InventoryService): AssistantTool {
  return {
    permission: null,
    definition: {
      name: 'get_inventory',
      description:
        '제품(슬래브·코일) 재고, 원료 잔량(톤), 여재 슬래브를 조회한다. 매수는 합격 재고 기준이고 가용재고 = 합격 재고 − 예약 − 열연 배정이다. 재고·여재·원료 잔량을 물으면 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '규격 코드·품목 이름·강종의 일부 (예: SS275, 코일, 철광석). 없으면 전체' },
          category: { type: 'string', enum: [...CATEGORIES], description: 'PRODUCT=제품, RAW_MATERIAL=원료, SURPLUS=여재 슬래브. 없으면 모두' },
        },
      },
    },
    async run(args) {
      const keyword = optionalString(args, 'keyword');
      const category = optionalEnum(args, 'category', CATEGORIES);
      const overview = await inventory.listInventories({});
      const match = (texts: (string | null)[]) => !keyword || looseIncludes(texts, keyword);
      const want = (c: (typeof CATEGORIES)[number]) => !category || category === c;

      const products = limitRows(overview.products.filter((r) => match([r.itemCode, r.itemName, r.steelGradeCode])));
      const rawMaterials = limitRows(overview.rawMaterials.filter((r) => match([r.itemCode, r.itemName])));
      const surplus = limitRows(overview.surplus.filter((r) => r.surplusQty > 0 && match([r.itemCode, r.itemName, r.steelGradeCode])));

      return {
        label: `재고${keyword ? ` · ${keyword}` : ''}`,
        data: {
          ...(want('PRODUCT')
            ? {
                제품: products.rows.map((r) => ({
                  규격: r.itemCode,
                  품목: r.itemName,
                  품목유형: ITEM_TYPE_LABEL[r.itemType],
                  강종: r.steelGradeCode,
                  '합격 재고 매수': r.onHandQty,
                  '예약 매수': r.reservedQty,
                  '열연 배정 매수': r.rollingAllocatedQty,
                  '가용재고 매수': r.availableQty,
                  '합격 재고 톤': r.onHandTon,
                  '가용재고 톤': r.availableTon,
                })),
                '제품 생략 줄 수': products.omitted,
              }
            : {}),
          ...(want('RAW_MATERIAL')
            ? {
                원료: rawMaterials.rows.map((r) => ({ 원료: r.itemCode, 이름: r.itemName, '잔량 톤': r.remainingTon, 'LOT 수': r.lotCount })),
                '원료 생략 줄 수': rawMaterials.omitted,
              }
            : {}),
          ...(want('SURPLUS')
            ? {
                여재: surplus.rows.map((r) => ({
                  규격: r.itemCode,
                  품목: r.itemName,
                  강종: r.steelGradeCode,
                  '여재 매수': r.surplusQty,
                  '여재 LOT': r.lots.slice(0, 5).map((lot) => `${lot.lotNo}${lot.producedDate ? ` (생산 ${lot.producedDate})` : ''}`),
                })),
                '여재 생략 줄 수': surplus.omitted,
              }
            : {}),
        },
      };
    },
  };
}
