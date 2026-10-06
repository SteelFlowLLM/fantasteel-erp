import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  LOT_STATUS,
  LOT_TYPE,
  PERMISSION,
  RESERVATION_STATUS,
  SALES_ORDER_ITEM_STATUS,
  SHIPMENT_REQUEST_STATUS,
  calcWeightTon,
  type AllocationCandidate,
  type AllocationPurpose,
  type AllocationRecommendation,
  type AllocationStatus,
  type AllocationView,
  type AuthUser,
  type InventoryOverview,
  type ItemType,
  type LotStatus,
  type ProductStockRow,
  type PermissionLevel,
  type ReservationStatus,
  type SalesOrderReservationView,
  type ShipmentAllocationCandidates,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { ShipmentService } from '../shipment/shipment.service';
import type { ConfirmAllocationDto, ListAllocationsQuery, ListInventoriesQuery, RecommendAllocationDto, ReleaseAllocationDto } from './dto/allocation.dto';
import { InventoryRepository } from './inventory.repository';

type Actor = AuthUser | 'SYSTEM';

/** 검사 판정 반영 결과 (규격별) */
export interface EligibilitySyncResult {
  itemId: number;
  /** 다시 맞춘 합격 재고 매수 */
  onHandQty: number;
  autoReservedQty: number;
  releasedReservationQty: number;
  releasedAllocationCount: number;
}
type AllocationRow = NonNullable<Awaited<ReturnType<InventoryRepository['findAllocation']>>>;

/** 예약 조건부 UPDATE가 0행일 때 가용을 다시 읽어 시도하는 횟수 (재고 행을 잠근 뒤라 보통 첫 번에 끝난다) */
const RESERVE_ATTEMPTS = 3;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const reservationSnapshot = (r: { id: number; salesOrderItemId: number; itemId: number; reservedQty: number; reservationStatus: string }) => ({
  id: r.id,
  salesOrderItemId: r.salesOrderItemId,
  itemId: r.itemId,
  reservedQty: r.reservedQty,
  reservationStatus: r.reservationStatus,
});
const allocationSnapshot = (a: AllocationRow) => ({
  id: a.id,
  lotId: a.lotId,
  lotNo: a.lot.lotNo,
  allocationPurpose: a.allocationPurpose,
  allocationStatus: a.allocationStatus,
  shipmentRequestItemId: a.shipmentRequestItemId,
  productionPlanId: a.productionPlanId,
});
type LotWithParents = AllocationRow['lot'];
/** 상위 히트 번호: 슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트 */
export function heatNoOfLot(lot: LotWithParents): string | null {
  for (const { parentLot } of lot.lotRelationsAsChildLot) {
    if (parentLot.lotType === LOT_TYPE.HEAT) return parentLot.lotNo;
    const heat = parentLot.lotRelationsAsChildLot.find((r) => r.parentLot.lotType === LOT_TYPE.HEAT);
    if (heat) return heat.parentLot.lotNo;
  }
  return null;
}

const salesOrderIdOf = (a: AllocationRow) => a.shipmentRequestItem?.salesOrderItem.salesOrderId ?? a.productionPlan?.salesOrderItem?.salesOrderId ?? null;

export function toAllocationView(a: AllocationRow): AllocationView {
  return {
    id: a.id,
    allocationPurpose: a.allocationPurpose as AllocationPurpose,
    allocationStatus: a.allocationStatus as AllocationStatus,
    lotId: a.lotId,
    lotNo: a.lot.lotNo,
    producedDate: dateOnly(a.lot.producedDate),
    lotStatus: a.lot.lotStatus as LotStatus,
    heatNo: heatNoOfLot(a.lot),
    yardId: a.lot.yardId,
    shipmentRequestItemId: a.shipmentRequestItemId,
    productionPlanId: a.productionPlanId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/**
 * 재고·예약·배정 (REQ-INV-001~009, docs/backend/inventory.md).
 * 다른 모듈은 tx를 넘겨 이 서비스의 함수로만 inventory·reservation·allocation을 바꾼다.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InventoryRepository,
    private readonly businessEventRecorder: BusinessEventRecorder,
    @Inject(forwardRef(() => ShipmentService)) private readonly shipment: ShipmentService,
  ) {}

  // ── 재고 (REQ-INV-001·008) ─────────────────────────────

  /** 제품 규격별 재고: 합격 재고·예약·열연 배정·가용 매수와 톤(계산값). 다른 수주에 예약된 매수는 가용에서 빠진다 */
  async productStock(tx: Tx): Promise<ProductStockRow[]> {
    const rows = await this.repository.findProductInventories(tx);
    return rows.map((r) => {
      const onHandQty = r.inventory?.onHandQty ?? 0;
      const reservedQty = r.inventory?.reservedQty ?? 0;
      const rollingAllocatedQty = r.inventory?.rollingAllocatedQty ?? 0;
      const availableQty = onHandQty - reservedQty - rollingAllocatedQty;
      const weight = r.theoreticalWeightTon?.toFixed(3) ?? '0';
      return {
        itemId: r.id,
        itemCode: r.itemCode,
        itemName: r.itemName,
        itemType: r.itemType as ItemType,
        steelGradeCode: r.steelGrade?.steelGradeCode ?? null,
        onHandQty,
        reservedQty,
        rollingAllocatedQty,
        availableQty,
        onHandTon: calcWeightTon(onHandQty, weight),
        availableTon: calcWeightTon(availableQty, weight),
      };
    });
  }

  /**
   * 재고 조회 (API GET /inventories, REQ-INV-001·008): 제품 규격별 재고(합격·예약·열연 배정·가용·톤 + 미배정 합격 LOT 수)와
   * 원료별 LOT 잔량 합계. itemId를 주면 그 규격만 돌려준다. 읽기 전용이라 잠그지 않는다.
   */
  async listInventories(query: ListInventoriesQuery): Promise<InventoryOverview> {
    const [stock, unallocated, raw] = await Promise.all([
      this.productStock(this.prisma),
      this.repository.countUnallocatedPassedLots(this.prisma),
      this.repository.findRawMaterialStock(this.prisma),
    ]);
    const unallocatedByItem = new Map(unallocated.map((row) => [row.item_id, row.lot_count ?? 0]));
    const sumByItem = new Map(raw.sums.map((row) => [row.itemId, row]));
    const wanted = (itemId: number) => query.itemId === undefined || query.itemId === itemId;
    return {
      products: stock.filter((row) => wanted(row.itemId)).map((row) => ({ ...row, unallocatedPassedQty: unallocatedByItem.get(row.itemId) ?? 0 })),
      rawMaterials: raw.items
        .filter((item) => wanted(item.id))
        .map((item) => ({
          itemId: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          remainingTon: (sumByItem.get(item.id)?._sum.remainingTon ?? new Prisma.Decimal(0)).toFixed(3),
          lotCount: sumByItem.get(item.id)?._count._all ?? 0,
        })),
    };
  }

  // ── 예약 (REQ-INV-002·003) ─────────────────────────────

  /**
   * 수주 품목 재고 우선 예약: min(요청 매수, 가용)만 ACTIVE로 예약하고 예약한 매수를 돌려준다 (부분 예약 허용, REQ-SO-003).
   * 재고 행을 잠그고 가용을 읽은 뒤 조건부 UPDATE로 늘린다. 0행이면 가용을 다시 읽어 남은 만큼만 예약한다.
   */
  async reserveForSalesOrderItem(tx: Tx, input: { salesOrderId: number; salesOrderItemId: number; itemId: number; qty: number; actor: Actor }): Promise<number> {
    let reservedQty = 0;
    let availableQty = 0;
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS && reservedQty === 0; attempt++) {
      const inventory = await this.repository.lockInventory(tx, input.itemId);
      if (!inventory) return 0;
      availableQty = inventory.on_hand_qty - inventory.reserved_qty - inventory.rolling_allocated_qty;
      const qty = Math.min(input.qty, Math.max(0, availableQty));
      if (qty === 0) return 0;
      if (await this.repository.reserveQty(tx, input.itemId, qty)) reservedQty = qty;
    }
    if (reservedQty === 0) return 0;

    const reservation = await this.repository.createReservation(tx, { salesOrderItemId: input.salesOrderItemId, itemId: input.itemId, reservedQty });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.RESERVATION_CREATED,
      actor: input.actor,
      target: { table: 'reservation', id: reservation.id },
      salesOrderId: input.salesOrderId,
      after: reservationSnapshot(reservation),
      reason: `STOCK_FIRST: 합격 가용 ${availableQty}매 중 ${reservedQty}매를 재고 우선 예약`,
    });
    return reservedQty;
  }

  /** 수주 품목의 ACTIVE 예약을 모두 RELEASED로 바꾸고 reserved_qty를 그만큼 줄인다. 해제한 매수를 돌려준다 */
  async releaseForSalesOrderItem(tx: Tx, input: { salesOrderId: number; salesOrderItemId: number; itemId: number; actor: Actor; reason: string }): Promise<number> {
    await this.repository.lockInventory(tx, input.itemId);
    const active = await this.repository.findReservationsOfItem(tx, input.salesOrderItemId, RESERVATION_STATUS.ACTIVE);
    let releasedQty = 0;
    for (const reservation of active) {
      const released = await this.repository.updateReservationStatus(tx, reservation.id, RESERVATION_STATUS.RELEASED);
      releasedQty += reservation.reservedQty;
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.RESERVATION_RELEASED,
        actor: input.actor,
        target: { table: 'reservation', id: reservation.id },
        salesOrderId: input.salesOrderId,
        before: reservationSnapshot(reservation),
        after: reservationSnapshot(released),
        reason: input.reason,
      });
    }
    if (releasedQty > 0 && !(await this.repository.releaseReservedQty(tx, input.itemId, releasedQty))) {
      // reserved_qty = ACTIVE 예약 합계 불변조건이 깨진 경우다. 업무 오류가 아니라 서버 오류로 남긴다
      throw new Error(`inventory.reserved_qty가 ACTIVE 예약 합계보다 작습니다 (item ${input.itemId}, 해제 ${releasedQty})`);
    }
    return releasedQty;
  }

  async listReservations(tx: Tx, salesOrderItemIds: number[]): Promise<SalesOrderReservationView[]> {
    if (salesOrderItemIds.length === 0) return [];
    const rows = await this.repository.findReservations(tx, salesOrderItemIds);
    return rows.map((r) => ({
      id: r.id,
      salesOrderItemId: r.salesOrderItemId,
      itemId: r.itemId,
      itemCode: r.item.itemCode,
      itemName: r.item.itemName,
      reservedQty: r.reservedQty,
      reservationStatus: r.reservationStatus as ReservationStatus,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ── 검사 판정 반영 (REQ-INV-003·004·007, quality.md 4장 "판정 뒤 재고 반영") ──

  /**
   * 검사 판정이 바뀐 LOT의 재고 반영. 품질 검사 등록·수정 트랜잭션 안에서 부른다.
   * on_hand_qty를 "적격 AVAILABLE LOT 수"로 다시 맞추므로([ERD] 불변조건) 같은 LOT으로 여러 번 불러도 결과가 같다.
   *  - 적격이 아니게 된 LOT(불합격 LOT, 불합격 히트의 하위 LOT): 확정 배정 해제 → 가용을 넘는 ACTIVE 예약 축소 (SYSTEM, QUALITY_FAILURE)
   *  - 적격이 된 LOT: 늘어난 매수 안에서 그 LOT을 만든 계획의 수주 품목에 미확보 매수만큼 1매씩 자동 예약 (SYSTEM)
   *    계획이 수주에서 해제됐으면(여재) 예약하지 않는다 (REQ-INV-004, [ERD] lot Note)
   * 히트를 넘기면 하위 슬래브·코일까지 본다.
   */
  async onLotsEligibilityChanged(tx: Tx, lotIds: readonly number[], actor: Actor): Promise<EligibilitySyncResult[]> {
    const productLotIds = await this.repository.findAffectedProductLotIds(tx, [...lotIds]);
    if (productLotIds.length === 0) return [];
    const lots = await this.repository.findProductLots(tx, productLotIds);
    const eligibleLotIds = new Set<number>();
    for (const lot of lots) {
      const eligibility = await this.repository.findLotEligibility(tx, lot.id);
      if (eligibility?.is_eligible && lot.lotStatus === LOT_STATUS.AVAILABLE) eligibleLotIds.add(lot.id);
    }
    const triggeredBy = actor === 'SYSTEM' ? null : actor.employeeId;
    const refreshRequestIds = new Set<number>();
    const results: EligibilitySyncResult[] = [];

    // 재고 행 잠금 순서를 고정한다 (item_id 오름차순, 13.2)
    const itemIds = [...new Set(lots.flatMap((l) => (l.itemId === null ? [] : [l.itemId])))].sort((a, b) => a - b);
    for (const itemId of itemIds) {
      await this.repository.ensureInventory(tx, itemId);
      const inventory = await this.repository.lockInventory(tx, itemId);
      if (!inventory) continue;
      const ofItem = lots.filter((l) => l.itemId === itemId);
      const ineligible = ofItem.filter((l) => !eligibleLotIds.has(l.id));

      // 1. 적격이 아닌 LOT의 확정 배정 해제 (출하·열연 모두)
      const allocations = await this.repository.findConfirmedAllocationsOfLots(tx, ineligible.map((l) => l.id));
      let rollingReleased = 0;
      for (const allocation of allocations) {
        await this.releaseRow(tx, allocation, 'SYSTEM', `QUALITY_FAILURE: ${allocation.lot.lotNo}이 불합격(또는 상위 히트 불합격)이라 배정 해제`);
        if (allocation.allocationPurpose === ALLOCATION_PURPOSE.HOT_ROLLING) rollingReleased += 1;
        if (allocation.shipmentRequestItem) refreshRequestIds.add(allocation.shipmentRequestItem.shipmentRequestId);
      }
      if (rollingReleased > 0) await this.repository.decrementRollingAllocatedQty(tx, itemId, rollingReleased);

      // 2. 가용을 넘는 예약을 먼저 줄이고 on_hand를 맞춘다 (CHECK: on_hand − reserved − rolling ≥ 0)
      const onHandQty = await this.repository.countEligibleAvailableLots(tx, itemId);
      const rollingQty = inventory.rolling_allocated_qty - rollingReleased;
      const excessQty = inventory.reserved_qty + rollingQty - onHandQty;
      // 어느 예약을 줄일지 문서에 없어 정한 값(inventory.md 8장 🟡): 불합격 LOT을 만든 계획의 수주 품목 예약부터, 그다음 최근 예약부터
      const preferred = new Set(ineligible.flatMap((l) => (l.productionResult?.productionPlan?.salesOrderItemId ? [l.productionResult.productionPlan.salesOrderItemId] : [])));
      const releasedReservationQty = excessQty > 0 ? await this.shrinkReservations(tx, itemId, excessQty, preferred, triggeredBy) : 0;
      await this.repository.setOnHandQty(tx, itemId, onHandQty);

      // 3. 늘어난 매수 안에서 자동 예약
      let room = onHandQty - inventory.on_hand_qty;
      let autoReservedQty = 0;
      for (const lot of ofItem) {
        if (room <= 0) break;
        if (!eligibleLotIds.has(lot.id)) continue;
        const plan = lot.productionResult?.productionPlan;
        if (!plan?.salesOrderItemId || plan.itemId !== itemId) continue;
        if (await this.autoReserveOne(tx, plan.salesOrderItemId, itemId, lot, triggeredBy)) {
          room -= 1;
          autoReservedQty += 1;
        }
      }
      results.push({ itemId, onHandQty, autoReservedQty, releasedReservationQty, releasedAllocationCount: allocations.length });
    }
    for (const shipmentRequestId of refreshRequestIds) await this.shipment.refreshAllocationStatus(tx, shipmentRequestId);
    return results;
  }

  /** 자동 예약 1매: 수주 품목이 진행 중이고 미확보 매수(미출하 − ACTIVE 예약)가 남았고 가용이 1 이상일 때만 */
  private async autoReserveOne(tx: Tx, salesOrderItemId: number, itemId: number, lot: { id: number; lotNo: string }, triggeredBy: number | null): Promise<boolean> {
    const soItem = await this.repository.findSalesOrderItemSecured(tx, salesOrderItemId);
    if (!soItem || soItem.itemId !== itemId) return false;
    if (soItem.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.OPEN && soItem.salesOrderItemStatus !== SALES_ORDER_ITEM_STATUS.PARTIALLY_SHIPPED) return false;
    const unsecuredQty = soItem.orderedQty - soItem.convertedQty - soItem.activeQty;
    if (unsecuredQty <= 0) return false;
    if (!(await this.repository.reserveQty(tx, itemId, 1))) return false;
    const reservation = await this.repository.createReservation(tx, { salesOrderItemId, itemId, reservedQty: 1 });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.RESERVATION_CREATED,
      actor: 'SYSTEM',
      target: { table: 'reservation', id: reservation.id },
      salesOrderId: soItem.salesOrderId,
      lotIds: [lot.id],
      after: { ...reservationSnapshot(reservation), triggeredByEmployeeId: triggeredBy },
      reason: `자동 예약: ${lot.lotNo} 합격으로 원래 수주 품목 부족분 1매 예약 (미확보 ${unsecuredQty}매)`,
    });
    return true;
  }

  /** 초과 예약 축소: preferred 수주 품목의 예약부터, 그다음 최근 예약부터 줄인다. 일부만 줄이면 ACTIVE를 나누고 줄인 몫은 RELEASED 행으로 남긴다 */
  private async shrinkReservations(tx: Tx, itemId: number, excessQty: number, preferred: ReadonlySet<number>, triggeredBy: number | null): Promise<number> {
    const actives = await this.repository.findActiveReservationsOfItem(tx, itemId);
    const ordered = [...actives.filter((r) => preferred.has(r.salesOrderItemId)), ...actives.filter((r) => !preferred.has(r.salesOrderItemId))];
    let remaining = excessQty;
    for (const reservation of ordered) {
      if (remaining <= 0) break;
      const cutQty = Math.min(remaining, reservation.reservedQty);
      const released =
        cutQty === reservation.reservedQty
          ? await this.repository.updateReservationStatus(tx, reservation.id, RESERVATION_STATUS.RELEASED)
          : await this.repository.createReleasedReservation(tx, { salesOrderItemId: reservation.salesOrderItemId, itemId, reservedQty: cutQty });
      if (cutQty < reservation.reservedQty) await this.repository.updateReservationQty(tx, reservation.id, reservation.reservedQty - cutQty);
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.RESERVATION_RELEASED,
        actor: 'SYSTEM',
        target: { table: 'reservation', id: released.id },
        salesOrderId: reservation.salesOrderItem.salesOrderId,
        before: reservationSnapshot(reservation),
        after: { ...reservationSnapshot(released), triggeredByEmployeeId: triggeredBy },
        reason: `QUALITY_FAILURE: 불합격으로 합격 재고가 줄어 예약 ${cutQty}매 축소`,
      });
      remaining -= cutQty;
    }
    const releasedQty = excessQty - remaining;
    if (releasedQty > 0 && !(await this.repository.releaseReservedQty(tx, itemId, releasedQty))) {
      throw new Error(`inventory.reserved_qty가 ACTIVE 예약 합계보다 작습니다 (item ${itemId}, 축소 ${releasedQty})`);
    }
    return releasedQty;
  }

  // ── 배정 (REQ-INV-006, BP-SHP-01) ──────────────────────

  /** 배정 추천: 저장하지 않고 작업 로그(ALLOCATION_RECOMMENDED)만 남긴다. 후보 전부를 FIFO 순서로 주고 앞에서 미배정 매수만큼 추천한다 */
  async recommendAllocations(user: AuthUser, dto: RecommendAllocationDto): Promise<AllocationRecommendation> {
    this.assertPurposePermission(user, dto.allocationPurpose, 'USE');
    return this.prisma.$transaction(async (tx) => {
      const requestItem = await this.openShipmentRequestItem(tx, dto.shipmentRequestItemId);
      const unallocatedQty = requestItem.requestQty - (await this.repository.countConfirmedShipmentAllocations(tx, requestItem.id));
      const lots = await this.repository.findAllocatableLots(tx, requestItem.salesOrderItem.itemId);
      if (unallocatedQty > 0 && lots.length === 0) throw new AppException('INV-001', '배정할 수 있는 합격 LOT이 없어요');
      const candidates: AllocationCandidate[] = lots.map((lot, index) => ({
        lotId: lot.id,
        lotNo: lot.lot_no,
        producedDate: dateOnly(lot.produced_date),
        heatNo: lot.heat_no,
        yardId: lot.yard_id,
        isRecommended: index < unallocatedQty,
      }));
      const recommended = candidates.filter((c) => c.isRecommended);
      // 미배정 매수가 없으면 추천한 LOT이 없으므로 작업 로그도 남기지 않는다
      if (recommended.length > 0) await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.ALLOCATION_RECOMMENDED,
        actor: user,
        target: { table: 'shipment_request_item', id: requestItem.id },
        salesOrderId: requestItem.salesOrderItem.salesOrderId,
        lotIds: recommended.map((c) => c.lotId),
        after: { unallocatedQty, recommendedLotNos: recommended.map((c) => c.lotNo) },
        reason: `FIFO_RECOMMENDATION: 생산완료일이 오래된 순으로 ${recommended.length}개 추천 (미배정 ${unallocatedQty}매)`,
      });
      return { allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT, shipmentRequestItemId: requestItem.id, itemId: requestItem.salesOrderItem.itemId, unallocatedQty, candidates };
    });
  }

  /**
   * 출하요청 품목별 배정 후보와 FIFO 추천 (조회만, 작업 로그 없음). 배정 화면이 열릴 때 보여 준다.
   * 추천을 작업 로그로 남기는 것은 POST allocations/recommend다.
   */
  async listShipmentCandidates(user: AuthUser, shipmentRequestId: number): Promise<ShipmentAllocationCandidates[]> {
    this.assertPurposePermission(user, ALLOCATION_PURPOSE.SHIPMENT, 'VIEW');
    const tx = this.prisma;
    const items = await this.repository.findShipmentRequestItemsOfRequest(tx, shipmentRequestId);
    const lotsByItem = new Map<number, Awaited<ReturnType<InventoryRepository['findAllocatableLots']>>>();
    const taken = new Set<number>();
    const result: ShipmentAllocationCandidates[] = [];
    for (const line of items) {
      const itemId = line.salesOrderItem.itemId;
      if (!lotsByItem.has(itemId)) lotsByItem.set(itemId, await this.repository.findAllocatableLots(tx, itemId));
      const lots = lotsByItem.get(itemId) ?? [];
      const allocatedQty = line._count.allocations;
      const unallocatedQty = Math.max(0, line.requestQty - allocatedQty);
      // 같은 규격 품목이 여러 줄이면 앞 줄이 추천받은 LOT은 뒤 줄 추천에서 뺀다 ([추천대로 모두 확정]이 INV-003에 걸리지 않게)
      const recommendedIds = new Set(lots.filter((l) => !taken.has(l.id)).slice(0, unallocatedQty).map((l) => l.id));
      recommendedIds.forEach((id) => taken.add(id));
      result.push({
        shipmentRequestItemId: line.id,
        salesOrderItemId: line.salesOrderItem.id,
        itemId,
        requestQty: line.requestQty,
        allocatedQty,
        unallocatedQty,
        candidates: lots.map((l) => ({ lotId: l.id, lotNo: l.lot_no, producedDate: dateOnly(l.produced_date), heatNo: l.heat_no, yardId: l.yard_id, isRecommended: recommendedIds.has(l.id) })),
      });
    }
    return result;
  }

  /** 배정 확정: 고른 LOT마다 CONFIRMED 배정 1건. 같은 LOT의 동시 확정은 부분 unique(allocation_confirmed_lot_key)가 막는다 (REQ-INV-009) */
  async confirmAllocations(user: AuthUser, dto: ConfirmAllocationDto): Promise<AllocationView[]> {
    this.assertPurposePermission(user, dto.allocationPurpose, 'USE');
    return this.prisma.$transaction(async (tx) => {
      const requestItem = await this.openShipmentRequestItem(tx, dto.shipmentRequestItemId);
      const unallocatedQty = requestItem.requestQty - (await this.repository.countConfirmedShipmentAllocations(tx, requestItem.id));
      if (dto.lotIds.length > unallocatedQty) throw new AppException('INV-001', `미배정 매수는 ${unallocatedQty}매예요`);

      const created: AllocationView[] = [];
      for (const lotId of [...dto.lotIds].sort((a, b) => a - b)) {
        await this.assertAllocatableLot(tx, lotId, requestItem.salesOrderItem.itemId);
        const allocation = await this.repository.createShipmentAllocation(tx, lotId, requestItem.id);
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.ALLOCATION_CONFIRMED,
          actor: user,
          target: { table: 'allocation', id: allocation.id },
          salesOrderId: requestItem.salesOrderItem.salesOrderId,
          lotIds: [lotId],
          after: allocationSnapshot(allocation),
        });
        created.push(toAllocationView(allocation));
      }
      await this.shipment.refreshAllocationStatus(tx, requestItem.shipmentRequest.id);
      return created;
    });
  }

  /** 배정 해제(newLotId 없음) 또는 변경(기존 해제 + 새 LOT 확정을 한 트랜잭션에서). 소진된 배정은 바꿀 수 없다 (INV-004) */
  async releaseAllocation(user: AuthUser, allocationId: number, dto: ReleaseAllocationDto): Promise<AllocationView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.repository.findAllocation(tx, allocationId);
      if (!found) throw new AppException('COM-003');
      this.assertPurposePermission(user, found.allocationPurpose as AllocationPurpose, 'USE');
      if (found.allocationPurpose !== ALLOCATION_PURPOSE.SHIPMENT || found.shipmentRequestItemId === null) {
        throw new AppException('COM-002', '열연 투입 배정은 생산 화면에서 바꿔요');
      }
      const { requestItem, status } = await this.lockShipmentRequestItem(tx, found.shipmentRequestItemId);
      // 잠근 뒤 다시 읽는다: 그사이 출고 확정·다른 해제가 끝났을 수 있다
      const allocation = (await this.repository.findAllocation(tx, allocationId)) ?? found;
      if (allocation.allocationStatus === ALLOCATION_STATUS.CONSUMED) throw new AppException('INV-004');
      if (allocation.allocationStatus === ALLOCATION_STATUS.RELEASED) throw new AppException('COM-001', '이미 해제된 배정이에요');
      this.assertOpenShipmentRequest(status);
      if (dto.newLotId === allocation.lotId) throw new AppException('COM-004', '지금 배정된 LOT과 같은 LOT이에요');

      const released = await this.repository.updateAllocationStatus(tx, allocation.id, ALLOCATION_STATUS.RELEASED);
      const salesOrderId = requestItem.salesOrderItem.salesOrderId;
      let result = released;
      if (dto.newLotId === undefined) {
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED,
          actor: user,
          target: { table: 'allocation', id: allocation.id },
          salesOrderId,
          lotIds: [allocation.lotId],
          before: allocationSnapshot(allocation),
          after: allocationSnapshot(released),
          reason: dto.reason ?? null,
        });
      } else {
        await this.assertAllocatableLot(tx, dto.newLotId, requestItem.salesOrderItem.itemId);
        result = await this.repository.createShipmentAllocation(tx, dto.newLotId, requestItem.id);
        await this.businessEventRecorder.record(tx, {
          type: BUSINESS_EVENT_TYPE.ALLOCATION_CHANGED,
          actor: user,
          target: { table: 'allocation', id: result.id },
          salesOrderId,
          lotIds: [allocation.lotId, dto.newLotId],
          before: allocationSnapshot(allocation),
          after: allocationSnapshot(result),
          reason: `ALLOCATION_CHANGE: ${allocation.lot.lotNo} → ${result.lot.lotNo}${dto.reason ? ` · ${dto.reason}` : ''}`,
        });
      }
      await this.shipment.refreshAllocationStatus(tx, requestItem.shipmentRequest.id);
      return toAllocationView(result);
    });
  }

  async listAllocations(user: AuthUser, query: ListAllocationsQuery): Promise<AllocationView[]> {
    this.assertPurposePermission(user, query.allocationPurpose, 'VIEW');
    const rows = await this.repository.findAllocations(this.prisma, {
      allocationPurpose: query.allocationPurpose,
      shipmentRequestId: query.shipmentRequestId,
      shipmentRequestItemId: query.shipmentRequestItemId,
    });
    return rows.map(toAllocationView);
  }

  /**
   * 출고 확정: 수주 품목의 ACTIVE 예약을 qty만큼 CONVERTED로 바꾸고 현재고·예약 매수를 줄인다 (REQ-INV-005, shipment가 부른다).
   * 예약이 qty보다 크면 행을 나눈다. 규격 재고 행을 먼저 잠그므로 호출하는 쪽은 규격(item_id) 오름차순으로 부른다.
   */
  async convertReservations(tx: Tx, input: { salesOrderId: number; salesOrderItemId: number; itemId: number; qty: number; lotIds: number[]; actor: Actor }): Promise<number> {
    await this.repository.lockInventory(tx, input.itemId);
    const active = await this.repository.findReservationsOfItem(tx, input.salesOrderItemId, RESERVATION_STATUS.ACTIVE);
    let remaining = input.qty;
    for (const reservation of active) {
      if (remaining === 0) break;
      const take = Math.min(reservation.reservedQty, remaining);
      const converted =
        take === reservation.reservedQty
          ? await this.repository.updateReservationStatus(tx, reservation.id, RESERVATION_STATUS.CONVERTED)
          : (await this.repository.splitReservation(tx, reservation, take)).converted;
      remaining -= take;
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.RESERVATION_CONVERTED,
        actor: input.actor,
        target: { table: 'reservation', id: converted.id },
        salesOrderId: input.salesOrderId,
        lotIds: input.lotIds,
        before: reservationSnapshot(reservation),
        after: reservationSnapshot(converted),
      });
    }
    // 출하 가능 매수 검사(SHP-002)와 같은 잠금 안에서 불러서 여기까지 오면 예약이 모자랄 수 없다. 모자라면 호출한 쪽의 검사가 빠진 것이다
    if (remaining > 0) throw new AppException('SHP-002', `수주 품목(id ${input.salesOrderItemId})의 ACTIVE 예약이 ${input.qty}매보다 적어요`);
    if (!(await this.repository.consumeOnHandAndReserved(tx, input.itemId, input.qty))) {
      // on_hand·reserved_qty가 LOT·예약 합계와 어긋난 경우다. 업무 오류가 아니라 서버 오류로 남긴다
      throw new Error(`inventory 현재고·예약 매수가 출고 매수보다 작습니다 (item ${input.itemId}, 출고 ${input.qty})`);
    }
    return input.qty;
  }

  /** 출고 확정: 배정을 소진(CONSUMED)으로 (shipment가 부른다). 소진 기록은 GOODS_ISSUE_CONFIRMED 작업 로그가 대신한다 */
  async consumeShipmentAllocations(tx: Tx, allocationIds: number[]): Promise<void> {
    if (!(await this.repository.consumeConfirmedAllocations(tx, allocationIds))) {
      // 출하요청을 잠근 안이라 확정 배정이 바뀔 수 없다. 어긋났으면 서버 오류로 남기고 전부 되돌린다
      throw new Error(`소진할 배정 일부가 CONFIRMED가 아닙니다 (배정 ${allocationIds.join(",")})`);
    }
  }

  /** 출하요청 취소: 그 요청의 CONFIRMED 배정을 모두 해제한다 (shipment가 부른다) */
  async releaseShipmentAllocationsOfRequest(tx: Tx, input: { shipmentRequestId: number; actor: Actor; reason: string }): Promise<number[]> {
    const confirmed = await this.repository.findAllocations(tx, {
      allocationPurpose: ALLOCATION_PURPOSE.SHIPMENT,
      shipmentRequestId: input.shipmentRequestId,
      allocationStatus: [ALLOCATION_STATUS.CONFIRMED],
    });
    for (const allocation of confirmed) await this.releaseRow(tx, allocation, input.actor, input.reason);
    return confirmed.map((a) => a.lotId);
  }

  /** 생산계획 취소·수주 연결 해제: 그 계획의 CONFIRMED 열연 배정을 해제하고 rolling_allocated_qty를 줄인다 (production이 부른다) */
  async releaseHotRollingAllocationsOfPlan(tx: Tx, input: { productionPlanId: number; salesOrderId: number | null; actor: Actor; reason: string }): Promise<number[]> {
    const confirmed = await this.repository.findAllocations(tx, {
      allocationPurpose: ALLOCATION_PURPOSE.HOT_ROLLING,
      productionPlanId: input.productionPlanId,
      allocationStatus: [ALLOCATION_STATUS.CONFIRMED],
    });
    const byItem = new Map<number, AllocationRow[]>();
    for (const allocation of confirmed) {
      const itemId = allocation.lot.itemId;
      if (itemId === null) continue;
      byItem.set(itemId, [...(byItem.get(itemId) ?? []), allocation]);
    }
    for (const [itemId, rows] of [...byItem.entries()].sort(([a], [b]) => a - b)) {
      await this.repository.lockInventory(tx, itemId);
      for (const allocation of rows) await this.releaseRow(tx, allocation, input.actor, input.reason, input.salesOrderId);
      await this.repository.decrementRollingAllocatedQty(tx, itemId, rows.length);
    }
    return confirmed.map((a) => a.lotId);
  }

  // ── 내부 ──────────────────────────────────────────────

  private async releaseRow(tx: Tx, allocation: AllocationRow, actor: Actor, reason: string, salesOrderId = salesOrderIdOf(allocation)) {
    const released = await this.repository.updateAllocationStatus(tx, allocation.id, ALLOCATION_STATUS.RELEASED);
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED,
      actor,
      target: { table: 'allocation', id: allocation.id },
      salesOrderId,
      lotIds: [allocation.lotId],
      before: allocationSnapshot(allocation),
      after: allocationSnapshot(released),
      reason,
    });
  }

  /** 출하요청 품목을 찾고 그 출하요청을 잠근다 */
  private async lockShipmentRequestItem(tx: Tx, shipmentRequestItemId: number) {
    const requestItem = await this.repository.findShipmentRequestItem(tx, shipmentRequestItemId);
    if (!requestItem) throw new AppException('COM-003');
    const locked = await this.repository.lockShipmentRequest(tx, requestItem.shipmentRequestId);
    return { requestItem, status: locked?.shipment_request_status };
  }

  /** 배정을 바꿀 수 있는 상태: 배정 대기·배정 확정 */
  private assertOpenShipmentRequest(status: string | undefined): void {
    if (status !== SHIPMENT_REQUEST_STATUS.REQUESTED && status !== SHIPMENT_REQUEST_STATUS.ALLOCATED) {
      throw new AppException('COM-001', '출고 확정·취소된 출하요청은 배정을 바꿀 수 없어요');
    }
  }

  private async openShipmentRequestItem(tx: Tx, shipmentRequestItemId: number) {
    const { requestItem, status } = await this.lockShipmentRequestItem(tx, shipmentRequestItemId);
    this.assertOpenShipmentRequest(status);
    return requestItem;
  }

  /** 배정 직전 재검증 (13.2 confirmAllocation): 규격 일치, 재고 상태, 적격, 확정 배정 없음 */
  private async assertAllocatableLot(tx: Tx, lotId: number, itemId: number): Promise<void> {
    const lot = await this.loadEligibleLot(tx, lotId, itemId);
    if (lot.confirmed_allocation_id !== null) throw new AppException('INV-003', `${lot.lot_no}은 이미 배정된 LOT이에요`);
  }

  /**
   * 출고 직전 LOT 재검증 (13.3 confirmGoodsIssue, shipment가 부른다): 규격 일치, 재고(AVAILABLE) 상태, 제품 + 상위 히트 합격.
   * 출고하는 LOT은 자기 CONFIRMED 배정이 있어야 하므로 배정 여부는 보지 않는다.
   */
  async assertIssuableLot(tx: Tx, lotId: number, itemId: number): Promise<void> {
    await this.loadEligibleLot(tx, lotId, itemId);
  }

  private async loadEligibleLot(tx: Tx, lotId: number, itemId: number) {
    const lot = await this.repository.findLotEligibility(tx, lotId);
    if (!lot) throw new AppException('COM-003', `LOT(${lotId})을 찾을 수 없어요`);
    // 규격 불일치용 오류 코드가 정의서 9.3에 없다 (docs/backend/inventory.md 8장 🟡)
    if (lot.item_id !== itemId) throw new AppException('COM-004', `${lot.lot_no}은 수주 품목과 규격이 달라요`);
    if (lot.lot_status !== LOT_STATUS.AVAILABLE) throw new AppException('INV-004', `${lot.lot_no}은 이미 투입·출고된 LOT이에요`);
    if (!lot.is_eligible) throw new AppException('INV-002', `${lot.lot_no}은 제품 또는 상위 히트가 합격이 아니에요`);
    return lot;
  }

  /** 배정 목적별 권한: 출하 = 출하요청·배정 확정, 열연 = 열연 투입 배정 */
  private assertPurposePermission(user: AuthUser, purpose: AllocationPurpose, level: PermissionLevel): void {
    const permission = purpose === ALLOCATION_PURPOSE.SHIPMENT ? PERMISSION.SHIPMENT_REQUEST_MANAGE : PERMISSION.HOT_ROLLING_ALLOCATE;
    if (!hasPermission(user, { permission, level })) throw new AppException('COM-002');
  }
}
