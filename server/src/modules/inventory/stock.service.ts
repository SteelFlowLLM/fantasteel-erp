import { Injectable } from '@nestjs/common';
import { ERROR_CODE, type AllocationPurpose, type AuthUser, type EventReasonCode } from '@fantasteel/shared';
import { lockLots, lockProductInventory } from '../../common/concurrency/locks';
import { AppException, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import type { Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';

/**
 * 재고·예약·배정의 핵심 규칙 (REQ-INV-001~009). 다른 모듈은 inventory·reservation·allocation 테이블을
 * 직접 바꾸지 말고 이 서비스의 함수를 같은 tx 안에서 호출한다.
 *
 * 용어
 * - 적격 LOT: 자기 검사 합격(is_passed) + 상위 히트 성분 합격 + lot_status = IN_STOCK (REQ-INV-003)
 * - 귀속 슬래브: 코일 수주 품목의 열연 투입용으로 잡아 둔 슬래브 (lot.sales_order_item_id = 코일 수주 품목).
 *   재고 풀에 넣지 않아서 다른 슬래브 수주가 예약할 수 없다.
 * - 재고 풀: inventory.on_hand_qty = 적격 LOT 중 귀속 슬래브가 아닌 매수. 여재(미배정 합격 슬래브)를 포함한다.
 * - 예약 가용 매수 = on_hand_qty − reserved_qty
 * 불변조건: reserved_qty = ACTIVE 예약 매수 합계, LOT당 CONFIRMED 배정 1건.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 조회 ─────────────────────────────

  /** 예약 가용 매수 (잠금 없이 조회용). */
  async availableQty(tx: Tx, productSpecId: number): Promise<number> {
    const inv = await tx.inventory.findUnique({ where: { productSpecId } });
    return inv ? Math.max(0, inv.onHandQty - inv.reservedQty) : 0;
  }

  /** 수주 품목의 ACTIVE 예약 매수 합계. */
  async activeReservedQty(tx: Tx, salesOrderItemId: number): Promise<number> {
    const agg = await tx.reservation.aggregate({ where: { salesOrderItemId, status: 'ACTIVE' }, _sum: { reservedQty: true } });
    return agg._sum.reservedQty ?? 0;
  }

  /** 현재 미확보 매수 = max(0, 주문 − 누적 출고 − ACTIVE 예약) (업무 프로세스 정의서 4.5). */
  async unsecuredQty(tx: Tx, salesOrderItemId: number): Promise<number> {
    const item = await tx.salesOrderItem.findUnique({ where: { id: salesOrderItemId } });
    if (!item || item.salesOrderItemStatus === 'CANCELLED') return 0;
    return Math.max(0, item.orderedQty - item.shippedQty - (await this.activeReservedQty(tx, salesOrderItemId)));
  }

  /** LOT이 적격인지 (자기 검사 + 상위 히트 성분 + 미소진). */
  async isEligible(tx: Tx, lotId: number): Promise<boolean> {
    const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { heatLot: true } });
    return !!lot && lot.lotStatus === 'IN_STOCK' && lot.isPassed === true && lot.heatLot?.isPassed === true;
  }

  // ───────────────────────────── 예약 ─────────────────────────────

  /**
   * 수주 품목에 재고 풀의 매수를 예약한다 (부분 예약 허용). 실제 LOT은 정하지 않는다.
   * 예약과 reserved_qty는 같은 트랜잭션에서 갱신한다. 예약한 매수를 돌려준다(0일 수 있음).
   */
  async reserveForItem(
    tx: Tx,
    input: { salesOrderItemId: number; maxQty: number; isAutoReserved?: boolean; actor?: AuthUser | null; reasonCode?: EventReasonCode },
  ): Promise<number> {
    const item = await tx.salesOrderItem.findUnique({ where: { id: input.salesOrderItemId }, include: { salesOrder: true, productSpec: { include: { item: true } } } });
    if (!item) throw notFound('수주 품목');
    if (item.salesOrderItemStatus === 'CANCELLED' || input.maxQty <= 0) return 0;
    const unit = item.productSpec.item.itemType === 'COIL' ? '개' : '매';
    const pool = await lockProductInventory(tx, item.productSpecId);
    const qty = Math.min(input.maxQty, Math.max(0, pool.onHandQty - pool.reservedQty));
    if (qty <= 0) return 0;
    const reservation = await tx.reservation.create({
      data: { salesOrderItemId: item.id, productSpecId: item.productSpecId, reservedQty: qty, status: 'ACTIVE', isAutoReserved: input.isAutoReserved ?? false },
    });
    await tx.inventory.update({ where: { id: pool.id }, data: { reservedQty: { increment: qty } } });
    await this.events.record(tx, {
      actor: input.isAutoReserved ? null : input.actor,
      eventType: input.isAutoReserved ? 'AUTO_RESERVED' : 'RESERVATION_CREATED',
      targetType: 'RESERVATION',
      targetId: reservation.id,
      targetNo: `${item.salesOrder.salesOrderNo} #${item.lineNo}`,
      salesOrderId: item.salesOrderId,
      summary: input.isAutoReserved ? `검사 합격 생산분 ${qty}${unit}를 원래 수주 품목에 자동 예약` : `합격 재고 ${qty}${unit} 예약`,
      before: { onHandQty: pool.onHandQty, reservedQty: pool.reservedQty },
      after: { onHandQty: pool.onHandQty, reservedQty: pool.reservedQty + qty, reservationId: reservation.id },
      reasonCode: input.reasonCode ?? (input.isAutoReserved ? 'QUALITY_PASSED' : 'STOCK_FIRST'),
    });
    this.realtime.changed('inventories', 'sales-orders');
    return qty;
  }

  /** 수주 품목의 ACTIVE 예약을 모두 RELEASED로 해제한다 (수주 취소, REQ-INV-005). 해제한 매수를 돌려준다. */
  async releaseItemReservations(tx: Tx, salesOrderItemId: number, actor: AuthUser | null, reasonCode: EventReasonCode = 'ORDER_CANCELLED'): Promise<number> {
    const item = await tx.salesOrderItem.findUnique({ where: { id: salesOrderItemId }, include: { salesOrder: true, productSpec: { include: { item: true } } } });
    if (!item) throw notFound('수주 품목');
    const unit = item.productSpec.item.itemType === 'COIL' ? '개' : '매';
    const pool = await lockProductInventory(tx, item.productSpecId);
    const actives = await tx.reservation.findMany({ where: { salesOrderItemId, status: 'ACTIVE' } });
    const qty = actives.reduce((s, r) => s + r.reservedQty, 0);
    if (!qty) return 0;
    await tx.reservation.updateMany({ where: { id: { in: actives.map((r) => r.id) } }, data: { status: 'RELEASED' } });
    await tx.inventory.update({ where: { id: pool.id }, data: { reservedQty: { decrement: qty } } });
    await this.events.record(tx, {
      actor,
      eventType: 'RESERVATION_RELEASED',
      targetType: 'SALES_ORDER_ITEM',
      targetId: item.id,
      targetNo: `${item.salesOrder.salesOrderNo} #${item.lineNo}`,
      salesOrderId: item.salesOrderId,
      summary: `예약 ${qty}${unit} 해제`,
      before: { reservedQty: pool.reservedQty },
      after: { reservedQty: pool.reservedQty - qty },
      reasonCode,
    });
    this.realtime.changed('inventories', 'sales-orders');
    return qty;
  }

  /**
   * 출고한 매수만큼 ACTIVE 예약을 CONVERTED로 전환한다. 부분 출고는 예약을 수량별로 나눈다
   * (ACTIVE 10매 중 4매 출고 → ACTIVE 6매 + CONVERTED 4매). 호출 전에 재고 풀을 잠가 둔다.
   */
  async convertItemReservations(tx: Tx, salesOrderItemId: number, qty: number): Promise<void> {
    let rest = qty;
    const actives = await tx.reservation.findMany({ where: { salesOrderItemId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    if (actives.reduce((s, r) => s + r.reservedQty, 0) < qty) throw new AppException(ERROR_CODE.INV_001, '출고할 매수만큼의 예약이 없습니다');
    for (const r of actives) {
      if (rest <= 0) break;
      if (r.reservedQty <= rest) {
        await tx.reservation.update({ where: { id: r.id }, data: { status: 'CONVERTED' } });
        rest -= r.reservedQty;
      } else {
        await tx.reservation.update({ where: { id: r.id }, data: { reservedQty: r.reservedQty - rest } });
        await tx.reservation.create({
          data: { salesOrderItemId, productSpecId: r.productSpecId, reservedQty: rest, status: 'CONVERTED', isAutoReserved: r.isAutoReserved },
        });
        rest = 0;
      }
    }
  }

  // ───────────────────────────── 적격 판정 → 재고 반영·자동 예약 ─────────────────────────────

  /**
   * 검사 판정 직후 호출한다 (품질 모듈). 판정으로 새로 적격이 된 LOT을 재고에 반영하고,
   * 원래 수주 품목의 미확보 매수 안에서 자동 예약한다 (REQ-INV-004).
   * - HEAT 합격: 이미 제품 검사에 합격해 있던 하위 슬래브·코일이 이때 적격이 된다.
   * - SLAB·COIL 합격: 상위 히트가 합격이면 바로 적격이 된다.
   * - 불합격: 아무것도 재고에 넣지 않는다 (불합격 LOT과 불합격 히트 하위 LOT 제외, REQ-INV-007).
   */
  async onLotJudged(tx: Tx, lotId: number): Promise<void> {
    const lot = await tx.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw notFound('LOT');
    if (lot.isPassed !== true) return;
    if (lot.lotType === 'HEAT') {
      const children = await tx.lot.findMany({
        where: { heatLotId: lot.id, isPassed: true, lotStatus: 'IN_STOCK', lotType: { in: ['SLAB', 'COIL'] } },
        orderBy: [{ producedAt: 'asc' }, { lotNo: 'asc' }],
      });
      for (const c of children) await this.admit(tx, c.id);
      return;
    }
    if ((lot.lotType === 'SLAB' || lot.lotType === 'COIL') && (await this.isEligible(tx, lot.id))) await this.admit(tx, lot.id);
  }

  /** 적격이 된 LOT 1개를 재고 풀에 넣거나(자동 예약 포함) 열연 투입용으로 귀속시킨다. */
  private async admit(tx: Tx, lotId: number): Promise<void> {
    const lot = await tx.lot.findUniqueOrThrow({
      where: { id: lotId },
      include: { salesOrderItem: { include: { productSpec: { include: { item: true } } } } },
    });
    if (!lot.productSpecId) return;
    const item = lot.salesOrderItem;
    const itemLive = !!item && item.salesOrderItemStatus !== 'CANCELLED';
    const isSlabForCoilItem = lot.lotType === 'SLAB' && itemLive && item!.productSpec.item.itemType === 'COIL';

    if (isSlabForCoilItem) {
      // 코일 수주의 열연 투입용: 아직 더 필요하면 귀속 상태로 두고(재고 풀에 넣지 않음), 남으면 여재로 돌린다.
      if ((await this.rollingNeedQty(tx, item!.id, lot.id)) > 0) {
        this.realtime.changed('lots', 'production-plans');
        return;
      }
      await tx.lot.update({ where: { id: lot.id }, data: { salesOrderItemId: null } });
    }

    const pool = await lockProductInventory(tx, lot.productSpecId);
    await tx.inventory.update({ where: { id: pool.id }, data: { onHandQty: { increment: 1 } } });
    this.realtime.changed('inventories', 'lots');

    // 생산한 원래 수주 품목의 부족분만 자동 예약. 나머지는 여재(슬래브)·가용 재고로 남는다.
    if (itemLive && !isSlabForCoilItem && item!.productSpecId === lot.productSpecId) {
      const unsecured = await this.unsecuredQty(tx, item!.id);
      const reserved = unsecured > 0 ? await this.reserveForItem(tx, { salesOrderItemId: item!.id, maxQty: 1, isAutoReserved: true }) : 0;
      // 수주에 쓰이지 않은 생산분은 수주 연결을 끊는다 → 여재(슬래브)·가용 재고 (sales_order_item_id IS NULL)
      if (!reserved) await tx.lot.update({ where: { id: lot.id }, data: { salesOrderItemId: null } });
    } else if (lot.salesOrderItemId !== null && !isSlabForCoilItem) {
      // 취소된 수주의 생산분도 연결을 끊어 여재로 둔다
      await tx.lot.update({ where: { id: lot.id }, data: { salesOrderItemId: null } });
    }
  }

  /**
   * 코일 수주 품목에 열연 투입용 슬래브가 몇 매 더 필요한지.
   * = 미확보 코일 매수 − 검사 대기 중인 코일 − 이미 귀속된 적격 슬래브(excludeLotId 제외)
   */
  async rollingNeedQty(tx: Tx, coilSalesOrderItemId: number, excludeLotId?: number): Promise<number> {
    const unsecured = await this.unsecuredQty(tx, coilSalesOrderItemId);
    const pendingCoils = await tx.lot.count({ where: { salesOrderItemId: coilSalesOrderItemId, lotType: 'COIL', lotStatus: 'IN_STOCK', isPassed: null } });
    const earmarked = await tx.lot.count({
      where: {
        salesOrderItemId: coilSalesOrderItemId, lotType: 'SLAB', lotStatus: 'IN_STOCK', isPassed: true, heatLot: { isPassed: true },
        ...(excludeLotId ? { id: { not: excludeLotId } } : {}),
      },
    });
    return Math.max(0, unsecured - pendingCoils - earmarked);
  }

  /** 재고 풀의 슬래브(여재)를 코일 수주 품목의 열연 투입용으로 귀속시킨다. 풀에서 1매 빠진다. */
  async earmarkForRolling(tx: Tx, lotId: number, coilSalesOrderItemId: number): Promise<void> {
    const lot = await tx.lot.findUnique({ where: { id: lotId } });
    if (!lot?.productSpecId || lot.lotType !== 'SLAB') throw notFound('슬래브 LOT');
    if (lot.salesOrderItemId === coilSalesOrderItemId) return;
    if (!(await this.isEligible(tx, lotId))) throw new AppException(ERROR_CODE.INV_002, `${lot.lotNo}: 제품 또는 상위 히트가 미합격입니다`);
    const pool = await lockProductInventory(tx, lot.productSpecId);
    if (pool.onHandQty - pool.reservedQty < 1) throw new AppException(ERROR_CODE.INV_001, '다른 수주에 예약되어 열연에 투입할 수 있는 슬래브가 부족합니다');
    await tx.inventory.update({ where: { id: pool.id }, data: { onHandQty: { decrement: 1 } } });
    await tx.lot.update({ where: { id: lotId }, data: { salesOrderItemId: coilSalesOrderItemId } });
    this.realtime.changed('inventories', 'lots');
  }

  /** 귀속 슬래브를 다시 재고 풀(여재)로 돌린다 (수주 취소·배정 해제). 적격·미소진일 때만 풀에 들어간다. */
  async releaseEarmark(tx: Tx, lotId: number): Promise<void> {
    const lot = await tx.lot.findUnique({ where: { id: lotId } });
    if (!lot?.productSpecId || lot.salesOrderItemId === null) return;
    const wasEligible = await this.isEligible(tx, lotId);
    await tx.lot.update({ where: { id: lotId }, data: { salesOrderItemId: null } });
    if (wasEligible && lot.lotType === 'SLAB') {
      const pool = await lockProductInventory(tx, lot.productSpecId);
      await tx.inventory.update({ where: { id: pool.id }, data: { onHandQty: { increment: 1 } } });
    }
    this.realtime.changed('inventories', 'lots');
  }

  // ───────────────────────────── 배정 (실제 LOT) ─────────────────────────────

  /**
   * FIFO 추천 (REQ-INV-006): 강종·규격이 일치하는 적격 LOT을 생산완료일 오름차순, 동률은 LOT 번호 순으로.
   * 추천은 저장하지 않는다. 확정할 때 작업 로그에 추천 내용을 남긴다.
   * - SHIPMENT: 재고 풀의 LOT (귀속 슬래브 제외)
   * - ROLLING: 그 코일 수주 품목에 귀속된 슬래브를 먼저, 부족하면 재고 풀의 여재
   */
  async recommendLots(
    tx: Tx,
    input: { productSpecId: number; qty: number; purpose: AllocationPurpose; coilSalesOrderItemId?: number; excludeLotIds?: number[] },
  ) {
    const base = {
      productSpecId: input.productSpecId,
      lotStatus: 'IN_STOCK',
      isPassed: true,
      heatLot: { isPassed: true },
      allocations: { none: { status: 'CONFIRMED' } },
      ...(input.excludeLotIds?.length ? { id: { notIn: input.excludeLotIds } } : {}),
    };
    const orderBy = [{ producedAt: 'asc' as const }, { lotNo: 'asc' as const }];
    const include = { heatLot: { select: { id: true, lotNo: true } }, yard: true };
    if (input.purpose === 'SHIPMENT') {
      // 재고 풀 = 귀속 슬래브가 아닌 LOT. 코일은 귀속 개념이 없다.
      const lots = await tx.lot.findMany({ where: base, orderBy, include: { ...include, salesOrderItem: { include: { productSpec: { include: { item: true } } } } } });
      return lots.filter((l) => !this.isEarmarkedSlab(l)).slice(0, input.qty);
    }
    const own = await tx.lot.findMany({ where: { ...base, salesOrderItemId: input.coilSalesOrderItemId ?? -1 }, orderBy, include, take: input.qty });
    if (own.length >= input.qty) return own;
    const pool = await tx.lot.findMany({
      where: { ...base, id: { notIn: [...(input.excludeLotIds ?? []), ...own.map((l) => l.id)] } },
      orderBy,
      include: { ...include, salesOrderItem: { include: { productSpec: { include: { item: true } } } } },
    });
    const free = pool.filter((l) => !this.isEarmarkedSlab(l));
    const avail = await this.availableQty(tx, input.productSpecId);
    return [...own, ...free.slice(0, Math.min(input.qty - own.length, avail))];
  }

  private isEarmarkedSlab(l: { lotType: string; salesOrderItem?: { salesOrderItemStatus: string; productSpec: { item: { itemType: string } } } | null }): boolean {
    return l.lotType === 'SLAB' && !!l.salesOrderItem && l.salesOrderItem.salesOrderItemStatus !== 'CANCELLED' && l.salesOrderItem.productSpec.item.itemType === 'COIL';
  }

  /**
   * 배정 확정: LOT 잠금 → 품질·미소진·다른 CONFIRMED 배정 재검증 → allocation(CONFIRMED) 생성.
   * 같은 슬래브를 판매 출하와 열연에 동시에 배정할 수 없다 (LOT당 CONFIRMED 1건, DB 부분 유니크 인덱스).
   * 작업 로그는 호출한 쪽이 추천 내용과 함께 한 번에 남긴다 (여러 LOT을 한 이벤트로).
   */
  async confirmAllocation(
    tx: Tx,
    input: { lotId: number; purpose: AllocationPurpose; salesOrderItemId: number; productionPlanId?: number | null; shipmentRequestItemId?: number | null; actor: AuthUser | null },
  ) {
    // 잠금 순서는 항상 재고 풀 → LOT (출고·수주 등록과 교착을 피한다)
    const specRow = await tx.lot.findUnique({ where: { id: input.lotId }, select: { productSpecId: true } });
    if (specRow?.productSpecId) await lockProductInventory(tx, specRow.productSpecId);
    await lockLots(tx, [input.lotId]);
    const lot = await tx.lot.findUnique({
      where: { id: input.lotId },
      include: { heatLot: true, salesOrderItem: { include: { productSpec: { include: { item: true } } } }, allocations: { where: { status: 'CONFIRMED' } } },
    });
    if (!lot) throw notFound('LOT');
    if (lot.lotStatus !== 'IN_STOCK') throw new AppException(ERROR_CODE.INV_004, `${lot.lotNo}: 이미 투입·출고된 LOT입니다`);
    if (lot.isPassed !== true || lot.heatLot?.isPassed !== true) throw new AppException(ERROR_CODE.INV_002, `${lot.lotNo}: 제품 또는 상위 히트가 미합격입니다`);
    if (lot.allocations.length) throw new AppException(ERROR_CODE.INV_003, `${lot.lotNo}: 이미 배정된 LOT입니다`);
    if (input.purpose === 'SHIPMENT') {
      if (this.isEarmarkedSlab(lot)) throw new AppException(ERROR_CODE.INV_003, `${lot.lotNo}: 열연 투입용으로 잡혀 있는 슬래브입니다`);
    } else if (lot.salesOrderItemId !== input.salesOrderItemId) {
      if (this.isEarmarkedSlab(lot)) throw new AppException(ERROR_CODE.INV_003, `${lot.lotNo}: 다른 코일 수주에 잡혀 있는 슬래브입니다`);
      await this.earmarkForRolling(tx, lot.id, input.salesOrderItemId);
    }
    const allocation = await tx.allocation.create({
      data: {
        lotId: lot.id, purpose: input.purpose, status: 'CONFIRMED',
        salesOrderItemId: input.salesOrderItemId, productionPlanId: input.productionPlanId ?? null, shipmentRequestItemId: input.shipmentRequestItemId ?? null,
        confirmedEmployeeId: input.actor?.employeeId ?? null,
      },
    });
    this.realtime.changed('allocations', 'lots');
    return { allocation, lot };
  }

  /**
   * 배정 해제 (변경·취소): CONFIRMED → RELEASED. CONSUMED 배정은 바꿀 수 없다.
   * 열연 배정이면서 여재에서 끌어온 슬래브(다른 계획이 만든 LOT)는 다시 재고 풀로 돌린다.
   */
  async releaseAllocation(tx: Tx, allocationId: number, options?: { keepEarmark?: boolean }) {
    const a = await tx.allocation.findUnique({ where: { id: allocationId }, include: { lot: true } });
    if (!a) throw notFound('배정');
    if (a.status === 'RELEASED') return a;
    if (a.status === 'CONSUMED') throw invalidState('이미 투입·출고된 배정은 변경할 수 없습니다');
    if (a.lot.productSpecId) await lockProductInventory(tx, a.lot.productSpecId);
    await lockLots(tx, [a.lotId]);
    const released = await tx.allocation.update({ where: { id: a.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    if (a.purpose === 'ROLLING' && !options?.keepEarmark && a.lot.productionPlanId !== a.productionPlanId) await this.releaseEarmark(tx, a.lotId);
    this.realtime.changed('allocations', 'lots');
    return released;
  }

  /** 출고 확정: 배정 CONSUMED, LOT SHIPPED, 재고 풀 1매 소진. 예약 전환은 convertItemReservations로 따로 한다. */
  async consumeForShipment(tx: Tx, allocationId: number): Promise<void> {
    const a = await tx.allocation.findUniqueOrThrow({ where: { id: allocationId }, include: { lot: { include: { heatLot: true } } } });
    if (a.status !== 'CONFIRMED') throw invalidState('확정 상태의 배정만 출고할 수 있습니다');
    if (a.lot.lotStatus !== 'IN_STOCK') throw new AppException(ERROR_CODE.INV_004, `${a.lot.lotNo}: 이미 투입·출고된 LOT입니다`);
    if (a.lot.isPassed !== true || a.lot.heatLot?.isPassed !== true) throw new AppException(ERROR_CODE.INV_002, `${a.lot.lotNo}: 검사 미합격 LOT은 출고할 수 없습니다`);
    const pool = await lockProductInventory(tx, a.lot.productSpecId!);
    const now = new Date();
    await tx.allocation.update({ where: { id: a.id }, data: { status: 'CONSUMED', consumedAt: now } });
    await tx.lot.update({ where: { id: a.lotId }, data: { lotStatus: 'SHIPPED', consumedAt: now } });
    await tx.inventory.update({ where: { id: pool.id }, data: { onHandQty: { decrement: 1 }, reservedQty: { decrement: 1 } } });
    this.realtime.changed('inventories', 'lots', 'allocations');
  }

  /** 열연 투입: 배정 CONSUMED, 슬래브 LOT CONSUMED. 귀속 슬래브는 재고 풀 밖이라 매수 변화가 없다. */
  async consumeForRolling(tx: Tx, allocationId: number): Promise<void> {
    const a = await tx.allocation.findUniqueOrThrow({ where: { id: allocationId }, include: { lot: { include: { heatLot: true } } } });
    if (a.status !== 'CONFIRMED' || a.purpose !== 'ROLLING') throw invalidState('확정된 열연 배정만 투입할 수 있습니다');
    if (a.lot.lotStatus !== 'IN_STOCK') throw new AppException(ERROR_CODE.INV_004, `${a.lot.lotNo}: 이미 투입·출고된 LOT입니다`);
    if (a.lot.isPassed !== true || a.lot.heatLot?.isPassed !== true) throw new AppException(ERROR_CODE.INV_002, `${a.lot.lotNo}: 미합격 슬래브는 투입할 수 없습니다`);
    const now = new Date();
    await tx.allocation.update({ where: { id: a.id }, data: { status: 'CONSUMED', consumedAt: now } });
    await tx.lot.update({ where: { id: a.lotId }, data: { lotStatus: 'CONSUMED', consumedAt: now } });
    this.realtime.changed('lots', 'allocations');
  }

  // ───────────────────────────── 원료 (톤) ─────────────────────────────

  /** 원료 재고(톤) 증감. 원료 LOT 잔량과 같은 트랜잭션에서 맞춘다. delta는 소수 3자리 문자열(음수 가능). */
  async adjustRawMaterialTon(tx: Tx, rawMaterialId: number, deltaTon: string): Promise<void> {
    // upsert의 create에 음수가 들어가면 CHECK 제약에 먼저 걸리므로, 행을 먼저 만들고 증감한다
    await tx.inventory.upsert({ where: { rawMaterialId }, create: { rawMaterialId }, update: {} });
    await tx.inventory.update({ where: { rawMaterialId }, data: { onHandTon: { increment: deltaTon } } });
    this.realtime.changed('inventories');
  }
}
