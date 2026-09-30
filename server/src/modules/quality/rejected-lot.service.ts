import { Injectable } from '@nestjs/common';
import { DISPOSITION_STATUS_LABEL, type AuthUser, type DispositionStatus } from '@fantasteel/shared';
import { lockLots } from '../../common/concurrency/locks';
import { badInput, invalidState, notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import type { SetDispositionDto } from './dto/set-disposition.dto';
import { QualityRepository } from './quality.repository';

/** 불합격 LOT 조회와 처리 상태 지정 (REQ-QC-004). 재고·예약에는 손대지 않는다 (불합격 LOT은 이미 제외돼 있다). */
@Injectable()
export class RejectedLotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QualityRepository,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  /** 불합격 LOT과 불합격 히트의 하위 LOT. 불합격 항목·처리 상태·영향받는 수주 품목·재생산 계획 유무를 함께 준다. */
  async list() {
    return this.views(this.prisma);
  }

  private async views(tx: Tx, onlyLotId?: number) {
    const lots = (await this.repo.rejectedLots(tx)).filter((l) => !onlyLotId || l.id === onlyLotId);
    // 영향받는 수주 품목: LOT에 남아 있는 수주 품목, 없으면(히트 등) 생산계획의 수주 품목.
    const itemIdOf = (l: (typeof lots)[number]) => l.salesOrderItemId ?? l.productionPlan?.salesOrderItemId ?? null;
    const itemIds = [...new Set(lots.map(itemIdOf).filter((v): v is number => v !== null))];
    const items = new Map((itemIds.length ? await this.repo.salesOrderItems(tx, itemIds) : []).map((i) => [i.id, i]));
    const plans = itemIds.length ? await this.repo.reproductionPlans(tx, itemIds) : [];
    const heatIds = [...new Set(lots.filter((l) => l.isPassed !== false && l.heatLot).map((l) => l.heatLot!.id))];
    const heatFailures = new Map<number, Awaited<ReturnType<QualityRepository['failedInspectionOfLot']>>>();
    for (const id of heatIds) heatFailures.set(id, await this.repo.failedInspectionOfLot(tx, id));

    return lots.map((l) => {
      const own = l.qualityInspections.find((q) => q.inspectionResult === 'FAIL') ?? null;
      const byHeat = l.isPassed !== false;
      const inspection = own ?? (l.heatLot ? heatFailures.get(l.heatLot.id) ?? null : null);
      const itemId = itemIdOf(l);
      const item = itemId ? items.get(itemId) : undefined;
      const reproductionPlan = plans.find((p) => p.salesOrderItemId === itemId) ?? null;
      return {
        id: l.id,
        lotNo: l.lotNo,
        lotType: l.lotType,
        lotStatus: l.lotStatus,
        isPassed: l.isPassed,
        /** OWN = 자기 검사 불합격, HEAT = 상위 히트 성분 불합격으로 사용 불가 */
        rejectedBy: byHeat ? ('HEAT' as const) : ('OWN' as const),
        steelGradeCode: l.steelGrade?.steelGradeCode ?? null,
        specCode: l.productSpec?.specCode ?? null,
        heatLotId: l.heatLot?.id ?? null,
        heatLotNo: l.heatLot?.lotNo ?? null,
        productionPlanId: l.productionPlan?.id ?? null,
        productionPlanNo: l.productionPlan?.productionPlanNo ?? null,
        failedInspection: inspection
          ? {
              id: inspection.id, qualityInspectionNo: inspection.qualityInspectionNo, processCode: inspection.processCode, inspectedAt: inspection.inspectedAt,
              failedItems: inspection.values.map((v) => ({
                inspectionItemCode: v.inspectionItemCode, inspectionItemName: v.inspectionItemName, unit: v.unit, minValue: v.minValue, maxValue: v.maxValue, measuredValue: v.measuredValue,
              })),
            }
          : null,
        dispositionStatus: l.dispositionStatus,
        dispositionReason: l.dispositionReason,
        dispositionAt: l.dispositionAt,
        affectedSalesOrderItem: item
          ? {
              salesOrderItemId: item.id, salesOrderId: item.salesOrderId, salesOrderNo: item.salesOrder.salesOrderNo, lineNo: item.lineNo,
              customerName: item.salesOrder.customer.customerName, dueDate: item.salesOrder.dueDate, orderedQty: item.orderedQty, salesOrderItemStatus: item.salesOrderItemStatus,
            }
          : null,
        hasReproductionPlan: !!reproductionPlan,
        reproductionPlan: reproductionPlan ? { id: reproductionPlan.id, productionPlanNo: reproductionPlan.productionPlanNo, productionPlanStatus: reproductionPlan.productionPlanStatus, shortageQty: reproductionPlan.shortageQty } : null,
        producedAt: l.producedAt,
      };
    });
  }

  async setDisposition(lotId: number, dto: SetDispositionDto, user: AuthUser) {
    const reason = dto.reason.trim();
    if (!reason) throw badInput('사유를 입력해 주세요');
    return this.prisma.tx(async (tx) => {
      await lockLots(tx, [lotId]);
      const lot = await this.repo.findLot(tx, lotId);
      if (!lot) throw notFound('LOT');
      if (lot.isPassed !== false && lot.heatLot?.isPassed !== false) throw invalidState('불합격 LOT에만 처리 상태를 지정할 수 있습니다');
      const label = DISPOSITION_STATUS_LABEL[dto.dispositionStatus as DispositionStatus];
      await this.repo.setDisposition(tx, lot.id, { dispositionStatus: dto.dispositionStatus, dispositionReason: reason, dispositionAt: new Date() });
      await this.events.record(tx, {
        actor: user,
        eventType: 'DISPOSITION_SET',
        targetType: 'LOT',
        targetId: lot.id,
        targetNo: lot.lotNo,
        salesOrderId: (lot.salesOrderItem ?? lot.productionPlan?.salesOrderItem)?.salesOrderId ?? null,
        lotIds: [lot.id],
        summary: `${lot.lotNo} 불합격 처리 상태: ${label}`,
        before: { dispositionStatus: lot.dispositionStatus, dispositionReason: lot.dispositionReason },
        after: { dispositionStatus: dto.dispositionStatus, dispositionReason: reason },
        reasonCode: 'QUALITY_FAILURE',
        reason,
      });
      this.realtime.changed('lots', 'quality-inspections');
      return (await this.views(tx, lot.id))[0];
    });
  }
}
