import { Injectable } from '@nestjs/common';
import { LOT_EVIDENCE_TYPE_LABEL, LOT_TYPE, LOT_TYPE_LABEL, type LotEvidenceType, type LotRelationType, type LotStatus, type LotType } from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { TraceDirection } from './dto/trace-lot.dto';
import { LotGraphService } from './lot-graph.service';
import { inspectionResultLabel, inspectionResultOf, lotStatusLabel, lotTitle, lotTypeLabel, toInspectionSummary, weightTonOf } from './lot-view';
import { LotRepository, type LotTraceRow } from './lot.repository';
import type { LotSalesOrderLink, LotShipmentInfo, LotTraceEdge, LotTraceImpact, LotTraceLevel, LotTraceNode, LotTraceResponse } from './lot.types';

/** 원료 → 용선 → 히트 → 슬래브 → 코일 (열 배치 순서). */
const PROCESS_ORDER: LotType[] = [LOT_TYPE.RAW_MATERIAL, LOT_TYPE.HOT_METAL, LOT_TYPE.HEAT, LOT_TYPE.SLAB, LOT_TYPE.COIL];

@Injectable()
export class LotTraceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LotRepository,
    private readonly graph: LotGraphService,
  ) {}

  /** REQ-LOT-005: 코일→원료 역추적, 원료·히트→슬래브·코일→출하 정추적. */
  async trace(lotId: number, direction: TraceDirection): Promise<LotTraceResponse> {
    const db = this.prisma;
    const root = await db.lot.findUnique({ where: { id: lotId }, select: { id: true } });
    if (!root) throw notFound('LOT');

    const walk = await this.graph.walk(db, lotId, direction);
    const rows = await this.repo.lotsForTrace(db, [...walk.depths.keys()]);
    const goodsIssueIds = [...new Set(rows.flatMap((r) => r.goodsIssueItems.map((g) => g.goodsIssueId)))];
    const millSheets = goodsIssueIds.length ? await this.repo.millSheets(db, goodsIssueIds) : [];

    const nodes = rows
      .map((row) => this.toNode(row, lotId, walk.depths.get(row.id) ?? 0, millSheets))
      .sort((a, b) => a.depth - b.depth || a.producedAt.getTime() - b.producedAt.getTime() || a.id - b.id);
    const edges: LotTraceEdge[] = walk.relations.map((r) => ({
      id: r.id,
      parentId: r.parentLotId,
      childId: r.childLotId,
      relationType: r.relationType as LotRelationType,
      evidenceType: r.evidenceType as LotEvidenceType,
      evidenceLabel: LOT_EVIDENCE_TYPE_LABEL[r.evidenceType as LotEvidenceType] ?? r.evidenceType,
      isPeriodBased: r.evidenceType === 'PERIOD',
      inputTon: r.inputTon,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    }));

    const countByType: Record<string, number> = {};
    for (const n of nodes) countByType[n.lotType] = (countByType[n.lotType] ?? 0) + 1;

    return {
      direction,
      rootId: lotId,
      nodes,
      edges,
      levels: this.toLevels(nodes),
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        countByType,
        hasPeriodEvidence: edges.some((e) => e.isPeriodBased),
        hasCycle: walk.hasCycle,
        truncated: walk.truncated,
      },
      impact: direction === 'forward' ? this.toImpact(nodes) : null,
    };
  }

  private toNode(row: LotTraceRow, rootId: number, depth: number, millSheets: { id: number; millSheetNo: string; goodsIssueId: number; salesOrderId: number }[]): LotTraceNode {
    const inspectionResult = inspectionResultOf(row);
    const shipment = this.toShipment(row, millSheets);
    return {
      id: row.id,
      lotNo: row.lotNo,
      lotType: row.lotType as LotType,
      lotTypeLabel: lotTypeLabel(row.lotType),
      lotStatus: row.lotStatus as LotStatus,
      lotStatusLabel: lotStatusLabel(row.lotStatus),
      isRoot: row.id === rootId,
      depth,
      title: lotTitle(row),
      steelGradeCode: row.steelGrade?.steelGradeCode ?? null,
      productSpecCode: row.productSpec?.specCode ?? null,
      rawMaterialCode: row.rawMaterial?.materialCode ?? null,
      rawMaterialName: row.rawMaterial?.item.itemName ?? null,
      rawMaterialType: row.rawMaterial?.rawMaterialType ?? null,
      blastFurnaceNo: row.blastFurnaceNo,
      converterNo: row.converterNo,
      heatLotNo: row.heatLot?.lotNo ?? null,
      initialTon: row.initialTon,
      remainingTon: row.remainingTon,
      weightTon: weightTonOf(row),
      producedAt: row.producedAt,
      isPassed: row.isPassed,
      inspectionResult,
      inspectionResultLabel: inspectionResultLabel(inspectionResult),
      inspection: toInspectionSummary(row),
      salesOrderLinks: this.toSalesOrderLinks(row, shipment),
      shipment,
    };
  }

  private toShipment(row: LotTraceRow, millSheets: { id: number; millSheetNo: string; goodsIssueId: number; salesOrderId: number }[]): LotShipmentInfo | null {
    const item = row.goodsIssueItems[0];
    if (!item) return null;
    const req = item.shipmentRequestItem;
    const soItem = req.salesOrderItem;
    const sheets = millSheets.filter((m) => m.goodsIssueId === item.goodsIssueId && m.salesOrderId === soItem.salesOrderId);
    return {
      goodsIssueId: item.goodsIssueId,
      goodsIssueNo: item.goodsIssue.goodsIssueNo,
      issuedAt: item.goodsIssue.confirmedAt,
      shipmentRequestId: req.shipmentRequestId,
      shipmentRequestNo: req.shipmentRequest.shipmentRequestNo,
      customerId: req.shipmentRequest.customerId,
      customerCode: req.shipmentRequest.customer.customerCode,
      customerName: req.shipmentRequest.customer.customerName,
      salesOrderId: soItem.salesOrderId,
      salesOrderNo: soItem.salesOrder.salesOrderNo,
      salesOrderItemId: soItem.id,
      lineNo: soItem.lineNo,
      millSheetIds: sheets.map((m) => m.id),
      millSheetNos: sheets.map((m) => m.millSheetNo),
    };
  }

  private toSalesOrderLinks(row: LotTraceRow, shipment: LotShipmentInfo | null): LotSalesOrderLink[] {
    const links = new Map<string, LotSalesOrderLink>();
    const add = (linkType: LotSalesOrderLink['linkType'], item: NonNullable<LotTraceRow['salesOrderItem']>) => {
      links.set(`${linkType}:${item.id}`, {
        linkType,
        salesOrderItemId: item.id,
        salesOrderId: item.salesOrderId,
        salesOrderNo: item.salesOrder.salesOrderNo,
        lineNo: item.lineNo,
        customerId: item.salesOrder.customerId,
        customerName: item.salesOrder.customer.customerName,
        dueDate: item.salesOrder.dueDate,
      });
    };
    if (row.salesOrderItem) add('PRODUCED_FOR', row.salesOrderItem);
    for (const a of row.allocations) if (a.salesOrderItem) add('ALLOCATED', a.salesOrderItem);
    const shippedItem = row.goodsIssueItems[0]?.shipmentRequestItem.salesOrderItem;
    if (shipment && shippedItem) add('SHIPPED', shippedItem);
    return [...links.values()];
  }

  private toLevels(nodes: LotTraceNode[]): LotTraceLevel[] {
    return PROCESS_ORDER.map((lotType) => ({
      lotType,
      label: LOT_TYPE_LABEL[lotType],
      nodeIds: nodes.filter((n) => n.lotType === lotType).map((n) => n.id),
    })).filter((l) => l.nodeIds.length > 0);
  }

  /** 정추적 요약: 영향받은 출고(고객사·밀시트)와 수주. */
  private toImpact(nodes: LotTraceNode[]): LotTraceImpact {
    const products = nodes.filter((n) => n.lotType === 'SLAB' || n.lotType === 'COIL');
    const shipments = new Map<number, LotTraceImpact['shipments'][number]>();
    for (const n of products) {
      const s = n.shipment;
      if (!s) continue;
      const g = shipments.get(s.goodsIssueId) ?? {
        goodsIssueId: s.goodsIssueId,
        goodsIssueNo: s.goodsIssueNo,
        issuedAt: s.issuedAt,
        shipmentRequestNo: s.shipmentRequestNo,
        customerId: s.customerId,
        customerName: s.customerName,
        salesOrderId: s.salesOrderId,
        salesOrderNo: s.salesOrderNo,
        millSheetNos: s.millSheetNos,
        lotIds: [],
        lotNos: [],
      };
      g.lotIds.push(n.id);
      g.lotNos.push(n.lotNo);
      shipments.set(s.goodsIssueId, g);
    }
    const salesOrderMap = new Map<number, LotTraceImpact['salesOrders'][number]>();
    for (const n of nodes) {
      // 한 LOT이 같은 수주에 여러 방식으로 닿아도 그 수주는 1번만 센다
      const perSalesOrder = new Map<number, { link: LotSalesOrderLink; shipped: boolean }>();
      for (const l of n.salesOrderLinks) {
        const cur = perSalesOrder.get(l.salesOrderId);
        perSalesOrder.set(l.salesOrderId, { link: cur?.link ?? l, shipped: (cur?.shipped ?? false) || l.linkType === 'SHIPPED' });
      }
      for (const { link, shipped } of perSalesOrder.values()) {
        const o = salesOrderMap.get(link.salesOrderId) ?? {
          salesOrderId: link.salesOrderId,
          salesOrderNo: link.salesOrderNo,
          customerName: link.customerName,
          dueDate: link.dueDate,
          lotCount: 0,
          hasShipped: false,
        };
        o.lotCount += 1;
        o.hasShipped = o.hasShipped || shipped;
        salesOrderMap.set(link.salesOrderId, o);
      }
    }
    const shipped = products.filter((n) => n.shipment).length;
    return {
      shippedProductLotCount: shipped,
      unshippedProductLotCount: products.length - shipped,
      shipments: [...shipments.values()],
      salesOrders: [...salesOrderMap.values()].sort((a, b) => a.salesOrderId - b.salesOrderId),
    };
  }
}
