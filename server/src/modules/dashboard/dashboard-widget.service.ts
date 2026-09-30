import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE_LABEL,
  calcWeightTon,
  INSPECTION_RESULT,
  ITEM_QTY_UNIT,
  ITEM_TYPE_LABEL,
  PROCESS_CODE_LABEL,
  PROCESS_ORDER,
  PURCHASE_REQUISITION_STATUS,
  PURCHASE_REQUISITION_STATUS_LABEL,
  RAW_MATERIAL_TYPE_LABEL,
  sumTon,
  WIDGETS,
  type BusinessEventType,
  type ItemType,
  type ProcessCode,
  type PurchaseRequisitionStatus,
  type RawMaterialType,
  type WidgetCode,
} from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { daysToDue, isDeliveryRisk } from './delivery-risk';
import { DashboardRepository, type OpenOrderItemRow } from './dashboard.repository';
import type { WidgetQueryDto } from './dto/widget-query.dto';
import { DAY_MS, kstDateString, kstDayStart, kstTodayDate, lastDays } from './kst';

const Dec = Prisma.Decimal;
const ton = (v: Prisma.Decimal | null | undefined): string => (v ?? new Dec(0)).toFixed(3);
/** 비율(0~1)을 소수 4자리 문자열로. 분모가 0이면 null. */
const ratio = (numerator: Prisma.Decimal | number, denominator: Prisma.Decimal | number): string | null => {
  const d = new Dec(denominator);
  return d.lte(0) ? null : new Dec(numerator).div(d).toFixed(4);
};
const pieceTon = (qty: number, weight: Prisma.Decimal): string => calcWeightTon(qty, weight.toString());

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_EVENT_LIMIT = 10;
/** 생산 설정이 없을 때만 쓰는 초기값 (REQ-MST-009). 정상 DB에는 설정 행이 있다. */
const FALLBACK_DELIVERY_RISK_DAYS = 3;

/** 위젯별 데이터 (REQ-DSH-001·002). 모두 DB 집계이며, 로그인한 사원은 모든 위젯을 볼 수 있다 (역할별 범위는 TBD). */
@Injectable()
export class DashboardWidgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DashboardRepository,
  ) {}

  async get(widgetCode: string, q: WidgetQueryDto, now: Date = new Date()) {
    const def = WIDGETS.find((w) => w.code === widgetCode);
    if (!def) throw notFound('위젯');
    // P2 기능이 필요한 위젯은 데이터를 만들지 않는다.
    if (def.isP2) return { widgetCode: def.code, available: false as const, grade: 'P2' as const };
    const head = { widgetCode: def.code, available: true as const, generatedAt: now };
    const body = await this.body(def.code, q, now);
    return { ...head, ...body };
  }

  private body(code: WidgetCode, q: WidgetQueryDto, now: Date) {
    switch (code) {
      case 'PROCESS_FLOW': return this.processFlow(now);
      case 'ORDER_FULFILLMENT': return this.orderFulfillment(now, q.limit ?? DEFAULT_LIST_LIMIT);
      case 'RECENT_EVENTS': return this.recentEvents(q.limit ?? DEFAULT_EVENT_LIMIT);
      case 'PRODUCT_STOCK': return this.productStock();
      case 'PROCESS_YIELD': return this.processYield();
      case 'RAW_MATERIAL_BALANCE': return this.rawMaterialBalance();
      case 'REJECT_RATE': return this.rejectRate(q.days ?? 30, now);
      case 'DELIVERY_RISK': return this.deliveryRisk(now, q.limit ?? DEFAULT_LIST_LIMIT);
      case 'PURCHASE_PROGRESS': return this.purchaseProgress(q.limit ?? DEFAULT_LIST_LIMIT);
      case 'SHIPMENT_RESULT': return this.shipmentResult(q.days ?? 14, now);
      case 'SURPLUS_AGE': return this.surplusAge(q.limit ?? DEFAULT_LIST_LIMIT * 2, now);
      case 'PRODUCTION_VOLUME': return this.productionVolume(q.days ?? 14, now);
      default: throw notFound('위젯');
    }
  }

  // ───────────── 공정 흐름 현황 ─────────────

  async processFlow(now: Date) {
    const db = this.prisma;
    const dayStart = kstDayStart(now);
    const [openPlans, heat, slab, coil, qSlab, qCoil, openShipments, issued] = await Promise.all([
      this.repo.countOpenPlans(db),
      this.repo.countAwaitingInspection(db, 'HEAT'),
      this.repo.countAwaitingInspection(db, 'SLAB'),
      this.repo.countAwaitingInspection(db, 'COIL'),
      this.repo.countQualified(db, 'SLAB'),
      this.repo.countQualified(db, 'COIL'),
      this.repo.countOpenShipmentRequests(db),
      this.repo.issuedBetween(db, dayStart, new Date(dayStart.getTime() + DAY_MS)),
    ]);
    const stage = (key: string, label: string, count: number, unit: string, linkPath: string | null = null) => ({ key, label, count, unit, linkPath });
    return {
      stages: [
        stage('OPEN_PLANS', '진행 중 생산계획', openPlans, '건', '/production/plans'),
        stage('HEAT_AWAITING_INSPECTION', '히트 검사 대기', heat, '개', '/quality/inspections'),
        stage('SLAB_AWAITING_INSPECTION', '슬래브 검사 대기', slab, '매', '/quality/inspections'),
        stage('COIL_AWAITING_INSPECTION', '코일 검사 대기', coil, '개', '/quality/inspections'),
        stage('QUALIFIED_SLAB', '합격 슬래브 재고', qSlab, '매'),
        stage('QUALIFIED_COIL', '합격 코일 재고', qCoil, '개'),
        stage('OPEN_SHIPMENT_REQUESTS', '진행 중 출하요청', openShipments, '건'),
        stage('ISSUED_TODAY', '오늘 출고', issued.lotCount, '개', '/goods-issues'),
      ],
      issuedToday: { date: kstDateString(now), goodsIssueCount: issued.goodsIssueCount, lotCount: issued.lotCount },
    };
  }

  // ───────────── 수주 충족 현황 ─────────────

  async orderFulfillment(now: Date, limit: number) {
    const db = this.prisma;
    const today = kstTodayDate(now);
    const riskDays = await this.riskDays();
    const items = (await this.repo.openOrderItems(db)).filter((i) => i.shippedQty < i.orderedQty);
    const itemIds = items.map((i) => i.id);
    const [reserved, plans] = await Promise.all([this.repo.activeReservedByItem(db, itemIds), this.repo.openPlansOfItems(db, itemIds)]);
    const produced = await this.repo.producedByPlan(db, plans.map((p) => p.id));
    const inProduction = new Map<number, number>();
    for (const p of plans) {
      const remain = Math.max(0, p.shortageQty - (produced.get(`${p.id}:${p.productSpecId}`) ?? 0));
      inProduction.set(p.salesOrderItemId!, (inProduction.get(p.salesOrderItemId!) ?? 0) + remain);
    }

    const bySalesOrder = new Map<number, OpenOrderItemRow[]>();
    for (const i of items) bySalesOrder.set(i.salesOrderId, [...(bySalesOrder.get(i.salesOrderId) ?? []), i]);
    const salesOrders = [...bySalesOrder.values()].map((list) => {
      const so = list[0].salesOrder;
      const days = daysToDue(so.dueDate, today);
      const rows = list.map((i) => {
        return {
          salesOrderItemId: i.id,
          lineNo: i.lineNo,
          specCode: i.productSpec.specCode,
          orderedQty: i.orderedQty,
          orderedTon: pieceTon(i.orderedQty, i.productSpec.theoreticalWeightTon),
          reservedQty: reserved.get(i.id) ?? 0,
          inProductionQty: inProduction.get(i.id) ?? 0,
          shippedQty: i.shippedQty,
          remainingQty: i.orderedQty - i.shippedQty,
          progressRate: ratio(i.shippedQty, i.orderedQty),
          isDeliveryRisk: isDeliveryRisk({ dueDate: so.dueDate, orderedQty: i.orderedQty, shippedQty: i.shippedQty }, today, riskDays),
        };
      });
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
      const orderedQty = sum((r) => r.orderedQty);
      const shippedQty = sum((r) => r.shippedQty);
      return {
        salesOrderId: so.id,
        salesOrderNo: so.salesOrderNo,
        customerName: so.customer.customerName,
        dueDate: so.dueDate,
        daysToDue: days,
        isDeliveryRisk: rows.some((r) => r.isDeliveryRisk),
        orderedQty,
        orderedTon: sumTon(rows.map((r) => r.orderedTon)),
        reservedQty: sum((r) => r.reservedQty),
        inProductionQty: sum((r) => r.inProductionQty),
        shippedQty,
        progressRate: ratio(shippedQty, orderedQty),
        linkPath: `/sales-orders/${so.id}`,
        items: rows,
      };
    });
    return {
      deliveryRiskDays: riskDays,
      definitions: {
        progressRate: '출하 매수 ÷ 주문 매수 (분모 = 주문 매수)',
        reservedQty: 'ACTIVE 예약 매수 (미출고)',
        inProductionQty: '진행 중 생산계획의 잔여 목표 매수 = 계획 목표 매수 − 불합격이 아닌 생산 LOT 수',
        note: '예약·생산 중·출하는 같은 제품의 서로 다른 단계이므로 더해서 충족 매수로 쓰지 않는다. 수주 합계는 슬래브 매 + 코일 개를 그대로 더한 값이다.',
      },
      totalOpenSalesOrders: salesOrders.length,
      salesOrders: salesOrders.slice(0, limit),
    };
  }

  // ───────────── 최근 작업 로그 ─────────────

  async recentEvents(limit: number) {
    const rows = await this.repo.recentEvents(this.prisma, limit);
    return {
      items: rows.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt,
        eventType: e.eventType,
        eventTypeLabel: BUSINESS_EVENT_TYPE_LABEL[e.eventType as BusinessEventType] ?? e.eventType,
        actorType: e.actorType,
        actorLabel: e.actorEmployee?.employeeName ?? '시스템',
        summary: e.summary,
        targetType: e.targetType,
        targetNo: e.targetNo,
        salesOrderId: e.salesOrderId,
        isAiAssisted: e.isAiAssisted,
        linkPath: e.salesOrderId ? `/business-events?salesOrderId=${e.salesOrderId}` : null,
      })),
    };
  }

  // ───────────── 제품 재고 ─────────────

  async productStock() {
    const rows = (await this.repo.productInventories(this.prisma))
      .filter((r) => r.productSpec)
      .sort((a, b) => a.productSpec!.item.itemType.localeCompare(b.productSpec!.item.itemType) * -1 || a.productSpec!.specCode.localeCompare(b.productSpec!.specCode));
    const items = rows.map((r) => {
      const spec = r.productSpec!;
      const type = spec.item.itemType as ItemType;
      const available = Math.max(0, r.onHandQty - r.reservedQty);
      return {
        productSpecId: spec.id,
        specCode: spec.specCode,
        itemType: type,
        itemTypeLabel: ITEM_TYPE_LABEL[type] ?? type,
        unit: ITEM_QTY_UNIT[type as 'SLAB' | 'COIL'] ?? '',
        steelGradeCode: spec.steelGrade.steelGradeCode,
        theoreticalWeightTon: spec.theoreticalWeightTon.toFixed(3),
        onHandQty: r.onHandQty,
        reservedQty: r.reservedQty,
        availableQty: available,
        onHandTon: pieceTon(r.onHandQty, spec.theoreticalWeightTon),
        reservedTon: pieceTon(r.reservedQty, spec.theoreticalWeightTon),
        availableTon: pieceTon(available, spec.theoreticalWeightTon),
      };
    });
    const totals = (['SLAB', 'COIL'] as const).map((type) => {
      const list = items.filter((i) => i.itemType === type);
      return {
        itemType: type,
        itemTypeLabel: ITEM_TYPE_LABEL[type],
        onHandQty: list.reduce((s, i) => s + i.onHandQty, 0),
        reservedQty: list.reduce((s, i) => s + i.reservedQty, 0),
        availableQty: list.reduce((s, i) => s + i.availableQty, 0),
        onHandTon: sumTon(list.map((i) => i.onHandTon)),
        reservedTon: sumTon(list.map((i) => i.reservedTon)),
        availableTon: sumTon(list.map((i) => i.availableTon)),
      };
    });
    return { note: '재고 풀 기준: 합격·미소진 재고 중 열연 투입용으로 귀속된 슬래브는 제외. 가용 = 재고 − 예약', items, totals };
  }

  // ───────────── 공정별 수율 ─────────────

  async processYield() {
    const [groups, routings] = await Promise.all([this.repo.completedResultsByProcess(this.prisma), this.repo.routings(this.prisma)]);
    const planned = new Map<string, Prisma.Decimal | null>();
    // 슬래브 경로 기준. 열연 등 라우팅에 수율이 없는 공정은 null (열연은 규격 매핑에서 계산하므로 여기서는 주지 않는다).
    for (const r of [...routings].sort((a, b) => (a.itemType === 'SLAB' ? -1 : 1) - (b.itemType === 'SLAB' ? -1 : 1))) {
      if (!planned.has(r.processCode) || planned.get(r.processCode) === null) planned.set(r.processCode, r.plannedYieldRate);
    }
    const processes = PROCESS_ORDER.map((code: ProcessCode) => {
      const g = groups.find((x) => x.processCode === code);
      const inputTon = g?._sum.inputTon ?? new Dec(0);
      const outputTon = g?._sum.outputTon ?? new Dec(0);
      const plannedQty = g?._sum.plannedQty ?? 0;
      const outputQty = g?._sum.outputQty ?? 0;
      const rate = planned.get(code);
      return {
        processCode: code,
        processLabel: PROCESS_CODE_LABEL[code],
        resultCount: g?._count._all ?? 0,
        inputTon: ton(inputTon),
        outputTon: ton(outputTon),
        plannedQty,
        outputQty,
        lossQty: g?._sum.lossQty ?? 0,
        plannedYieldRate: rate ? rate.toFixed(4) : null,
        actualYieldRate: ratio(outputTon, inputTon),
        qtyAttainmentRate: ratio(outputQty, plannedQty),
      };
    });
    return {
      definitions: {
        plannedYieldRate: '라우팅의 계획 수율 (없으면 null)',
        actualYieldRate: '완료 실적의 산출 톤 합 ÷ 투입 톤 합 (투입이 0이면 null)',
        qtyAttainmentRate: '완료 실적의 산출 매수 합 ÷ 계획 매수 합 (계획이 0이면 null)',
      },
      processes,
    };
  }

  // ───────────── 원료 잔량 대비 소요 ─────────────

  async rawMaterialBalance() {
    const db = this.prisma;
    const [materials, poItems, mrp] = await Promise.all([this.repo.rawMaterialsWithInventory(db), this.repo.openPurchaseOrderItems(db), this.repo.latestMrpRun(db)]);
    const scheduled = new Map<number, Prisma.Decimal>();
    for (const p of poItems) {
      const open = p.orderedTon.sub(p.receivedTon);
      if (open.gt(0)) scheduled.set(p.rawMaterialId, (scheduled.get(p.rawMaterialId) ?? new Dec(0)).add(open));
    }
    return {
      mrpRun: mrp ? { mrpRunId: mrp.id, mrpRunNo: mrp.mrpRunNo, createdAt: mrp.createdAt } : null,
      items: materials.map((m) => {
        const req = mrp?.requirements.find((r) => r.rawMaterialId === m.id);
        return {
          rawMaterialId: m.id,
          materialCode: m.materialCode,
          materialName: m.item.itemName,
          rawMaterialType: m.rawMaterialType,
          rawMaterialTypeLabel: RAW_MATERIAL_TYPE_LABEL[m.rawMaterialType as RawMaterialType] ?? m.rawMaterialType,
          onHandTon: ton(m.inventories[0]?.onHandTon),
          scheduledReceiptTon: ton(scheduled.get(m.id)),
          grossRequiredTon: req ? req.requiredTon.toFixed(3) : null,
          netRequiredTon: req ? req.netRequiredTon.toFixed(3) : null,
        };
      }),
    };
  }

  // ───────────── 강종별 불합격률 ─────────────

  async rejectRate(days: number, now: Date) {
    const since = new Date(now.getTime() - days * DAY_MS);
    const [grades, inspections] = await Promise.all([this.repo.steelGrades(this.prisma), this.repo.judgedInspectionsSince(this.prisma, since)]);
    const stat = (list: { inspectionResult: string }[]) => {
      const failed = list.filter((i) => i.inspectionResult === INSPECTION_RESULT.FAIL).length;
      return { inspectedCount: list.length, failedCount: failed, rejectRate: ratio(failed, list.length) };
    };
    return {
      days,
      from: since,
      to: now,
      definitions: { rejectRate: '불합격 검사 수 ÷ 판정된(합격+불합격) 검사 수, 기간 안에 검사한 건 기준. 검사 기록 1건 = 1', note: '같은 LOT을 다시 검사하면 각각 센다' },
      grades: grades.map((g) => {
        const own = inspections.filter((i) => i.lot.steelGradeId === g.id);
        return {
          steelGradeId: g.id,
          steelGradeCode: g.steelGradeCode,
          ...stat(own),
          byProcess: (['STEELMAKING', 'CASTING', 'HOT_ROLLING'] as const).map((p) => ({ processCode: p, processLabel: PROCESS_CODE_LABEL[p], ...stat(own.filter((i) => i.processCode === p)) })),
        };
      }),
    };
  }

  // ───────────── 납기 위험 수주 ─────────────

  async deliveryRisk(now: Date, limit: number) {
    const today = kstTodayDate(now);
    const riskDays = await this.riskDays();
    const rows = await this.repo.openOrderItems(this.prisma, { dueOnOrBefore: new Date(today.getTime() + riskDays * DAY_MS) });
    const risky = rows
      .filter((i) => isDeliveryRisk({ dueDate: i.salesOrder.dueDate, orderedQty: i.orderedQty, shippedQty: i.shippedQty }, today, riskDays))
      .map((i) => {
        const days = daysToDue(i.salesOrder.dueDate, today);
        return {
          salesOrderId: i.salesOrderId,
          salesOrderNo: i.salesOrder.salesOrderNo,
          salesOrderItemId: i.id,
          lineNo: i.lineNo,
          customerName: i.salesOrder.customer.customerName,
          specCode: i.productSpec.specCode,
          orderedQty: i.orderedQty,
          shippedQty: i.shippedQty,
          remainingQty: i.orderedQty - i.shippedQty,
          remainingTon: pieceTon(i.orderedQty - i.shippedQty, i.productSpec.theoreticalWeightTon),
          dueDate: i.salesOrder.dueDate,
          daysToDue: days,
          isOverdue: days < 0,
          linkPath: `/sales-orders/${i.salesOrderId}`,
        };
      })
      .sort((a, b) => a.daysToDue - b.daysToDue || a.salesOrderId - b.salesOrderId || a.lineNo - b.lineNo);
    return {
      deliveryRiskDays: riskDays,
      rule: '납기까지 남은 일수 ≤ 기준일 이고 출하 매수 < 주문 매수 (규칙 판정, AI 아님). 납기가 지난 미출하 품목 포함',
      total: risky.length,
      items: risky.slice(0, limit),
    };
  }

  // ───────────── 구매 진행 ─────────────

  async purchaseProgress(limit: number) {
    const db = this.prisma;
    const [counts, poItems] = await Promise.all([this.repo.requisitionCountsByStatus(db), this.repo.openPurchaseOrderItems(db)]);
    const purchaseOrderMap = new Map<number, { purchaseOrderId: number; purchaseOrderNo: string; supplierName: string; dueDate: Date | null; outstandingTon: Prisma.Decimal; lineCount: number }>();
    for (const p of poItems) {
      const open = p.orderedTon.sub(p.receivedTon);
      if (open.lte(0)) continue;
      const po = p.purchaseOrder;
      const cur = purchaseOrderMap.get(po.id) ?? { purchaseOrderId: po.id, purchaseOrderNo: po.purchaseOrderNo, supplierName: po.supplier.supplierName, dueDate: po.dueDate, outstandingTon: new Dec(0), lineCount: 0 };
      cur.outstandingTon = cur.outstandingTon.add(open);
      cur.lineCount += 1;
      purchaseOrderMap.set(po.id, cur);
    }
    const list = [...purchaseOrderMap.values()].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.purchaseOrderId - b.purchaseOrderId);
    return {
      requisitionsByStatus: (Object.values(PURCHASE_REQUISITION_STATUS) as PurchaseRequisitionStatus[]).map((status) => ({
        status,
        label: PURCHASE_REQUISITION_STATUS_LABEL[status],
        count: counts.find((c) => c.purchaseRequisitionStatus === status)?._count._all ?? 0,
      })),
      openPurchaseOrders: {
        count: list.length,
        outstandingTon: ton(list.reduce((s, o) => s.add(o.outstandingTon), new Dec(0))),
        purchaseOrders: list.slice(0, limit).map((o) => ({ ...o, outstandingTon: ton(o.outstandingTon) })),
      },
    };
  }

  // ───────────── 출하 실적 ─────────────

  async shipmentResult(days: number, now: Date) {
    const dates = lastDays(days, now);
    const since = new Date(kstDayStart(now).getTime() - (days - 1) * DAY_MS);
    const items = await this.repo.issuedItemsSince(this.prisma, since);
    const perDay = new Map(dates.map((d) => [d, { issuedQty: 0, slabQty: 0, coilQty: 0, tons: [] as string[] }]));
    for (const i of items) {
      const at = i.goodsIssue.confirmedAt;
      const bucket = at ? perDay.get(kstDateString(at)) : undefined;
      if (!bucket) continue;
      bucket.issuedQty += 1;
      if (i.lot.lotType === 'SLAB') bucket.slabQty += 1;
      if (i.lot.lotType === 'COIL') bucket.coilQty += 1;
      if (i.lot.productSpec) bucket.tons.push(pieceTon(1, i.lot.productSpec.theoreticalWeightTon));
    }
    const series = dates.map((date) => {
      const b = perDay.get(date)!;
      return { date, issuedQty: b.issuedQty, slabQty: b.slabQty, coilQty: b.coilQty, issuedTon: sumTon(b.tons) };
    });
    return {
      days,
      series,
      totalQty: series.reduce((s, d) => s + d.issuedQty, 0),
      totalTon: sumTon(series.map((d) => d.issuedTon)),
    };
  }

  // ───────────── 여재 보유 기간 ─────────────

  async surplusAge(limit: number, now: Date) {
    const rows = await this.repo.surplusSlabs(this.prisma);
    const all = rows.map((l) => ({
      lotId: l.id,
      lotNo: l.lotNo,
      specCode: l.productSpec?.specCode ?? null,
      steelGradeCode: l.steelGrade?.steelGradeCode ?? null,
      weightTon: l.productSpec ? pieceTon(1, l.productSpec.theoreticalWeightTon) : null,
      producedAt: l.producedAt,
      ageDays: Math.max(0, Math.floor((now.getTime() - l.producedAt.getTime()) / DAY_MS)),
      linkPath: `/lots/trace?lot=${encodeURIComponent(l.lotNo)}`,
    }));
    const ages = all.map((a) => a.ageDays);
    return {
      definition: '여재 슬래브 = 적격(검사·상위 히트 합격, 재고) · 수주 미귀속 · CONFIRMED 배정 없음. 보유 일수 = 생산완료일부터 오늘까지',
      summary: {
        count: all.length,
        totalTon: sumTon(all.map((a) => a.weightTon ?? '0.000')),
        maxAgeDays: ages.length ? Math.max(...ages) : null,
        avgAgeDays: ages.length ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10 : null,
      },
      items: all.sort((a, b) => b.ageDays - a.ageDays || a.lotId - b.lotId).slice(0, limit),
    };
  }

  // ───────────── 생산량 ─────────────

  async productionVolume(days: number, now: Date) {
    const dates = lastDays(days, now);
    const since = new Date(kstDayStart(now).getTime() - (days - 1) * DAY_MS);
    const lots = await this.repo.producedLotsSince(this.prisma, since);
    const perDay = new Map(dates.map((d) => [d, { slabQty: 0, coilQty: 0 }]));
    for (const l of lots) {
      const bucket = perDay.get(kstDateString(l.producedAt));
      if (!bucket) continue;
      if (l.lotType === 'SLAB') bucket.slabQty += 1;
      else bucket.coilQty += 1;
    }
    const series = dates.map((date) => ({ date, ...perDay.get(date)! }));
    return {
      days,
      definition: '생산완료일(produced_at) 기준으로 만든 슬래브·코일 LOT 수 (검사 결과와 무관)',
      series,
      totalSlabQty: series.reduce((s, d) => s + d.slabQty, 0),
      totalCoilQty: series.reduce((s, d) => s + d.coilQty, 0),
    };
  }

  private async riskDays(): Promise<number> {
    return (await this.repo.deliveryRiskDays(this.prisma))?.deliveryRiskDays ?? FALLBACK_DELIVERY_RISK_DAYS;
  }
}
