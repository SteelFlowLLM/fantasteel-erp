import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
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
  type InspectionResult,
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
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { ShipmentService } from '../shipment/shipment.service';
import type { ConfirmAllocationDto, ListAllocationsQuery, RecommendAllocationDto, ReleaseAllocationDto } from './dto/allocation.dto';
import { InventoryRepository } from './inventory.repository';

type Actor = AuthUser | 'SYSTEM';
type AllocationRow = NonNullable<Awaited<ReturnType<InventoryRepository['findAllocation']>>>;
/** 판정으로 적격이 달라진 재고 상태 제품 LOT */
type EligibilityChange = { lotId: number; lotNo: string; itemId: number; isEligible: boolean };

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

  // ── 적격 변화 (REQ-INV-003·004·007, quality.md 4장) ────

  /**
   * 검사 판정이 바뀐 뒤 재고에 반영한다. quality가 판정과 같은 tx에서 부르고, 작업 로그 주체는 SYSTEM이다.
   * 적격 = 자기 PASS + 상위 히트 PASS. 판정 전 결과(previousResult, 첫 등록이면 null)로 전 적격을 다시 계산해 비교한다.
   * 문서의 권장 모양 (tx, lotIds, actor)과 달리 검사한 LOT 하나와 전 결과를 받는다: 판정 전 적격은 저장돼 있지 않아서다.
   * - 적격이 됨: on_hand +1 → 원래 수주 품목의 미확보 매수 안에서 1매 자동 예약
   * - 적격에서 빠짐: 확정 배정 해제 → 가용이 모자라면 예약 축소 → on_hand −1
   * on_hand는 재고 상태(AVAILABLE) LOT만 세므로 투입·출고된 LOT은 건드리지 않는다.
   */
  async onLotsEligibilityChanged(tx: Tx, input: { lotId: number; previousResult: InspectionResult | null }): Promise<void> {
    const wasPassed = input.previousResult === INSPECTION_RESULT.PASS;
    const targets = await this.repository.findEligibilityTargets(tx, input.lotId);
    const changes: EligibilityChange[] = targets.flatMap((t) => {
      if (t.item_id === null || t.lot_status !== LOT_STATUS.AVAILABLE) return [];
      const isOwnPassed = t.is_own_passed === true;
      const isHeatPassed = t.is_heat_passed === true;
      // 검사한 LOT이 이 제품이면 자기 판정이, 아니면(히트) 상위 히트 판정이 바뀐 것이다
      const wasEligible = t.id === input.lotId ? wasPassed && isHeatPassed : isOwnPassed && wasPassed;
      const isEligible = isOwnPassed && isHeatPassed;
      return wasEligible === isEligible ? [] : [{ lotId: t.id, lotNo: t.lot_no, itemId: t.item_id, isEligible }];
    });

    // 잠금 순서 inventory(item_id 오름차순) → reservation → allocation (업무 프로세스 13.2). 대상은 item_id 순으로 온다
    for (const itemId of new Set(changes.map((c) => c.itemId))) {
      const ofItem = changes.filter((c) => c.itemId === itemId);
      await this.repository.ensureInventory(tx, itemId);
      await this.repository.lockInventory(tx, itemId);
      for (const lot of ofItem.filter((c) => !c.isEligible)) await this.removeIneligibleLot(tx, lot);
      for (const lot of ofItem.filter((c) => c.isEligible)) await this.addEligibleLot(tx, lot);
    }
  }

  // ── 내부 ──────────────────────────────────────────────

  /** 적격이 됨: on_hand +1, 원래 수주 품목에 미확보 매수가 있으면 1매 자동 예약 (REQ-INV-004). 없으면 여재로 남는다 */
  private async addEligibleLot(tx: Tx, lot: EligibilityChange): Promise<void> {
    await this.repository.changeOnHandQty(tx, lot.itemId, 1);
    const salesOrderItem = (await this.repository.findLotOrigin(tx, lot.lotId))?.productionResult?.productionPlan?.salesOrderItem;
    // 계획이 수주에서 해제됐으면(null) 예약하지 않는다 (inventory.md 4장)
    if (!salesOrderItem || salesOrderItem.itemId !== lot.itemId || salesOrderItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) return;

    const sums = await this.repository.sumReservedQtyByStatus(tx, salesOrderItem.id);
    const sumOf = (status: ReservationStatus) => sums.find((s) => s.reservationStatus === status)?._sum.reservedQty ?? 0;
    const unsecuredQty = Math.max(0, salesOrderItem.orderedQty - sumOf(RESERVATION_STATUS.CONVERTED) - sumOf(RESERVATION_STATUS.ACTIVE));
    if (unsecuredQty === 0 || !(await this.repository.reserveQty(tx, lot.itemId, 1))) return;

    const reservation = await this.repository.createReservation(tx, { salesOrderItemId: salesOrderItem.id, itemId: lot.itemId, reservedQty: 1 });
    await this.businessEventRecorder.record(tx, {
      type: BUSINESS_EVENT_TYPE.RESERVATION_CREATED,
      actor: 'SYSTEM',
      target: { table: 'reservation', id: reservation.id },
      salesOrderId: salesOrderItem.salesOrderId,
      lotIds: [lot.lotId],
      after: reservationSnapshot(reservation),
      reason: `자동 예약: ${lot.lotNo} 합격으로 미확보 ${unsecuredQty}매 중 1매 예약`,
    });
  }

  /** 적격에서 빠짐: 확정 배정 해제, 가용이 음수가 되지 않게 예약 축소, on_hand −1 ([ERD] inventory 갱신 규칙) */
  private async removeIneligibleLot(tx: Tx, lot: EligibilityChange): Promise<void> {
    const allocation = await this.repository.findConfirmedAllocationOfLot(tx, lot.lotId);
    if (allocation) {
      await this.releaseRow(tx, allocation, 'SYSTEM', `QUALITY_FAILURE: ${lot.lotNo}이 적격에서 빠져 배정 해제`);
      if (allocation.allocationPurpose === ALLOCATION_PURPOSE.HOT_ROLLING) {
        await this.repository.decrementRollingAllocatedQty(tx, lot.itemId, 1);
      } else if (allocation.shipmentRequestItem) {
        await this.shipment.refreshAllocationStatus(tx, allocation.shipmentRequestItem.shipmentRequestId);
      }
    }
    const inventory = await this.repository.lockInventory(tx, lot.itemId);
    if (!inventory) throw new Error(`적격 LOT ${lot.lotNo}의 재고 행이 없습니다 (item ${lot.itemId})`);
    const shortQty = inventory.reserved_qty + inventory.rolling_allocated_qty - (inventory.on_hand_qty - 1);
    if (shortQty > 0) await this.shrinkReservations(tx, lot, shortQty);
    await this.repository.changeOnHandQty(tx, lot.itemId, -1);
  }

  /**
   * 불합격으로 모자라게 된 매수만큼 ACTIVE 예약을 줄인다. 그 LOT을 만든 계획의 수주 품목부터, 그다음 최근 예약부터
   * (2026-10-06 결정, inventory.md 8장 "FAIL 시 줄일 예약"). 일부만 줄이면 출고 전환처럼 행을 나눠 RELEASED 이력을 남긴다.
   */
  private async shrinkReservations(tx: Tx, lot: EligibilityChange, qty: number): Promise<void> {
    const originItemId = (await this.repository.findLotOrigin(tx, lot.lotId))?.productionResult?.productionPlan?.salesOrderItem?.id ?? null;
    const active = await this.repository.findActiveReservationsOfInventoryItem(tx, lot.itemId);
    const ordered = [...active.filter((r) => r.salesOrderItemId === originItemId), ...active.filter((r) => r.salesOrderItemId !== originItemId)];

    let remaining = qty;
    for (const reservation of ordered) {
      if (remaining === 0) break;
      const cut = Math.min(remaining, reservation.reservedQty);
      remaining -= cut;
      let released;
      if (cut === reservation.reservedQty) {
        released = await this.repository.updateReservationStatus(tx, reservation.id, RESERVATION_STATUS.RELEASED);
      } else {
        await this.repository.updateReservationQty(tx, reservation.id, reservation.reservedQty - cut);
        released = await this.repository.createReservation(
          tx,
          { salesOrderItemId: reservation.salesOrderItemId, itemId: lot.itemId, reservedQty: cut },
          RESERVATION_STATUS.RELEASED,
        );
      }
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.RESERVATION_RELEASED,
        actor: 'SYSTEM',
        target: { table: 'reservation', id: released.id },
        salesOrderId: reservation.salesOrderItem.salesOrderId,
        lotIds: [lot.lotId],
        before: reservationSnapshot(reservation),
        after: reservationSnapshot(released),
        reason: `QUALITY_FAILURE: ${lot.lotNo}이 적격에서 빠져 가용이 줄어 ${cut}매 예약 해제`,
      });
    }
    // reserved_qty = ACTIVE 예약 합계 불변조건이 깨진 경우다. 업무 오류가 아니라 서버 오류로 남긴다
    if (remaining > 0 || !(await this.repository.releaseReservedQty(tx, lot.itemId, qty))) {
      throw new Error(`불합격 예약 축소 실패: item ${lot.itemId}, 필요 ${qty}매, 남음 ${remaining}매`);
    }
  }

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
    const lot = await this.repository.findLotEligibility(tx, lotId);
    if (!lot) throw new AppException('COM-003', `LOT(${lotId})을 찾을 수 없어요`);
    // 규격 불일치용 오류 코드가 정의서 9.3에 없다 (docs/backend/inventory.md 8장 🟡)
    if (lot.item_id !== itemId) throw new AppException('COM-004', `${lot.lot_no}은 수주 품목과 규격이 달라요`);
    if (lot.lot_status !== LOT_STATUS.AVAILABLE) throw new AppException('INV-004', `${lot.lot_no}은 이미 투입·출고된 LOT이에요`);
    if (!lot.is_eligible) throw new AppException('INV-002', `${lot.lot_no}은 제품 또는 상위 히트가 합격이 아니에요`);
    if (lot.confirmed_allocation_id !== null) throw new AppException('INV-003', `${lot.lot_no}은 이미 배정된 LOT이에요`);
  }

  /** 배정 목적별 권한: 출하 = 출하요청·배정 확정, 열연 = 열연 투입 배정 */
  private assertPurposePermission(user: AuthUser, purpose: AllocationPurpose, level: PermissionLevel): void {
    const permission = purpose === ALLOCATION_PURPOSE.SHIPMENT ? PERMISSION.SHIPMENT_REQUEST_MANAGE : PERMISSION.HOT_ROLLING_ALLOCATE;
    if (!hasPermission(user, { permission, level })) throw new AppException('COM-002');
  }
}
