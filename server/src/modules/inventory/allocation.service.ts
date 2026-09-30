import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE, ALLOCATION_STATUS, BUSINESS_EVENT_TYPE, ERROR_CODE, EVENT_REASON_CODE, EVENT_TARGET_TYPE, ITEM_TYPE, NOTIFICATION_TYPE, PERMISSION, PERMISSION_LEVEL,
  PRODUCTION_PLAN_STATUS, ROLE_CODE, SALES_ORDER_ITEM_STATUS, SHIPMENT_REQUEST_ITEM_STATUS, SHIPMENT_REQUEST_STATUS,
  type AllocationPurpose, type AllocationStatus, type AuthUser, type ShipmentRequestItemStatus, type ShipmentRequestStatus,
} from '@fantasteel/shared';
import { lockLots, lockProductInventory, lockRow } from '../../common/concurrency/locks';
import { AppException, badInput, forbidden, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { NotificationSender } from '../notification/notification.sender';
import { AllocationRepository, type ConfirmedAllocationRow, type RollingTargetRow, type ShipmentTargetRow } from './allocation.repository';
import type { ConfirmAllocationDto, RecommendAllocationDto, ReleaseAllocationDto } from './dto/allocation.dto';
import { StockService } from './stock.service';

/** 후보 목록은 화면에서 추천과 다른 LOT을 고를 때 쓴다. 한 번에 보여 줄 최대 수. */
const MAX_CANDIDATES = 200;

export interface AllocationLotView {
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  /** 생산완료일 (FIFO 기준) */
  producedAt: string;
  yardName: string | null;
  /** 열연 배정에서만 true일 수 있다: 이 코일 수주 품목에 이미 귀속된 슬래브 */
  isEarmarked: boolean;
}

export interface ConfirmedAllocationView {
  id: number;
  lotId: number;
  lotNo: string;
  lotType: string;
  heatNo: string | null;
  producedAt: string;
  status: AllocationStatus;
  confirmedAt: string;
}

export interface AllocationRecommendationView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  salesOrderItemId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  /** 배정할 LOT의 규격 (출하: 수주 품목 규격, 열연: 대응 슬래브 규격) */
  productSpecId: number;
  specCode: string;
  /** 필요한 전체 매수 (출하: 요청 매수, 열연: 지금 투입해야 할 슬래브 매수) */
  requiredQty: number;
  /** 이미 확정된 배정 수 */
  confirmedQty: number;
  /** 아직 배정해야 할 매수 = requiredQty − confirmedQty */
  neededQty: number;
  /** FIFO 추천 (neededQty만큼, 생산완료일 → LOT 번호 순). 저장하지 않는다 */
  recommendedLots: AllocationLotView[];
  /** 추천으로도 못 채우는 매수 */
  shortageQty: number;
  /** 고를 수 있는 모든 LOT (FIFO 순). 추천과 다르게 고를 때 쓴다 */
  candidateLots: AllocationLotView[];
  confirmedAllocations: ConfirmedAllocationView[];
}

export interface AllocationConfirmView {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  /** 이번에 확정한 배정 */
  allocations: ConfirmedAllocationView[];
  releasedAllocationIds: number[];
  /** 확정 시점의 FIFO 추천 LOT 번호 (작업 로그에도 남는다) */
  recommendedLotNos: string[];
  /** 추천대로 확정했는지 */
  isRecommendationFollowed: boolean;
  /** 확정 뒤 남은 배정 필요 매수 */
  neededQty: number;
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;
  shipmentRequestStatus: ShipmentRequestStatus | null;
}

export interface AllocationReleaseView {
  id: number;
  purpose: AllocationPurpose;
  status: AllocationStatus;
  lotId: number;
  lotNo: string;
  shipmentRequestItemStatus: ShipmentRequestItemStatus | null;
  shipmentRequestStatus: ShipmentRequestStatus | null;
}

/** 배정 대상(출하요청 품목 또는 코일 생산계획)을 한 모양으로 본 것. */
interface Target {
  purpose: AllocationPurpose;
  shipmentRequestItemId: number | null;
  shipmentRequestId: number | null;
  productionPlanId: number | null;
  salesOrderItemId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderLineNo: number;
  productSpecId: number;
  specCode: string;
  neededQty: number;
  confirmed: ConfirmedAllocationRow[];
  eventTarget: { targetType: 'SHIPMENT_REQUEST' | 'PRODUCTION_PLAN'; targetId: number; targetNo: string };
}

const OPEN_REQUEST: string[] = [SHIPMENT_REQUEST_STATUS.REQUESTED, SHIPMENT_REQUEST_STATUS.ALLOCATED];
const OPEN_PLAN: string[] = [PRODUCTION_PLAN_STATUS.PLANNED, PRODUCTION_PLAN_STATUS.CONFIRMED, PRODUCTION_PLAN_STATUS.IN_PROGRESS];

/**
 * 배정 API (REQ-INV-006). 실제 LOT 규칙(적격·FIFO·LOT당 CONFIRMED 1건·귀속)은 StockService에 있고,
 * 여기는 대상(출하요청 품목 / 열연 생산계획) 확인, 잠금 순서, 필요 매수, 작업 로그, 출하요청 상태를 맡는다.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AllocationRepository,
    private readonly stock: StockService,
    private readonly events: BusinessEventRecorder,
    private readonly notifications: NotificationSender,
    private readonly realtime: RealtimeService,
  ) {}

  /** FIFO 추천. 아무것도 저장하지 않는다 (추천 내용은 확정할 때 작업 로그에 남긴다). */
  async recommend(dto: RecommendAllocationDto, user: AuthUser): Promise<AllocationRecommendationView> {
    this.requirePermission(user, dto.purpose);
    const target = await this.loadTarget(this.prisma, dto);
    const recommended = await this.recommendFor(this.prisma, target, target.neededQty);
    const candidates = await this.recommendFor(this.prisma, target, MAX_CANDIDATES);
    return {
      purpose: target.purpose,
      shipmentRequestItemId: target.shipmentRequestItemId,
      shipmentRequestId: target.shipmentRequestId,
      productionPlanId: target.productionPlanId,
      salesOrderItemId: target.salesOrderItemId,
      salesOrderNo: target.salesOrderNo,
      salesOrderLineNo: target.salesOrderLineNo,
      productSpecId: target.productSpecId,
      specCode: target.specCode,
      requiredQty: target.neededQty + target.confirmed.length,
      confirmedQty: target.confirmed.length,
      neededQty: target.neededQty,
      recommendedLots: recommended.map((l) => this.toLotView(l, target)),
      shortageQty: Math.max(0, target.neededQty - recommended.length),
      candidateLots: candidates.map((l) => this.toLotView(l, target)),
      confirmedAllocations: target.confirmed.map((a) => this.toConfirmedView(a)),
    };
  }

  /**
   * 배정 확정. releaseAllocationIds가 있으면 같은 tx에서 먼저 해제한 뒤 새로 확정한다(배정 변경).
   * 잠금 순서: 출하요청(또는 생산계획·수주 품목) → 재고 풀 → LOT(id 순).
   */
  async confirm(dto: ConfirmAllocationDto, user: AuthUser): Promise<AllocationConfirmView> {
    this.requirePermission(user, dto.purpose);
    const releaseIds = dto.releaseAllocationIds ?? [];
    return this.prisma.tx(async (tx) => {
      await this.lockTarget(tx, dto);
      let target = await this.loadTarget(tx, dto);
      await lockProductInventory(tx, target.productSpecId);
      const toRelease = releaseIds.map((id) => {
        const found = target.confirmed.find((a) => a.id === id);
        if (!found) throw badInput('해제할 배정이 이 대상의 확정 배정이 아닙니다');
        return found;
      });
      await lockLots(tx, [...dto.lotIds, ...toRelease.map((a) => a.lotId)]);

      for (const a of toRelease) await this.stock.releaseAllocation(tx, a.id);
      if (toRelease.length) target = await this.loadTarget(tx, dto);

      if (dto.lotIds.length > target.neededQty) {
        throw new AppException(ERROR_CODE.INV_001, `배정할 수 있는 매수(${target.neededQty})보다 많은 LOT을 골랐습니다`);
      }
      const lots = await this.repo.findLots(tx, dto.lotIds);
      for (const lotId of dto.lotIds) {
        const lot = lots.find((l) => l.id === lotId);
        if (!lot) throw notFound('LOT');
        if (lot.productSpecId !== target.productSpecId) throw badInput(`${lot.lotNo}: 강종·규격이 일치하지 않는 LOT입니다 (필요 규격 ${target.specCode})`);
      }
      // 추천은 저장하지 않으므로 확정 시점에 다시 계산해 로그에 함께 남긴다.
      const recommended = await this.recommendFor(tx, target, target.neededQty);
      const recommendedForPick = recommended.slice(0, dto.lotIds.length);
      const isRecommendationFollowed = recommendedForPick.length === dto.lotIds.length && recommendedForPick.every((l) => dto.lotIds.includes(l.id));

      const created: ConfirmedAllocationView[] = [];
      for (const lotId of [...dto.lotIds].sort((a, b) => a - b)) {
        const { allocation, lot } = await this.stock.confirmAllocation(tx, {
          lotId,
          purpose: target.purpose,
          salesOrderItemId: target.salesOrderItemId,
          productionPlanId: target.productionPlanId,
          shipmentRequestItemId: target.shipmentRequestItemId,
          actor: user,
        });
        created.push({
          id: allocation.id, lotId: lot.id, lotNo: lot.lotNo, lotType: lot.lotType, heatNo: lot.heatLot?.lotNo ?? null,
          producedAt: lot.producedAt.toISOString(), status: allocation.status as AllocationStatus, confirmedAt: allocation.confirmedAt.toISOString(),
        });
      }

      const lotNos = created.map((c) => c.lotNo);
      const recommendedLotNos = recommended.map((l) => l.lotNo);
      const purposeLabel = target.purpose === ALLOCATION_PURPOSE.SHIPMENT ? '출하' : '열연 투입';
      await this.events.record(tx, {
        actor: user,
        eventType: BUSINESS_EVENT_TYPE.ALLOCATION_CONFIRMED,
        ...target.eventTarget,
        salesOrderId: target.salesOrderId,
        lotIds: created.map((c) => c.lotId),
        summary: `${target.salesOrderNo} #${target.salesOrderLineNo} ${purposeLabel} 배정 ${created.length}건 확정 (${lotNos.join(', ')})`,
        after: {
          purpose: target.purpose, allocationIds: created.map((c) => c.id), lotNos,
          recommendedLotNos, isRecommendationFollowed,
          shipmentRequestItemId: target.shipmentRequestItemId, productionPlanId: target.productionPlanId,
        },
        reasonCode: EVENT_REASON_CODE.FIFO_RECOMMENDATION,
        reason: isRecommendationFollowed ? 'FIFO 추천(생산완료일 → LOT 번호 순)대로 확정' : 'FIFO 추천과 다른 LOT으로 확정',
      });
      if (toRelease.length || !isRecommendationFollowed) {
        const releasedLotNos = toRelease.map((a) => a.lot.lotNo);
        await this.events.record(tx, {
          actor: user,
          eventType: BUSINESS_EVENT_TYPE.ALLOCATION_CHANGED,
          ...target.eventTarget,
          salesOrderId: target.salesOrderId,
          lotIds: [...created.map((c) => c.lotId), ...toRelease.map((a) => a.lotId)],
          summary: toRelease.length
            ? `${target.salesOrderNo} #${target.salesOrderLineNo} ${purposeLabel} 배정 변경: ${releasedLotNos.join(', ')} → ${lotNos.join(', ')}`
            : `${target.salesOrderNo} #${target.salesOrderLineNo} ${purposeLabel} 배정을 FIFO 추천과 다르게 확정: 추천 ${recommendedForPick.map((l) => l.lotNo).join(', ') || '없음'} → 확정 ${lotNos.join(', ')}`,
          before: { releasedAllocationIds: toRelease.map((a) => a.id), releasedLotNos, recommendedLotNos },
          after: { allocationIds: created.map((c) => c.id), lotNos },
          reasonCode: EVENT_REASON_CODE.ALLOCATION_CHANGE,
          reason: dto.reason?.trim() || null,
        });
      }

      const status = await this.refreshShipmentStatus(tx, target, user);
      this.realtime.changed('allocations', 'shipment-requests', 'production-plans');
      return {
        purpose: target.purpose,
        shipmentRequestItemId: target.shipmentRequestItemId,
        shipmentRequestId: target.shipmentRequestId,
        productionPlanId: target.productionPlanId,
        allocations: created,
        releasedAllocationIds: toRelease.map((a) => a.id),
        recommendedLotNos,
        isRecommendationFollowed,
        neededQty: target.neededQty - created.length,
        ...status,
      };
    });
  }

  /** 배정 해제 (출고·투입 전). CONSUMED 배정은 바꿀 수 없다. */
  async release(id: number, dto: ReleaseAllocationDto, user: AuthUser): Promise<AllocationReleaseView> {
    return this.prisma.tx(async (tx) => {
      const found = await this.repo.findAllocation(tx, id);
      if (!found) throw notFound('배정');
      const purpose = found.purpose as AllocationPurpose;
      this.requirePermission(user, purpose);
      const targetDto = { purpose, shipmentRequestItemId: found.shipmentRequestItemId ?? undefined, productionPlanId: found.productionPlanId ?? undefined };
      await this.lockTarget(tx, targetDto);
      const allocation = (await this.repo.findAllocation(tx, id))!;
      if (allocation.status === ALLOCATION_STATUS.RELEASED) throw invalidState('이미 해제된 배정입니다');
      // 열연 배정 해제는 귀속 슬래브를 재고 풀로 돌릴 수 있다. 다른 거래와 같게 재고 풀 → LOT 순서로 잠근다.
      if (allocation.lot.productSpecId) await lockProductInventory(tx, allocation.lot.productSpecId);
      await lockLots(tx, [allocation.lotId]);
      await this.stock.releaseAllocation(tx, id);

      const isShipment = purpose === ALLOCATION_PURPOSE.SHIPMENT && allocation.shipmentRequestItem;
      await this.events.record(tx, {
        actor: user,
        eventType: BUSINESS_EVENT_TYPE.ALLOCATION_RELEASED,
        targetType: isShipment ? EVENT_TARGET_TYPE.SHIPMENT_REQUEST : allocation.productionPlan ? EVENT_TARGET_TYPE.PRODUCTION_PLAN : EVENT_TARGET_TYPE.ALLOCATION,
        targetId: isShipment ? allocation.shipmentRequestItem!.shipmentRequestId : (allocation.productionPlan?.id ?? allocation.id),
        targetNo: isShipment ? allocation.shipmentRequestItem!.shipmentRequest.shipmentRequestNo : (allocation.productionPlan?.productionPlanNo ?? null),
        salesOrderId: allocation.salesOrderItem?.salesOrderId ?? null,
        lotIds: [allocation.lotId],
        summary: `${allocation.lot.lotNo} ${purpose === ALLOCATION_PURPOSE.SHIPMENT ? '출하' : '열연 투입'} 배정 해제`,
        before: { allocationId: allocation.id, status: allocation.status },
        after: { allocationId: allocation.id, status: ALLOCATION_STATUS.RELEASED },
        reasonCode: EVENT_REASON_CODE.ALLOCATION_CHANGE,
        reason: dto.reason?.trim() || null,
      });

      let status: { shipmentRequestItemStatus: ShipmentRequestItemStatus | null; shipmentRequestStatus: ShipmentRequestStatus | null } = { shipmentRequestItemStatus: null, shipmentRequestStatus: null };
      if (isShipment) {
        const requestId = allocation.shipmentRequestItem!.shipmentRequestId;
        await this.repo.updateShipmentRequestItemStatus(tx, allocation.shipmentRequestItem!.id, SHIPMENT_REQUEST_ITEM_STATUS.WAITING_ALLOCATION);
        await this.repo.updateShipmentRequestStatus(tx, requestId, SHIPMENT_REQUEST_STATUS.REQUESTED);
        status = { shipmentRequestItemStatus: SHIPMENT_REQUEST_ITEM_STATUS.WAITING_ALLOCATION, shipmentRequestStatus: SHIPMENT_REQUEST_STATUS.REQUESTED };
      }
      this.realtime.changed('allocations', 'shipment-requests', 'production-plans');
      return { id: allocation.id, purpose, status: ALLOCATION_STATUS.RELEASED, lotId: allocation.lotId, lotNo: allocation.lot.lotNo, ...status };
    });
  }

  // ───────────────────────────── 내부 ─────────────────────────────

  /** 출하 배정은 출하요청 권한, 열연 배정은 열연 투입 배정 권한. 요청 본문에 따라 달라 service에서 본다. */
  private requirePermission(user: AuthUser, purpose: AllocationPurpose): void {
    const code = purpose === ALLOCATION_PURPOSE.SHIPMENT ? PERMISSION.SHIPMENT_REQUEST : PERMISSION.ROLLING_ALLOCATE;
    if (user.permissions[code] !== PERMISSION_LEVEL.USE) throw forbidden();
  }

  private async lockTarget(tx: Tx, dto: { purpose: AllocationPurpose; shipmentRequestItemId?: number; productionPlanId?: number }): Promise<void> {
    if (dto.purpose === ALLOCATION_PURPOSE.SHIPMENT) {
      const item = await this.repo.findShipmentTarget(tx, dto.shipmentRequestItemId ?? 0);
      if (!item) throw notFound('출하요청 품목');
      await lockRow(tx, 'shipment_request', item.shipmentRequestId);
      return;
    }
    const plan = await this.repo.findRollingTarget(tx, dto.productionPlanId ?? 0);
    if (!plan) throw notFound('생산계획');
    // 같은 코일 수주 품목의 다른 계획(재생산)과 필요 매수를 겹쳐 쓰지 않도록 수주 품목도 잠근다.
    // 수주 취소가 수주 품목 → 생산계획 순서로 잡으므로 여기서도 같은 순서로 잠근다.
    if (plan.salesOrderItemId) await lockRow(tx, 'sales_order_item', plan.salesOrderItemId);
    await lockRow(tx, 'production_plan', plan.id);
  }

  private async loadTarget(tx: Tx, dto: { purpose: AllocationPurpose; shipmentRequestItemId?: number; productionPlanId?: number }): Promise<Target> {
    if (dto.purpose === ALLOCATION_PURPOSE.SHIPMENT) {
      const row = await this.repo.findShipmentTarget(tx, dto.shipmentRequestItemId ?? 0);
      if (!row) throw notFound('출하요청 품목');
      return this.shipmentTarget(row);
    }
    const row = await this.repo.findRollingTarget(tx, dto.productionPlanId ?? 0);
    if (!row) throw notFound('생산계획');
    return this.rollingTarget(tx, row);
  }

  private shipmentTarget(row: ShipmentTargetRow): Target {
    if (!OPEN_REQUEST.includes(row.shipmentRequest.shipmentRequestStatus)) throw invalidState('출고 확정되었거나 취소된 출하요청은 배정을 바꿀 수 없습니다');
    const soItem = row.salesOrderItem;
    if (soItem.salesOrder.isCancelled || soItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) throw invalidState('취소된 수주 품목입니다');
    return {
      purpose: ALLOCATION_PURPOSE.SHIPMENT,
      shipmentRequestItemId: row.id,
      shipmentRequestId: row.shipmentRequestId,
      productionPlanId: null,
      salesOrderItemId: soItem.id,
      salesOrderId: soItem.salesOrderId,
      salesOrderNo: soItem.salesOrder.salesOrderNo,
      salesOrderLineNo: soItem.lineNo,
      productSpecId: soItem.productSpecId,
      specCode: soItem.productSpec.specCode,
      neededQty: Math.max(0, row.requestQty - row.allocations.length),
      confirmed: row.allocations,
      eventTarget: { targetType: EVENT_TARGET_TYPE.SHIPMENT_REQUEST, targetId: row.shipmentRequestId, targetNo: row.shipmentRequest.shipmentRequestNo },
    };
  }

  private async rollingTarget(tx: Tx, row: RollingTargetRow): Promise<Target> {
    if (!OPEN_PLAN.includes(row.productionPlanStatus)) throw invalidState('완료되었거나 취소된 생산계획에는 슬래브를 배정할 수 없습니다');
    const soItem = row.salesOrderItem;
    if (!soItem) throw invalidState('수주 품목에 연결되지 않은 생산계획입니다');
    if (soItem.salesOrder.isCancelled || soItem.salesOrderItemStatus === SALES_ORDER_ITEM_STATUS.CANCELLED) throw invalidState('취소된 수주 품목입니다');
    if (soItem.productSpec.item.itemType !== ITEM_TYPE.COIL) throw badInput('열연 투입 배정은 코일 생산계획에만 할 수 있습니다');
    const mapping = soItem.productSpec.coilMapping;
    if (!mapping) throw new AppException(ERROR_CODE.MST_001, `${soItem.productSpec.specCode}: 대응 슬래브 규격(규격 매핑)이 없습니다`);
    // 새로 끌어와야 할 매수(rollingNeedQty) + 이미 귀속됐지만 배정 전인 슬래브 = 지금 배정해야 할 매수.
    const neededQty = (await this.stock.rollingNeedQty(tx, soItem.id)) + (await this.repo.countEarmarkedWithoutAllocation(tx, soItem.id));
    return {
      purpose: ALLOCATION_PURPOSE.ROLLING,
      shipmentRequestItemId: null,
      shipmentRequestId: null,
      productionPlanId: row.id,
      salesOrderItemId: soItem.id,
      salesOrderId: soItem.salesOrderId,
      salesOrderNo: soItem.salesOrder.salesOrderNo,
      salesOrderLineNo: soItem.lineNo,
      productSpecId: mapping.slabSpecId,
      specCode: mapping.slabSpec.specCode,
      neededQty,
      confirmed: row.allocations,
      eventTarget: { targetType: EVENT_TARGET_TYPE.PRODUCTION_PLAN, targetId: row.id, targetNo: row.productionPlanNo },
    };
  }

  private recommendFor(tx: Tx, target: Target, qty: number) {
    if (qty <= 0) return Promise.resolve([]);
    return this.stock.recommendLots(tx, {
      productSpecId: target.productSpecId,
      qty,
      purpose: target.purpose,
      coilSalesOrderItemId: target.purpose === ALLOCATION_PURPOSE.ROLLING ? target.salesOrderItemId : undefined,
    });
  }

  /** 출하 배정이면 품목·요청 상태를 맞춘다. 모든 품목이 배정되면 물류에 출고 대기를 알린다. */
  private async refreshShipmentStatus(tx: Tx, target: Target, user: AuthUser): Promise<{ shipmentRequestItemStatus: ShipmentRequestItemStatus | null; shipmentRequestStatus: ShipmentRequestStatus | null }> {
    if (target.purpose !== ALLOCATION_PURPOSE.SHIPMENT || !target.shipmentRequestItemId || !target.shipmentRequestId) return { shipmentRequestItemStatus: null, shipmentRequestStatus: null };
    const fresh = await this.repo.findShipmentTarget(tx, target.shipmentRequestItemId);
    if (!fresh) throw notFound('출하요청 품목');
    const itemStatus = fresh.allocations.length >= fresh.requestQty ? SHIPMENT_REQUEST_ITEM_STATUS.ALLOCATED : SHIPMENT_REQUEST_ITEM_STATUS.WAITING_ALLOCATION;
    await this.repo.updateShipmentRequestItemStatus(tx, fresh.id, itemStatus);
    const items = await this.repo.findShipmentRequestItemStatuses(tx, target.shipmentRequestId);
    const allAllocated = items.every((i) => i.shipmentRequestItemStatus === SHIPMENT_REQUEST_ITEM_STATUS.ALLOCATED);
    const requestStatus = allAllocated ? SHIPMENT_REQUEST_STATUS.ALLOCATED : SHIPMENT_REQUEST_STATUS.REQUESTED;
    if (requestStatus !== fresh.shipmentRequest.shipmentRequestStatus) await this.repo.updateShipmentRequestStatus(tx, target.shipmentRequestId, requestStatus);
    if (allAllocated) {
      await this.notifications.toRole(tx, ROLE_CODE.LOGISTICS, {
        notificationType: NOTIFICATION_TYPE.SHIPMENT,
        title: `출고 대기 ${fresh.shipmentRequest.shipmentRequestNo}`,
        body: `${fresh.shipmentRequest.customer.customerName} · LOT ${items.reduce((s, i) => s + i.requestQty, 0)}건 배정 확정`,
        linkPath: `/goods-issues?request=${target.shipmentRequestId}`,
        dedupeKey: `SHIPMENT_ALLOCATED:${target.shipmentRequestId}`,
        excludeEmployeeId: user.employeeId,
      });
    }
    return { shipmentRequestItemStatus: itemStatus, shipmentRequestStatus: requestStatus };
  }

  private toLotView(l: { id: number; lotNo: string; lotType: string; producedAt: Date; salesOrderItemId: number | null; heatLot: { lotNo: string } | null; yard: { yardName: string } | null }, target: Target): AllocationLotView {
    return {
      lotId: l.id,
      lotNo: l.lotNo,
      lotType: l.lotType,
      heatNo: l.heatLot?.lotNo ?? null,
      producedAt: l.producedAt.toISOString(),
      yardName: l.yard?.yardName ?? null,
      isEarmarked: target.purpose === ALLOCATION_PURPOSE.ROLLING && l.salesOrderItemId === target.salesOrderItemId,
    };
  }

  private toConfirmedView(a: ConfirmedAllocationRow): ConfirmedAllocationView {
    return {
      id: a.id, lotId: a.lotId, lotNo: a.lot.lotNo, lotType: a.lot.lotType, heatNo: a.lot.heatLot?.lotNo ?? null,
      producedAt: a.lot.producedAt.toISOString(), status: a.status as AllocationStatus, confirmedAt: a.confirmedAt.toISOString(),
    };
  }
}
