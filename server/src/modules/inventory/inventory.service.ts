import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  BUSINESS_EVENT_TYPE,
  LOT_STATUS,
  PERMISSION,
  RESERVATION_STATUS,
  SHIPMENT_REQUEST_STATUS,
  calcWeightTon,
  type AllocationCandidate,
  type AllocationPurpose,
  type AllocationRecommendation,
  type AllocationStatus,
  type AllocationView,
  type AuthUser,
  type ItemType,
  type LotStatus,
  type ProductStockRow,
  type PermissionLevel,
  type ReservationStatus,
  type SalesOrderReservationView,
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
        isRecommended: index < unallocatedQty,
      }));
      const recommended = candidates.filter((c) => c.isRecommended);
      await this.businessEventRecorder.record(tx, {
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
