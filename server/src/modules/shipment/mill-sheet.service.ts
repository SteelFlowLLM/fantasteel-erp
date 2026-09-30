import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import {
  BUSINESS_EVENT_TYPE, ERROR_CODE, EVENT_REASON_CODE, EVENT_TARGET_TYPE, INSPECTION_RESULT, ITEM_QTY_UNIT, PDF_STATUS, PROCESS_CODE,
  type AuthUser, type PdfStatus,
} from '@fantasteel/shared';
import { AppException, invalidState, notFound } from '../../common/errors/app.exception';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import { qtyTon, tonText } from '../sales-order/sales-order.view';
import type { ListMillSheetsDto } from './dto/list-mill-sheets.dto';
import { MillSheetPdfRenderer } from './mill-sheet-pdf.renderer';
import { MillSheetRepository, type SnapshotInspectionRow } from './mill-sheet.repository';
import type { MillSheetInspection, MillSheetSnapshot } from './mill-sheet.snapshot';
import { kstDayRange } from './shipment.view';

export interface MillSheetIssueInput {
  goodsIssue: { id: number; goodsIssueNo: string; confirmedAt: Date };
  shipmentRequestNo: string;
  customer: { id: number; customerCode: string; customerName: string };
  salesOrderItem: {
    id: number;
    lineNo: number;
    salesOrderId: number;
    salesOrder: { salesOrderNo: string };
    productSpec: {
      specCode: string;
      thicknessMm: Prisma.Decimal;
      widthMm: Prisma.Decimal;
      lengthMm: Prisma.Decimal;
      theoreticalWeightTon: Prisma.Decimal;
      item: { itemType: string };
      steelGrade: { steelGradeCode: string; steelGradeName: string; standardNo: string | null };
    };
  };
  lotIds: number[];
  actor: AuthUser;
}

export interface MillSheetListRow {
  id: number;
  millSheetNo: string;
  issuedAt: string;
  pdfStatus: PdfStatus;
  goodsIssueId: number;
  goodsIssueNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  lineNo: number;
  customerId: number;
  customerName: string;
  specCode: string;
  itemType: 'SLAB' | 'COIL';
  steelGradeCode: string;
  qty: number;
  qtyUnit: string;
  weightTon: string;
  heatNos: string[];
}

export interface MillSheetView {
  id: number;
  millSheetNo: string;
  goodsIssueId: number;
  salesOrderId: number;
  customerId: number;
  issuedAt: string;
  pdfStatus: PdfStatus;
  /** PDF가 만들어져 있으면 내려받는 경로 (GET), 없으면 null */
  pdfUrl: string | null;
  snapshot: MillSheetSnapshot;
}

@Injectable()
export class MillSheetService {
  private readonly logger = new Logger(MillSheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MillSheetRepository,
    private readonly numbering: NumberingService,
    private readonly storage: StorageService,
    private readonly renderer: MillSheetPdfRenderer,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  // ───────────────────────────── 발행 (출고 확정 tx 안) ─────────────────────────────

  /**
   * (출고 × 수주 품목) 1장. 고객사·수주·규격·LOT·히트·이론중량·히트 성분·검사 항목과 값을 이 시점 값으로 복사한다.
   * 기존 재고와 새 생산분처럼 히트가 다른 LOT이 섞여 있으면 히트마다 성분값을 따로 담는다.
   */
  async issue(tx: Tx, input: MillSheetIssueInput): Promise<{ id: number; millSheetNo: string }> {
    const lots = await this.repo.findLotsForSnapshot(tx, input.lotIds);
    const spec = input.salesOrderItem.productSpec;
    const itemType = spec.item.itemType as 'SLAB' | 'COIL';
    const millSheetNo = await this.numbering.documentNo(tx, 'MS');
    const issuedAt = input.goodsIssue.confirmedAt;

    const heats = new Map<number, { heatNo: string; composition: MillSheetInspection | null }>();
    for (const lot of lots) {
      if (lot.heatLot && !heats.has(lot.heatLot.id)) {
        heats.set(lot.heatLot.id, { heatNo: lot.heatLot.lotNo, composition: this.pickInspection(lot.heatLot.qualityInspections, PROCESS_CODE.STEELMAKING) });
      }
    }
    const snapshot: MillSheetSnapshot = {
      millSheetNo,
      issuedAt: issuedAt.toISOString(),
      customer: { customerCode: input.customer.customerCode, customerName: input.customer.customerName },
      salesOrder: {
        salesOrderId: input.salesOrderItem.salesOrderId, salesOrderNo: input.salesOrderItem.salesOrder.salesOrderNo,
        salesOrderItemId: input.salesOrderItem.id, lineNo: input.salesOrderItem.lineNo,
      },
      shipment: { shipmentRequestNo: input.shipmentRequestNo, goodsIssueNo: input.goodsIssue.goodsIssueNo, goodsIssuedAt: issuedAt.toISOString() },
      productSpec: {
        specCode: spec.specCode,
        itemType,
        steelGradeCode: spec.steelGrade.steelGradeCode,
        steelGradeName: spec.steelGrade.steelGradeName,
        standardNo: spec.steelGrade.standardNo,
        thicknessMm: spec.thicknessMm.toString(),
        widthMm: spec.widthMm.toString(),
        lengthMm: spec.lengthMm.toString(),
        theoreticalWeightTon: tonText(spec.theoreticalWeightTon),
      },
      qty: lots.length,
      qtyUnit: ITEM_QTY_UNIT[itemType],
      weightTon: tonText(qtyTon(lots.length, spec.theoreticalWeightTon)),
      heats: [...heats.values()],
      lots: lots.map((lot) => {
        const parent = lot.parentRelations[0]?.parentLot ?? null;
        return {
          lotNo: lot.lotNo,
          lotType: lot.lotType as 'SLAB' | 'COIL',
          heatNo: lot.heatLot?.lotNo ?? null,
          producedAt: lot.producedAt.toISOString(),
          inspection: this.pickInspection(lot.qualityInspections, itemType === 'COIL' ? PROCESS_CODE.HOT_ROLLING : PROCESS_CODE.CASTING),
          parentSlab: parent ? { lotNo: parent.lotNo, inspection: this.pickInspection(parent.qualityInspections, PROCESS_CODE.CASTING) } : null,
        };
      }),
    };

    const created = await this.repo.create(tx, {
      millSheetNo,
      goodsIssueId: input.goodsIssue.id,
      salesOrderId: input.salesOrderItem.salesOrderId,
      customerId: input.customer.id,
      issuedAt,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    });
    await this.events.record(tx, {
      actor: input.actor,
      eventType: BUSINESS_EVENT_TYPE.MILL_SHEET_ISSUED,
      targetType: EVENT_TARGET_TYPE.MILL_SHEET,
      targetId: created.id,
      targetNo: millSheetNo,
      salesOrderId: input.salesOrderItem.salesOrderId,
      lotIds: lots.map((l) => l.id),
      summary: `밀시트 ${millSheetNo} 발행 (${snapshot.salesOrder.salesOrderNo} #${snapshot.salesOrder.lineNo} ${snapshot.qty}${snapshot.qtyUnit}, 히트 ${snapshot.heats.map((h) => h.heatNo).join(', ')})`,
      after: { millSheetNo, goodsIssueNo: input.goodsIssue.goodsIssueNo, lotNos: snapshot.lots.map((l) => l.lotNo) },
      reasonCode: EVENT_REASON_CODE.GOODS_ISSUE,
    });
    this.realtime.changed('mill-sheets');
    return { id: created.id, millSheetNo };
  }

  /** 그 공정의 합격 검사 중 가장 최근 것. 합격 기록이 없으면 가장 최근 검사. */
  private pickInspection(rows: SnapshotInspectionRow[], processCode: string): MillSheetInspection | null {
    const ofProcess = rows.filter((r) => r.processCode === processCode);
    const picked = ofProcess.find((r) => r.inspectionResult === INSPECTION_RESULT.PASS) ?? ofProcess[0];
    if (!picked) return null;
    return {
      qualityInspectionNo: picked.qualityInspectionNo,
      processCode: picked.processCode,
      inspectionResult: picked.inspectionResult,
      inspectedAt: picked.inspectedAt?.toISOString() ?? null,
      values: picked.values.map((v) => ({
        inspectionItemCode: v.inspectionItemCode,
        inspectionItemName: v.inspectionItemName,
        unit: v.unit,
        minValue: v.minValue?.toString() ?? null,
        maxValue: v.maxValue?.toString() ?? null,
        measuredValue: v.measuredValue?.toString() ?? null,
        isPassed: v.isPassed,
      })),
    };
  }

  // ───────────────────────────── 조회 (저장된 스냅샷만) ─────────────────────────────

  async list(q: ListMillSheetsDto): Promise<MillSheetListRow[]> {
    const rows = await this.repo.findMany(this.prisma, { customerId: q.customerId, salesOrderId: q.salesOrderId, goodsIssueId: q.goodsIssueId, keyword: q.keyword, ...kstDayRange(q.from, q.to) });
    return rows.map((r) => {
      const s = r.snapshot as unknown as MillSheetSnapshot;
      return {
        id: r.id,
        millSheetNo: r.millSheetNo,
        issuedAt: r.issuedAt.toISOString(),
        pdfStatus: r.pdfStatus as PdfStatus,
        goodsIssueId: r.goodsIssueId,
        goodsIssueNo: s.shipment.goodsIssueNo,
        salesOrderId: r.salesOrderId,
        salesOrderNo: s.salesOrder.salesOrderNo,
        lineNo: s.salesOrder.lineNo,
        customerId: r.customerId,
        customerName: s.customer.customerName,
        specCode: s.productSpec.specCode,
        itemType: s.productSpec.itemType,
        steelGradeCode: s.productSpec.steelGradeCode,
        qty: s.qty,
        qtyUnit: s.qtyUnit,
        weightTon: s.weightTon,
        heatNos: s.heats.map((h) => h.heatNo),
      };
    });
  }

  async detail(id: number): Promise<MillSheetView> {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('밀시트');
    return this.toView(row);
  }

  // ───────────────────────────── PDF (REQ-SHP-004) ─────────────────────────────

  /**
   * 저장된 스냅샷으로 PDF를 만든다. 실패하면 pdf_status = FAILED만 남기고 SHP-001로 답한다.
   * 스냅샷과 출고는 건드리지 않으므로 몇 번을 다시 눌러도 같은 내용이 다시 그려질 뿐이다.
   */
  async generatePdf(id: number): Promise<MillSheetView> {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('밀시트');
    if (row.pdfStatus === PDF_STATUS.READY && row.pdfPath && this.storage.exists(row.pdfPath)) return this.toView(row);
    let pdfPath: string;
    try {
      const pdf = await this.renderer.render(row.snapshot as unknown as MillSheetSnapshot);
      pdfPath = await this.storage.save('mill-sheets', `${row.millSheetNo}.pdf`, pdf);
    } catch (e) {
      this.logger.warn(`밀시트 ${row.millSheetNo} PDF 생성 실패: ${(e as Error).message}`);
      await this.repo.updatePdf(this.prisma, id, PDF_STATUS.FAILED);
      this.realtime.changed('mill-sheets');
      throw new AppException(ERROR_CODE.SHP_001, '밀시트 PDF를 만들지 못했습니다. 스냅샷은 저장되어 있으니 다시 시도해 주세요', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const updated = await this.repo.updatePdf(this.prisma, id, PDF_STATUS.READY, pdfPath);
    this.realtime.changed('mill-sheets');
    return this.toView(updated);
  }

  async readPdf(id: number): Promise<{ stream: ReadStream; fileName: string }> {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('밀시트');
    if (row.pdfStatus !== PDF_STATUS.READY || !row.pdfPath || !this.storage.exists(row.pdfPath)) throw invalidState('PDF가 아직 없습니다. PDF 생성을 먼저 실행해 주세요');
    return { stream: this.storage.read(row.pdfPath), fileName: `${row.millSheetNo}.pdf` };
  }

  private toView(row: { id: number; millSheetNo: string; goodsIssueId: number; salesOrderId: number; customerId: number; issuedAt: Date; pdfStatus: string; pdfPath: string | null; snapshot: unknown }): MillSheetView {
    const hasPdf = row.pdfStatus === PDF_STATUS.READY && !!row.pdfPath;
    return {
      id: row.id,
      millSheetNo: row.millSheetNo,
      goodsIssueId: row.goodsIssueId,
      salesOrderId: row.salesOrderId,
      customerId: row.customerId,
      issuedAt: row.issuedAt.toISOString(),
      pdfStatus: row.pdfStatus as PdfStatus,
      pdfUrl: hasPdf ? `/api/v1/mill-sheets/${row.id}/pdf` : null,
      snapshot: row.snapshot as MillSheetSnapshot,
    };
  }
}
