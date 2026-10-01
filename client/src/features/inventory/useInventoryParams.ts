// 재고 화면의 탭·필터를 주소(?tab=…)에 둔다. 다른 화면에서 링크로 바로 열 수 있다.
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { LOT_STATUS, LOT_TYPE, type LotStatus, type LotType, type ProductItemType } from '@/codes';

export type InventoryTab = 'products' | 'lots' | 'raw' | 'surplus';

const TABS: readonly InventoryTab[] = ['products', 'lots', 'raw', 'surplus'];
const isTab = (v: string | null): v is InventoryTab => v !== null && (TABS as readonly string[]).includes(v);
const isLotType = (v: string | null): v is LotType => v !== null && (Object.values(LOT_TYPE) as string[]).includes(v);
const isLotStatus = (v: string | null): v is LotStatus => v !== null && (Object.values(LOT_STATUS) as string[]).includes(v);
const isProductType = (v: string | null): v is ProductItemType => v === 'SLAB' || v === 'COIL';

export interface InventoryParams {
  tab: InventoryTab;
  itemType: ProductItemType | '';
  steelGrade: string;
  lotType: LotType | '';
  lotStatus: LotStatus | '';
}

export function useInventoryParams(): [InventoryParams, (patch: Partial<Record<keyof InventoryParams, string>>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab');
  const itemType = params.get('itemType');
  const lotType = params.get('lotType');
  const lotStatus = params.get('lotStatus');
  const value: InventoryParams = {
    tab: isTab(tab) ? tab : 'products',
    itemType: isProductType(itemType) ? itemType : '',
    steelGrade: params.get('steelGrade') ?? '',
    lotType: isLotType(lotType) ? lotType : '',
    lotStatus: isLotStatus(lotStatus) ? lotStatus : '',
  };
  const update = useCallback(
    (patch: Partial<Record<keyof InventoryParams, string>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, v] of Object.entries(patch)) {
        if (v && !(key === 'tab' && v === 'products')) next.set(key, v);
        else next.delete(key);
      }
      const text = next.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );
  return [value, update];
}
