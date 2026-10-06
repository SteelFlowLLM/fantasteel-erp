import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE,
  ALLOCATION_STATUS,
  LOT_STATUS,
  LOT_TYPE,
  TRACE_DIRECTION,
  defaultTraceDirection,
  type AllocationPurpose,
  type AllocationStatus,
  type InspectionResult,
  type LotAllocationInfo,
  type LotDetail,
  type LotInspectionDetail,
  type LotRelationEvidence,
  type LotRelationView,
  type LotShipmentInfo,
  type LotStatus,
  type LotSummary,
  type LotTrace,
  type LotType,
  type PageResult,
  type ShipmentRequestStatus,
  type TraceDirection,
  type TraceImpact,
  type TraceLotNode,
  type TraceRelationEdge,
  type TraceShipment,
  type DispositionStatus,
  type ProcessType,
  type RawMaterialType,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { ListLotsQuery } from './dto/lot.query';
import { LotRepository, type LotRow } from './lot.repository';

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const ton = (d: { toFixed(digits: number): string } | null) => (d ? d.toFixed(3) : null);

/** 기준(이상·이하, 경계 포함) 안인지. 기준이 없으면 null */
function isWithin(measured: number, min: number | null, max: number | null): boolean | null {
  if (min === null && max === null) return null;
  return (min === null || measured >= min) && (max === null || measured <= max);
}

function toSummary(row: LotRow): LotSummary {
  return {
    id: row.id,
    lotNo: row.lotNo,
    lotType: row.lotType as LotType,
    lotStatus: row.lotStatus as LotStatus,
    itemId: row.itemId,
    itemCode: row.item?.itemCode ?? null,
    itemName: row.item?.itemName ?? null,
    steelGradeCode: row.steelGrade?.steelGradeCode ?? null,
    yardName: row.yard?.yardName ?? null,
    producedDate: dateOnly(row.producedDate),
    initialTon: ton(row.initialTon),
    remainingTon: ton(row.remainingTon),
    inspectionResult: row.inspectionResult as InspectionResult | null,
  };
}

/** 한 LOT의 출하 연결 한 건: 배정 + 출하요청 + 수주 + 밀시트 */
interface ShipmentLink {
  lotId: number;
  allocationStatus: AllocationStatus;
  shipmentRequestId: number;
  shipmentRequestNo: string;
  shipmentRequestStatus: ShipmentRequestStatus;
  issuedAt: Date | null;
  customerName: string;
  salesOrder: { salesOrderId: number; salesOrderNo: string } | null;
  dueDate: Date | null;
  millSheets: { id: number; millSheetNo: string; salesOrderId: number }[];
}

/**
 * LOT 조회·정·역추적 (REQ-LOT-001·005, BP-LOT-01, docs/backend/lot.md). 읽기 전용이라 작업 로그를 남기지 않는다.
 * LOT 관계는 lot_relation의 부모·자식 id로만 따라가고 LOT 번호는 해석하지 않는다.
 */
@Injectable()
export class LotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: LotRepository,
  ) {}

  /** LOT 목록 (API-235): 번호 앞부분·유형·상태·규격으로 거른다. 생산완료일 최근 순 */
  async list(query: ListLotsQuery): Promise<PageResult<LotSummary>> {
    const where: Prisma.LotWhereInput = {
      ...(query.lotType ? { lotType: query.lotType } : {}),
      ...(query.lotStatus ? { lotStatus: query.lotStatus } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.lotNo ? { lotNo: { startsWith: query.lotNo.trim(), mode: 'insensitive' } } : {}),
    };
    const [ids, total] = await Promise.all([
      this.repository.findLotIds(this.prisma, where, (query.page - 1) * query.size, query.size),
      this.repository.countLots(this.prisma, where),
    ]);
    const rows = await this.repository.findLotRows(this.prisma, ids.map((l) => l.id));
    return { items: rows.map(toSummary), page: query.page, size: query.size, total };
  }

  /** LOT 상세 (API-236): 기본값 + 검사 판정·기준 버전 + 적격 여부 + 불합격 처리 + 배정 + 바로 위·아래 LOT + 출하 */
  async detail(id: number): Promise<LotDetail> {
    const tx = this.prisma;
    const [row] = await this.repository.findLotRows(tx, [id]);
    if (!row) throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
    const lotType = row.lotType as LotType;
    const isProduct = lotType === LOT_TYPE.SLAB || lotType === LOT_TYPE.COIL;

    const [inspection, goodsReceipt, relations, allocations, links, isEligible, heat] = await Promise.all([
      this.repository.findInspection(tx, id),
      row.goodsReceiptId === null ? null : this.repository.findGoodsReceiptNo(tx, row.goodsReceiptId),
      this.repository.findDirectRelations(tx, id),
      this.repository.findLiveAllocations(tx, [id]),
      this.shipmentLinks(tx, [id]),
      isProduct ? this.repository.findEligibility(tx, id) : null,
      isProduct ? this.heatOf(tx, id) : null,
    ]);

    const otherIds = [...new Set(relations.map((r) => (r.parentLotId === id ? r.childLotId : r.parentLotId)))];
    const labels = new Map((await this.repository.findLotLabels(tx, otherIds)).map((l) => [l.id, l]));
    const relationView = (r: (typeof relations)[number], otherId: number): LotRelationView => ({
      relationId: r.id,
      lotId: otherId,
      lotNo: labels.get(otherId)?.lotNo ?? '',
      lotType: (labels.get(otherId)?.lotType ?? row.lotType) as LotType,
      lotRelationEvidence: r.lotRelationEvidence as LotRelationEvidence,
      inputTon: ton(r.inputTon),
      periodStartedAt: r.inputStartedAt?.toISOString() ?? null,
      periodEndedAt: r.inputEndedAt?.toISOString() ?? null,
    });

    return {
      ...toSummary(row),
      steelGradeName: row.steelGrade?.steelGradeName ?? null,
      rawMaterialType: (row.item?.rawMaterialType ?? null) as RawMaterialType | null,
      goodsReceiptNo: goodsReceipt?.goodsReceiptNo ?? null,
      blastFurnaceCode: row.blastFurnaceCode,
      converterCode: row.converterCode,
      heat,
      isEligible,
      disposition: row.dispositionStatus ? { dispositionStatus: row.dispositionStatus as DispositionStatus, dispositionReason: row.dispositionReason } : null,
      inspection: inspection ? this.toInspectionDetail(inspection) : null,
      allocations: await this.toAllocationInfos(tx, allocations),
      parents: relations.filter((r) => r.childLotId === id).map((r) => relationView(r, r.parentLotId)),
      children: relations.filter((r) => r.parentLotId === id).map((r) => relationView(r, r.childLotId)),
      shipments: links.map((l) => this.toShipmentInfo(l)),
    };
  }

  /**
   * LOT 정·역추적 (API-237). backward = 시작 LOT과 조상(코일 → 슬래브 → 히트 → 용선 → 원료, 슬래브 출하는 코일 단계 없음),
   * forward = 시작 LOT과 자손 + 출하·수주·영향 범위. N:M 연결은 그대로 보존하고 같은 LOT은 한 번만 나온다.
   */
  async trace(id: number, direction?: TraceDirection): Promise<LotTrace> {
    const tx = this.prisma;
    const [startRow] = await this.repository.findLotRows(tx, [id]);
    if (!startRow) throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
    const resolved = direction ?? defaultTraceDirection(startRow.lotType as LotType);

    const walked = await this.repository.walkRelations(tx, id, resolved);
    const lotIds = walked.map((w) => w.lotId);
    const depthById = new Map(walked.map((w) => [w.lotId, w.depth]));
    const [rows, relations] = await Promise.all([this.repository.findLotRows(tx, lotIds), this.repository.findRelationsAmong(tx, lotIds)]);

    const nodes: TraceLotNode[] = rows
      .map((row) => ({
        ...toSummary(row),
        depth: depthById.get(row.id) ?? 0,
        isStart: row.id === id,
        rawMaterialType: (row.item?.rawMaterialType ?? null) as RawMaterialType | null,
        blastFurnaceCode: row.blastFurnaceCode,
        converterCode: row.converterCode,
      }))
      .sort((a, b) => a.depth - b.depth || a.id - b.id);
    const edges: TraceRelationEdge[] = relations.map((r) => ({
      id: r.id,
      parentLotId: r.parentLotId,
      childLotId: r.childLotId,
      lotRelationEvidence: r.lotRelationEvidence as LotRelationEvidence,
      inputTon: ton(r.inputTon),
      periodStartedAt: r.inputStartedAt?.toISOString() ?? null,
      periodEndedAt: r.inputEndedAt?.toISOString() ?? null,
    }));

    if (resolved === TRACE_DIRECTION.BACKWARD) return { start: toSummary(startRow), direction: resolved, nodes, edges, shipments: [], impact: null };

    const productIds = nodes.filter((n) => n.lotType === LOT_TYPE.SLAB || n.lotType === LOT_TYPE.COIL).map((n) => n.id);
    const links = await this.shipmentLinks(tx, productIds);
    return { start: toSummary(startRow), direction: resolved, nodes, edges, shipments: this.groupShipments(links), impact: this.impactOf(nodes, links) };
  }

  // ── 내부 ──────────────────────────────────────────────

  /** 슬래브·코일의 상위 히트: 조상 가운데 가장 가까운 히트 */
  private async heatOf(tx: Tx, lotId: number): Promise<{ id: number; lotNo: string } | null> {
    const ancestors = (await this.repository.walkRelations(tx, lotId, TRACE_DIRECTION.BACKWARD)).filter((w) => w.lotId !== lotId);
    const labels = await this.repository.findLotLabels(tx, ancestors.map((a) => a.lotId));
    const depthById = new Map(ancestors.map((a) => [a.lotId, a.depth]));
    const heats = labels.filter((l) => l.lotType === LOT_TYPE.HEAT).sort((a, b) => (depthById.get(a.id) ?? 0) - (depthById.get(b.id) ?? 0) || a.id - b.id);
    return heats[0] ? { id: heats[0].id, lotNo: heats[0].lotNo } : null;
  }

  private toInspectionDetail(q: NonNullable<Awaited<ReturnType<LotRepository['findInspection']>>>): LotInspectionDetail {
    return {
      inspectionResult: q.inspectionResult as InspectionResult,
      inspectedAt: q.inspectedAt.toISOString(),
      inspectorName: q.inspectorEmployee.employeeName,
      processType: q.inspectionStandard.processType as ProcessType,
      inspectionStandardCode: q.inspectionStandard.inspectionStandardCode,
      standardVersion: q.inspectionStandard.versionNo,
      values: q.qualityInspectionValues.map((v) => ({
        inspectionItemCode: v.inspectionStandardItem.inspectionItemCode,
        inspectionItemName: v.inspectionStandardItem.inspectionItemName,
        unit: v.inspectionStandardItem.unit,
        minValue: v.inspectionStandardItem.minValue?.toFixed(4) ?? null,
        maxValue: v.inspectionStandardItem.maxValue?.toFixed(4) ?? null,
        measuredValue: v.measuredValue.toFixed(4),
        isPassed: isWithin(Number(v.measuredValue), v.inspectionStandardItem.minValue === null ? null : Number(v.inspectionStandardItem.minValue), v.inspectionStandardItem.maxValue === null ? null : Number(v.inspectionStandardItem.maxValue)),
      })),
    };
  }

  private async toAllocationInfos(tx: Tx, allocations: Awaited<ReturnType<LotRepository['findLiveAllocations']>>): Promise<LotAllocationInfo[]> {
    if (allocations.length === 0) return [];
    const itemIds = allocations.flatMap((a) => (a.shipmentRequestItemId === null ? [] : [a.shipmentRequestItemId]));
    const planIds = allocations.flatMap((a) => (a.productionPlanId === null ? [] : [a.productionPlanId]));
    const requestItems = await this.repository.findShipmentRequestItems(tx, itemIds);
    const [requests, plans] = await Promise.all([
      this.repository.findShipmentRequests(tx, [...new Set(requestItems.map((i) => i.shipmentRequestId))]),
      this.repository.findProductionPlans(tx, planIds),
    ]);
    const requestByItem = new Map(requestItems.map((i) => [i.id, requests.find((r) => r.id === i.shipmentRequestId)]));
    const planById = new Map(plans.map((p) => [p.id, p]));
    return allocations.map((a) => {
      const request = a.shipmentRequestItemId === null ? undefined : requestByItem.get(a.shipmentRequestItemId);
      const plan = a.productionPlanId === null ? undefined : planById.get(a.productionPlanId);
      return {
        id: a.id,
        allocationPurpose: a.allocationPurpose as AllocationPurpose,
        allocationStatus: a.allocationStatus as AllocationStatus,
        shipmentRequest: request ? { id: request.id, shipmentRequestNo: request.shipmentRequestNo } : null,
        productionPlan: plan ? { id: plan.id, productionPlanNo: plan.productionPlanNo } : null,
      };
    });
  }

  /** LOT들의 출하 배정(CONFIRMED·CONSUMED)을 출하요청·수주·밀시트까지 이어서 읽는다 */
  private async shipmentLinks(tx: Tx, lotIds: number[]): Promise<ShipmentLink[]> {
    if (lotIds.length === 0) return [];
    const allocations = await this.repository.findLiveAllocations(tx, lotIds, ALLOCATION_PURPOSE.SHIPMENT);
    const requestItemIds = allocations.flatMap((a) => (a.shipmentRequestItemId === null ? [] : [a.shipmentRequestItemId]));
    if (requestItemIds.length === 0) return [];
    const requestItems = await this.repository.findShipmentRequestItems(tx, requestItemIds);
    const requestIds = [...new Set(requestItems.map((i) => i.shipmentRequestId))];
    const [requests, soItems, millSheets] = await Promise.all([
      this.repository.findShipmentRequests(tx, requestIds),
      this.repository.findSalesOrderItems(tx, [...new Set(requestItems.map((i) => i.salesOrderItemId))]),
      this.repository.findMillSheets(tx, requestIds),
    ]);
    const [customers, salesOrders] = await Promise.all([
      this.repository.findCustomers(tx, [...new Set(requests.map((r) => r.customerId))]),
      this.repository.findSalesOrders(tx, [...new Set(soItems.map((i) => i.salesOrderId))]),
    ]);
    const itemById = new Map(requestItems.map((i) => [i.id, i]));
    const requestById = new Map(requests.map((r) => [r.id, r]));
    const soItemById = new Map(soItems.map((i) => [i.id, i]));
    const customerById = new Map(customers.map((c) => [c.id, c.customerName]));
    const salesOrderById = new Map(salesOrders.map((s) => [s.id, s]));

    return allocations.flatMap((a): ShipmentLink[] => {
      const requestItem = a.shipmentRequestItemId === null ? undefined : itemById.get(a.shipmentRequestItemId);
      const request = requestItem ? requestById.get(requestItem.shipmentRequestId) : undefined;
      if (!requestItem || !request) return [];
      const soItem = soItemById.get(requestItem.salesOrderItemId);
      const salesOrder = soItem ? salesOrderById.get(soItem.salesOrderId) : undefined;
      return [
        {
          lotId: a.lotId,
          allocationStatus: a.allocationStatus as AllocationStatus,
          shipmentRequestId: request.id,
          shipmentRequestNo: request.shipmentRequestNo,
          shipmentRequestStatus: request.shipmentRequestStatus as ShipmentRequestStatus,
          issuedAt: request.issuedAt,
          customerName: customerById.get(request.customerId) ?? '',
          salesOrder: salesOrder ? { salesOrderId: salesOrder.id, salesOrderNo: salesOrder.salesOrderNo } : null,
          dueDate: soItem?.dueDate ?? null,
          millSheets: millSheets.filter((m) => m.shipmentRequestId === request.id && m.salesOrderId === salesOrder?.id).map((m) => ({ id: m.id, millSheetNo: m.millSheetNo, salesOrderId: m.salesOrderId })),
        },
      ];
    });
  }

  private toShipmentInfo(link: ShipmentLink): LotShipmentInfo {
    return {
      shipmentRequestId: link.shipmentRequestId,
      shipmentRequestNo: link.shipmentRequestNo,
      shipmentRequestStatus: link.shipmentRequestStatus,
      allocationStatus: link.allocationStatus,
      issuedAt: link.issuedAt?.toISOString() ?? null,
      customerName: link.customerName,
      salesOrder: link.salesOrder,
      millSheets: link.millSheets,
    };
  }

  /** 출하요청 × 수주로 묶는다. 묶음 안의 LOT이 모두 출고(CONSUMED)돼야 출고로 본다 */
  private groupShipments(links: ShipmentLink[]): TraceShipment[] {
    const groups = new Map<string, ShipmentLink[]>();
    for (const link of links) {
      const key = `${link.shipmentRequestId}:${link.salesOrder?.salesOrderId ?? 0}`;
      groups.set(key, [...(groups.get(key) ?? []), link]);
    }
    return [...groups.values()]
      .map((group) => {
        return {
          ...this.toShipmentInfo(group[0]),
          allocationStatus: group.every((l) => l.allocationStatus === ALLOCATION_STATUS.CONSUMED) ? ALLOCATION_STATUS.CONSUMED : ALLOCATION_STATUS.CONFIRMED,
          lotIds: [...new Set(group.map((l) => l.lotId))].sort((a, b) => a - b),
        };
      })
      .sort((a, b) => a.shipmentRequestId - b.shipmentRequestId || (a.salesOrder?.salesOrderId ?? 0) - (b.salesOrder?.salesOrderId ?? 0));
  }

  /** 정추적 영향 범위: 영향받은 슬래브·코일 수와 출고 여부, 연결된 수주 */
  private impactOf(nodes: TraceLotNode[], links: ShipmentLink[]): TraceImpact {
    const slabs = nodes.filter((n) => n.lotType === LOT_TYPE.SLAB);
    const coils = nodes.filter((n) => n.lotType === LOT_TYPE.COIL);
    const products = [...slabs, ...coils];
    const bySalesOrder = new Map<number, ShipmentLink[]>();
    for (const link of links) {
      if (!link.salesOrder) continue;
      bySalesOrder.set(link.salesOrder.salesOrderId, [...(bySalesOrder.get(link.salesOrder.salesOrderId) ?? []), link]);
    }
    return {
      slabCount: slabs.length,
      coilCount: coils.length,
      shippedLotCount: products.filter((n) => n.lotStatus === LOT_STATUS.SHIPPED).length,
      unshippedLotCount: products.filter((n) => n.lotStatus === LOT_STATUS.AVAILABLE).length,
      consumedLotCount: slabs.filter((n) => n.lotStatus === LOT_STATUS.CONSUMED).length,
      salesOrders: [...bySalesOrder.values()]
        .map((group) => {
          const dueDates = group.flatMap((l) => (l.dueDate ? [l.dueDate.toISOString().slice(0, 10)] : [])).sort();
          return {
            salesOrderId: group[0].salesOrder!.salesOrderId,
            salesOrderNo: group[0].salesOrder!.salesOrderNo,
            customerName: group[0].customerName,
            hasShipped: group.some((l) => l.allocationStatus === ALLOCATION_STATUS.CONSUMED),
            lotCount: new Set(group.map((l) => l.lotId)).size,
            dueDate: dueDates[0] ?? null,
          };
        })
        .sort((a, b) => a.salesOrderId - b.salesOrderId),
    };
  }
}
