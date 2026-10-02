// 재고 조회 훅 (제품·LOT 목록·원료·여재). 예약·출고·검사·실적이 바뀌면 useAction이 모든 조회를 무효화하고,
// 다른 탭의 변경은 BroadcastChannel 동기화(useMockDataSync)로 다시 불러온다.
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, inventoryKeys, type LotListFilter } from '@/api/inventories';

export function useProductInventory() {
  return useQuery({ queryKey: inventoryKeys.products(), queryFn: inventoryApi.listProducts });
}

export function useLotList(filter: LotListFilter = {}) {
  return useQuery({ queryKey: inventoryKeys.lots(filter), queryFn: () => inventoryApi.listLots(filter) });
}

export function useRawMaterialInventory() {
  return useQuery({ queryKey: inventoryKeys.rawMaterials(), queryFn: inventoryApi.listRawMaterials });
}

export function useSurplusSlabs() {
  return useQuery({ queryKey: inventoryKeys.surplus(), queryFn: inventoryApi.listSurplus });
}
