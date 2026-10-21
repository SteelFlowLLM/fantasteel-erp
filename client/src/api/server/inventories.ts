// 재고 화면 ↔ 서버 API (GET /inventories, GET /lots, GET /lots/:id). 서버 재고 응답은 규격별 합계만 있어서
// LOT 목록·원료 LOT은 LOT 목록·상세에서, 입고일·입고 번호는 입고 목록, 입고예정은 발주 목록에서 채운다(권한이 없으면 비운다).
// - 서버 onHandQty는 "합격 재고"(적격·미소진)라 화면의 합격 매수다. 화면의 재고 매수는 재고 상태(AVAILABLE) LOT 수로 센다.
//   불합격 = 그 가운데 자기 검사 불합격, 판정 대기 = 나머지(상위 히트만 불합격인 LOT도 여기에 든다).
// - 여재 탭은 서버 재고 응답의 surplus(inventory.md 8-1)를 쓴다. 여재 전환 시각은 ERD에 없어 비우고, LOT 목록의 여재 표시는 끈다.
// - 생산계획 링크, 공급업체, 기본 야드는 서버 응답에 없어 비운다.
import type { InventoryOverview, InspectionResult, ItemView, LotDetail, LotSummary, PurchaseOrderView, GoodsReceiptView, ReservationReconciliationView } from '@fantasteel/shared';
import type { LotListFilter, LotListView, ProductInventoryView, RawMaterialInventoryView, SurplusSpecView } from '@/api/inventories';
import { serverRequest } from '@/api/http';
import { allPages, orEmpty } from '@/api/server/inspections';
import { PRODUCT_QTY_UNIT, type ProductItemType } from '@/codes';
import { currentAllocationOf, heatInspectionResult, productInspectionResult } from '@/features/inventory/lib/inventoryRules';
import { decDiv, decSum } from '@/lib/decimal';
import { productEligibility } from '@/lib/eligibility';
import { calcTheoreticalWeightTon, calcWeightTon } from '@/lib/weight';

const productType = (itemType: string): ProductItemType => (itemType === 'COIL' ? 'COIL' : 'SLAB');
const isProduct = (lotType: string) => lotType === 'SLAB' || lotType === 'COIL';
const passedOf = (result: InspectionResult | null): boolean | null => (result === 'PASS' ? true : result === 'FAIL' ? false : null);

const readOverview = () => serverRequest<InventoryOverview>('GET', '/inventories');
/** 규격 목록 (이론중량·치수). 권한이 없으면(물류) 빈 목록 */
const readItems = async () => new Map((await orEmpty(() => serverRequest<ItemView[]>('GET', '/items'), [])).map((i) => [i.id, i]));
/** 입고 목록 → 원료 LOT id별 입고일·입고 번호. 권한이 없으면(영업·생산·품질) 빈 값 */
const readReceipts = async () =>
  new Map((await orEmpty(() => allPages<GoodsReceiptView>('/goods-receipts'), [])).flatMap((r) => (r.lotId === null ? [] : [[r.lotId, r] as const])));

/** 규격 코드 = 유형-강종-두께x폭x길이 (REQ-MST-003). 형식이 다르면 null */
const SPEC_CODE = /^(?:SL|CL)-[^-]+-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/;
function sizeFromSpecCode(itemCode: string): { thicknessMm: string; widthMm: string; lengthMm: string } | null {
  const match = SPEC_CODE.exec(itemCode);
  return match ? { thicknessMm: match[1], widthMm: match[2], lengthMm: match[3] } : null;
}

async function listProducts(): Promise<ProductInventoryView[]> {
  const [overview, items, availableLots] = await Promise.all([readOverview(), readItems(), allPages<LotSummary>('/lots', { lotStatus: 'AVAILABLE' })]);
  const lotsByItem = new Map<number, LotSummary[]>();
  for (const lot of availableLots) if (lot.itemId !== null && isProduct(lot.lotType)) lotsByItem.set(lot.itemId, [...(lotsByItem.get(lot.itemId) ?? []), lot]);
  return overview.products.map((row) => {
    const item = items.get(row.itemId);
    // 규격 목록을 못 읽으면(물류) 치수는 규격 코드에서 읽고 1매 이론중량은 같은 식으로 구한다.
    // 합격 톤 ÷ 합격 매수로 구하면 재고 0인 규격이 0.000 t로 보였다. 코드 형식이 다를 때만 그 방식으로 되돌아간다
    const size = item ? { thicknessMm: item.thicknessMm, widthMm: item.widthMm, lengthMm: item.lengthMm } : sizeFromSpecCode(row.itemCode);
    const theoreticalWeightTon =
      item?.theoreticalWeightTon ??
      (size?.thicknessMm && size.widthMm && size.lengthMm
        ? calcTheoreticalWeightTon(size.thicknessMm, size.widthMm, size.lengthMm)
        : row.onHandQty > 0
          ? decDiv(row.onHandTon, row.onHandQty)
          : '0.000');
    const lots = lotsByItem.get(row.itemId) ?? [];
    const onHandQty = Math.max(lots.length, row.onHandQty);
    const failedQty = lots.filter((l) => l.inspectionResult === 'FAIL').length;
    const itemType = productType(row.itemType);
    return {
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType,
      steelGradeCode: row.steelGradeCode,
      theoreticalWeightTon,
      onHandQty,
      passedQty: row.onHandQty,
      pendingQty: Math.max(0, onHandQty - row.onHandQty - failedQty),
      failedQty,
      reservedQty: row.reservedQty,
      hotRollingAllocatedQty: row.rollingAllocatedQty,
      // 출하 배정 매수는 서버 재고 응답에 없다 (화면에서 쓰지 않는다)
      shipmentAllocatedQty: 0,
      availableQty: row.availableQty,
      onHandTon: calcWeightTon(onHandQty, theoreticalWeightTon),
      passedTon: row.onHandTon,
      availableTon: row.availableTon,
      thicknessMm: size?.thicknessMm ?? null,
      widthMm: size?.widthMm ?? null,
      lengthMm: size?.lengthMm ?? null,
      defaultYardName: null,
      qtyUnit: PRODUCT_QTY_UNIT[itemType],
      reservedTon: calcWeightTon(row.reservedQty, theoreticalWeightTon),
    };
  });
}

/** 한 번의 조회 안에서 같은 LOT 상세를 두 번 읽지 않는다 */
function detailReader() {
  const cache = new Map<number, Promise<LotDetail>>();
  return (id: number): Promise<LotDetail> => {
    let found = cache.get(id);
    if (!found) {
      found = serverRequest<LotDetail>('GET', `/lots/${id}`);
      cache.set(id, found);
    }
    return found;
  };
}

/** 생산완료일(원료는 입고일) 최근 순 → LOT 번호 */
const byProducedDesc = (a: LotListView, b: LotListView) => b.producedDate.localeCompare(a.producedDate) || a.lotNo.localeCompare(b.lotNo);

async function listLots(filter: LotListFilter = {}): Promise<LotListView[]> {
  const [lots, receipts] = await Promise.all([
    allPages<LotSummary>('/lots', { lotType: filter.lotType, lotStatus: filter.lotStatus, itemId: filter.itemId }),
    filter.lotType === undefined || filter.lotType === 'RAW_MATERIAL' ? readReceipts() : Promise.resolve(new Map<number, GoodsReceiptView>()),
  ]);
  const readDetail = detailReader();
  // 히트 판정은 목록에 있으면 그대로, 없으면(유형 필터) 히트 상세에서 읽는다
  const inspectionById = new Map(lots.map((l) => [l.id, l.inspectionResult]));
  const heatResultOf = async (heatId: number) => (inspectionById.has(heatId) ? (inspectionById.get(heatId) ?? null) : (await readDetail(heatId)).inspectionResult);
  const rows = await Promise.all(
    lots.map(async (lot): Promise<LotListView> => {
      const product = isProduct(lot.lotType);
      const detail = product || lot.lotType === 'HEAT' ? await readDetail(lot.id) : null;
      const heat = product && detail?.heat ? { isPassed: passedOf(await heatResultOf(detail.heat.id)) } : null;
      const isPassed = passedOf(lot.inspectionResult);
      const allocation = product && detail ? currentAllocationOf(detail.allocations) : null;
      return {
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotType: lot.lotType,
        lotStatus: lot.lotStatus,
        itemId: lot.itemId,
        itemCode: lot.itemCode,
        itemName: lot.itemName,
        steelGradeCode: lot.steelGradeCode,
        producedDate: lot.producedDate ?? receipts.get(lot.id)?.receivedDate ?? '',
        quality: product ? productEligibility({ lotStatus: lot.lotStatus, isPassed }, heat) : lot.lotType === 'HEAT' ? (lot.inspectionResult === 'PASS' || lot.inspectionResult === 'FAIL' ? lot.inspectionResult : 'PENDING') : null,
        yardName: lot.yardName,
        initialTon: lot.initialTon,
        remainingTon: lot.remainingTon,
        heatNo: detail?.heat?.lotNo ?? null,
        productionPlanNo: null,
        surplusAt: null,
        dispositionStatus: detail?.disposition?.dispositionStatus ?? null,
        productionPlanId: null,
        inspectionResult: product ? productInspectionResult({ isPassed }, heat) : lot.lotType === 'HEAT' ? heatInspectionResult(isPassed) : null,
        allocationPurpose: allocation?.allocationPurpose ?? null,
        allocationStatus: allocation && allocation.allocationStatus !== 'RELEASED' ? allocation.allocationStatus : null,
        isSurplus: false,
      };
    }),
  );
  return rows.sort(byProducedDesc);
}

/** 입고예정 = 입고를 기다리는 발주(발주 확정·부분 입고)의 품목별 미입고량 합계. 권한이 없으면(구매·관리자 외) 0 */
async function scheduledReceiptTonByItem(): Promise<Map<number, string[]>> {
  const purchaseOrders = await orEmpty(() => allPages<PurchaseOrderView>('/purchase-orders'), []);
  const byItem = new Map<number, string[]>();
  for (const po of purchaseOrders) {
    // 발주 취소·잔량 마감한 발주는 더 들어올 양이 없다 (대시보드 구매 진행·MRP 입고예정과 같은 기준)
    if (po.purchaseOrderStatus !== 'CONFIRMED' && po.purchaseOrderStatus !== 'PARTIALLY_RECEIVED') continue;
    for (const line of po.items) byItem.set(line.itemId, [...(byItem.get(line.itemId) ?? []), line.remainingTon]);
  }
  return byItem;
}

async function listRawMaterials(): Promise<RawMaterialInventoryView[]> {
  const [overview, lots, receipts, scheduled] = await Promise.all([readOverview(), allPages<LotSummary>('/lots', { lotType: 'RAW_MATERIAL' }), readReceipts(), scheduledReceiptTonByItem()]);
  const readDetail = detailReader();
  return Promise.all(
    overview.rawMaterials.map(async (row): Promise<RawMaterialInventoryView> => {
      const mine = lots
        .filter((l) => l.itemId === row.itemId)
        .map((l) => ({ lot: l, receipt: receipts.get(l.id) }))
        // FIFO: 입고일 → LOT 번호 (lib/fifo와 같은 순서)
        .sort((a, b) => (a.receipt?.receivedDate ?? '').localeCompare(b.receipt?.receivedDate ?? '') || a.lot.lotNo.localeCompare(b.lot.lotNo) || a.lot.id - b.lot.id);
      // 원료 종류(합금철 등)는 LOT 상세에만 있어 이 원료의 LOT 하나에서 읽는다
      const first = mine[0];
      const rawMaterialType = first ? (await readDetail(first.lot.id)).rawMaterialType : null;
      return {
        itemId: row.itemId,
        itemCode: row.itemCode,
        itemName: row.itemName,
        rawMaterialType,
        remainingTon: row.remainingTon,
        scheduledReceiptTon: decSum(scheduled.get(row.itemId) ?? []),
        lots: mine.map(({ lot, receipt }) => ({
          lotId: lot.id,
          lotNo: lot.lotNo,
          receiptDate: receipt?.receivedDate ?? '',
          initialTon: lot.initialTon ?? '0.000',
          remainingTon: lot.remainingTon ?? '0.000',
          lotStatus: lot.lotStatus,
          supplierName: null,
          goodsReceiptNo: receipt?.goodsReceiptNo ?? null,
          yardName: lot.yardName,
        })),
        defaultYardName: null,
        availableLotCount: row.lotCount,
      };
    }),
  );
}

/** 여재 = 서버 재고 응답의 surplus (inventory.md 8-1). 톤은 매수 × 1매 이론중량으로 계산한다 */
async function listSurplus(): Promise<SurplusSpecView[]> {
  const { surplus } = await readOverview();
  return surplus.map((row) => ({
    itemId: row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    steelGradeCode: row.steelGradeCode,
    theoreticalWeightTon: row.theoreticalWeightTon,
    unallocatedPassedQty: row.unallocatedPassedQty,
    unallocatedPassedTon: calcWeightTon(row.unallocatedPassedQty, row.theoreticalWeightTon),
    reservedQty: row.reservedQty,
    availableQty: row.availableQty,
    availableTon: calcWeightTon(row.availableQty, row.theoreticalWeightTon),
    surplusQty: row.surplusQty,
    surplusTon: calcWeightTon(row.surplusQty, row.theoreticalWeightTon),
    // 여재 전환 시각은 ERD에 없다 (inventory.md 8-1)
    lots: row.lots.map((lot) => ({ ...lot, producedDate: lot.producedDate ?? '', surplusAt: null })),
  }));
}

/** 정합성 점검 (REQ-INV-010): 바꾸지 않고 예약 매수가 어긋난 규격만 받는다 */
const checkReconciliation = () => serverRequest<ReservationReconciliationView>('GET', '/inventories/reconciliation');
/** 정합성 보정: 관리자만 (서버가 확인한다) */
const reconcile = () => serverRequest<ReservationReconciliationView>('POST', '/inventories/reconciliation');

export const serverInventoryApi = { listProducts, listLots, listRawMaterials, listSurplus, checkReconciliation, reconcile };
