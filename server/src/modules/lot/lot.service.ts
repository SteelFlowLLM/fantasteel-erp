import { Injectable } from '@nestjs/common';
import {
  ALLOCATION_PURPOSE_LABEL,
  DISPOSITION_STATUS_LABEL,
  INSPECTION_RESULT_LABEL,
  type AllocationPurpose,
  type DispositionStatus,
  type InspectionResult,
  type LotStatus,
  type LotType,
} from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListLotsDto } from './dto/list-lots.dto';
import { escapeLike } from './like-pattern';
import { inspectionResultLabel, inspectionResultOf, isProduct, lotStatusLabel, lotTitle, lotTypeLabel, rawMaterialTypeLabel, toInspectionSummary, weightTonOf } from './lot-view';
import { LotRepository, type LotViewRow } from './lot.repository';
import type { LotAllocationView, LotSalesOrderItemView, LotView } from './lot.types';

const DEFAULT_LIMIT = 50;
const SEARCH_LIMIT = 20;

@Injectable()
export class LotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LotRepository,
  ) {}

  async list(dto: ListLotsDto): Promise<{ items: LotView[]; total: number; limit: number }> {
    const limit = dto.limit ?? DEFAULT_LIMIT;
    const q = dto.q?.trim();
    const where: Prisma.LotWhereInput = {
      ...(dto.lotType ? { lotType: dto.lotType } : {}),
      ...(dto.lotStatus ? { lotStatus: dto.lotStatus } : {}),
      ...(dto.productSpecId ? { productSpecId: dto.productSpecId } : {}),
      ...(dto.steelGradeId ? { steelGradeId: dto.steelGradeId } : {}),
      ...(q ? { lotNo: { contains: escapeLike(q), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([this.repo.list(this.prisma, where, limit), this.repo.count(this.prisma, where)]);
    return { items: rows.map((r) => this.toView(r)), total, limit };
  }

  async getById(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('LOT');
    return this.toDetail(row);
  }

  async getByNo(lotNo: string) {
    const row = await this.repo.findByNo(this.prisma, lotNo);
    if (!row) throw notFound('LOT');
    return this.toDetail(row);
  }

  /** 번호 일부로 찾기 (검색 상자·자동완성). */
  async search(q: string | undefined, limit = SEARCH_LIMIT) {
    const text = q?.trim();
    if (!text) return [];
    const rows = await this.repo.searchByNo(this.prisma, text, limit);
    return rows.map((r) => ({
      id: r.id,
      lotNo: r.lotNo,
      lotType: r.lotType as LotType,
      lotTypeLabel: lotTypeLabel(r.lotType),
      lotStatus: r.lotStatus as LotStatus,
      lotStatusLabel: lotStatusLabel(r.lotStatus),
    }));
  }

  /** 상세 = 목록 항목 + 모든 검사(측정값) + 바로 위·아래 LOT. */
  private async toDetail(row: LotViewRow) {
    const [inspections, [parents, children]] = await Promise.all([this.repo.inspectionsOfLot(this.prisma, row.id), this.repo.relationsOfLot(this.prisma, row.id)]);
    const inspectorIds = [...new Set(inspections.map((i) => i.inspectorEmployeeId).filter((v): v is number => v !== null))];
    const names = new Map((inspectorIds.length ? await this.repo.employeeNames(this.prisma, inspectorIds) : []).map((e) => [e.id, e.employeeName]));
    return {
      ...this.toView(row),
      inspections: inspections.map((i) => ({
        qualityInspectionId: i.id,
        qualityInspectionNo: i.qualityInspectionNo,
        processCode: i.processCode,
        result: i.inspectionResult as InspectionResult,
        resultLabel: INSPECTION_RESULT_LABEL[i.inspectionResult as InspectionResult] ?? i.inspectionResult,
        inspectorName: i.inspectorEmployeeId ? (names.get(i.inspectorEmployeeId) ?? null) : null,
        inspectedAt: i.inspectedAt,
        memo: i.memo,
        values: i.values.map((v) => ({
          inspectionItemCode: v.inspectionItemCode,
          inspectionItemName: v.inspectionItemName,
          unit: v.unit,
          minValue: v.minValue?.toString() ?? null,
          maxValue: v.maxValue?.toString() ?? null,
          measuredValue: v.measuredValue?.toString() ?? null,
          isPassed: v.isPassed,
        })),
      })),
      parents: parents.map((r) => ({
        lotId: r.parentLot.id,
        lotNo: r.parentLot.lotNo,
        lotType: r.parentLot.lotType as LotType,
        relationType: r.relationType,
        evidenceType: r.evidenceType,
        inputTon: r.inputTon,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      })),
      children: children.map((r) => ({
        lotId: r.childLot.id,
        lotNo: r.childLot.lotNo,
        lotType: r.childLot.lotType as LotType,
        relationType: r.relationType,
        evidenceType: r.evidenceType,
        inputTon: r.inputTon,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      })),
    };
  }

  toView(row: LotViewRow): LotView {
    const inspectionResult = inspectionResultOf(row);
    const alloc = row.allocations[0];
    const eligible = isProduct(row.lotType) ? row.lotStatus === 'IN_STOCK' && row.isPassed === true && row.heatLot?.isPassed === true : null;
    return {
      id: row.id,
      lotNo: row.lotNo,
      lotType: row.lotType as LotType,
      lotTypeLabel: lotTypeLabel(row.lotType),
      lotStatus: row.lotStatus as LotStatus,
      lotStatusLabel: lotStatusLabel(row.lotStatus),
      title: lotTitle(row),
      rawMaterial: row.rawMaterial
        ? {
            id: row.rawMaterial.id,
            materialCode: row.rawMaterial.materialCode,
            materialName: row.rawMaterial.item.itemName,
            rawMaterialType: row.rawMaterial.rawMaterialType,
            rawMaterialTypeLabel: rawMaterialTypeLabel(row.rawMaterial.rawMaterialType),
          }
        : null,
      productSpec: row.productSpec
        ? {
            id: row.productSpec.id,
            specCode: row.productSpec.specCode,
            thicknessMm: row.productSpec.thicknessMm.toString(),
            widthMm: row.productSpec.widthMm.toString(),
            lengthMm: row.productSpec.lengthMm.toString(),
            theoreticalWeightTon: row.productSpec.theoreticalWeightTon.toFixed(3),
          }
        : null,
      steelGrade: row.steelGrade ? { id: row.steelGrade.id, steelGradeCode: row.steelGrade.steelGradeCode, steelGradeName: row.steelGrade.steelGradeName } : null,
      heat: row.heatLot ? { id: row.heatLot.id, lotNo: row.heatLot.lotNo, isPassed: row.heatLot.isPassed } : null,
      yard: row.yard ? { id: row.yard.id, yardCode: row.yard.yardCode, yardName: row.yard.yardName } : null,
      supplier: row.supplier ? { id: row.supplier.id, supplierName: row.supplier.supplierName } : null,
      blastFurnaceNo: row.blastFurnaceNo,
      converterNo: row.converterNo,
      weightTon: weightTonOf(row),
      initialTon: row.initialTon,
      remainingTon: row.remainingTon,
      isPassed: row.isPassed,
      inspectionResult,
      inspectionResultLabel: inspectionResultLabel(inspectionResult),
      inspection: toInspectionSummary(row),
      disposition: row.dispositionStatus
        ? {
            status: row.dispositionStatus,
            statusLabel: DISPOSITION_STATUS_LABEL[row.dispositionStatus as DispositionStatus] ?? row.dispositionStatus,
            reason: row.dispositionReason,
            at: row.dispositionAt,
          }
        : null,
      allocation: alloc ? this.toAllocation(alloc) : null,
      salesOrderItem: row.salesOrderItem ? this.toSalesOrderItem(row.salesOrderItem) : null,
      isEligible: eligible,
      isSurplus: row.lotType === 'SLAB' ? eligible === true && row.salesOrderItemId === null && !alloc : null,
      producedAt: row.producedAt,
      consumedAt: row.consumedAt,
    };
  }

  private toSalesOrderItem(item: NonNullable<LotViewRow['salesOrderItem']>): LotSalesOrderItemView {
    return {
      salesOrderItemId: item.id,
      salesOrderId: item.salesOrderId,
      salesOrderNo: item.salesOrder.salesOrderNo,
      lineNo: item.lineNo,
      customerId: item.salesOrder.customerId,
      customerName: item.salesOrder.customer.customerName,
      dueDate: item.salesOrder.dueDate,
    };
  }

  private toAllocation(a: LotViewRow['allocations'][number]): LotAllocationView {
    return {
      allocationId: a.id,
      purpose: a.purpose,
      purposeLabel: ALLOCATION_PURPOSE_LABEL[a.purpose as AllocationPurpose] ?? a.purpose,
      status: a.status,
      confirmedAt: a.confirmedAt,
      salesOrderItemId: a.salesOrderItemId,
      salesOrderNo: a.salesOrderItem?.salesOrder.salesOrderNo ?? null,
      lineNo: a.salesOrderItem?.lineNo ?? null,
      productionPlanId: a.productionPlanId,
      productionPlanNo: a.productionPlan?.productionPlanNo ?? null,
      shipmentRequestId: a.shipmentRequestItem?.shipmentRequestId ?? null,
      shipmentRequestNo: a.shipmentRequestItem?.shipmentRequest.shipmentRequestNo ?? null,
    };
  }
}
