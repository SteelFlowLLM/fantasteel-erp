import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  INSPECTION_RESULT,
  PERMISSION,
  type AuthUser,
  type DispositionStatus,
  type InspectionResult,
  type PageResult,
  type RejectedLotEvidence,
  type RejectedLotListItem,
} from '@fantasteel/shared';
import { hasPermission } from '../../common/auth/auth.guard';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { ListRejectedLotsDto } from './dto/list-rejected-lots.dto';
import type { SetLotDispositionDto } from './dto/set-lot-disposition.dto';
import { toQualityInspectionDetail } from './quality-inspection-detail';
import { toInspectedLotSummary } from './quality-inspection-list';
import { RejectedLotRepository, type RejectedLot } from './rejected-lot.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/** 근거 검사의 LOT: 자기 검사가 FAIL이면 자기, 아니면(불합격 히트의 하위) 상위 히트 (TRM-078) */
function evidenceLotIdOf(lot: RejectedLot): number | null {
  return lot.qualityInspection?.inspectionResult === INSPECTION_RESULT.FAIL ? lot.id : toInspectedLotSummary(lot).heatLotId;
}

function toRejectedLotListItem(lot: RejectedLot, evidenceByLotId: ReadonlyMap<number, RejectedLotEvidence>): RejectedLotListItem {
  const evidenceLotId = evidenceLotIdOf(lot);
  return {
    ...toInspectedLotSummary(lot),
    qualityInspectionId: lot.qualityInspection?.id ?? null,
    inspectionResult: (lot.qualityInspection?.inspectionResult as InspectionResult | undefined) ?? null,
    dispositionStatus: (lot.dispositionStatus as DispositionStatus | null) ?? null,
    dispositionReason: lot.dispositionReason,
    updatedAt: lot.updatedAt.toISOString(),
    evidence: (evidenceLotId === null ? undefined : evidenceByLotId.get(evidenceLotId)) ?? null,
  };
}

/** 불합격 LOT 조회·처리 상태 (REQ-QC-004, TRM-078·079) */
@Injectable()
export class RejectedLotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RejectedLotRepository,
    private readonly businessEventRecorder: BusinessEventRecorder,
  ) {}

  /**
   * 불합격 LOT 목록 (API-123): 불합격 LOT과 불합격 히트의 하위 LOT, 처리 상태·사유.
   * 권한은 DISPOSITION_SET 또는 INSPECTION_REGISTER (VIEW 이상). "또는"이라 service에서 확인한다 (quality.md 3장)
   */
  async listRejectedLots(query: ListRejectedLotsDto, user: AuthUser): Promise<PageResult<RejectedLotListItem>> {
    const canView =
      hasPermission(user, { permission: PERMISSION.DISPOSITION_SET, level: 'VIEW' }) ||
      hasPermission(user, { permission: PERMISSION.INSPECTION_REGISTER, level: 'VIEW' });
    if (!canView) throw new AppException('COM-002');

    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;
    const { lots, total } = await this.repository.findRejectedLots(this.prisma, { skip: (page - 1) * size, take: size, lotId: query.lotId });
    return { items: await this.toListItems(this.prisma, lots), page, size, total };
  }

  /** 목록 행 + 근거 검사(불합격 항목·검사 시각). 화면이 LOT마다 검사 상세를 따로 부르지 않게 한 번에 읽는다 */
  private async toListItems(tx: Tx, lots: RejectedLot[]): Promise<RejectedLotListItem[]> {
    const evidenceLotIds = [...new Set(lots.flatMap((lot) => evidenceLotIdOf(lot) ?? []))];
    const inspections = await this.repository.findInspectionsByLotIds(tx, evidenceLotIds);
    const evidenceByLotId = new Map(
      inspections.map((record): [number, RejectedLotEvidence] => {
        const detail = toQualityInspectionDetail(record, []);
        const failedItems = detail.items.filter((item) => item.isPassed === false);
        return [detail.lotId, { qualityInspectionId: detail.qualityInspectionId, lotId: detail.lotId, inspectedAt: detail.inspectedAt, failedItems }];
      }),
    );
    return lots.map((lot) => toRejectedLotListItem(lot, evidenceByLotId));
  }

  /**
   * 불합격 처리 상태 지정 (API-226·124, REQ-QC-004, quality.md 4장).
   * 불합격 LOT(자기 FAIL 또는 불합격 히트의 하위, TRM-078)에만 보류·격하·폐기와 사유를 기록한다. 다시 지정해 바꿀 수 있다(API-124).
   * 재고·예약·배정은 바꾸지 않는다: 후속 처리 로직 없음, 불합격 LOT은 이미 제외돼 있다(REQ-QC-004).
   * 작업 로그 DISPOSITION_SET은 같은 tx에서 남긴다 (quality.md 5장).
   */
  async setLotDisposition(lotId: number, dto: SetLotDispositionDto, user: AuthUser): Promise<RejectedLotListItem> {
    const dispositionReason = dto.dispositionReason.trim();
    if (!dispositionReason) throw new AppException('COM-004', '사유를 입력해 주세요');

    return this.prisma.$transaction(async (tx) => {
      const lot = await this.repository.findRejectedLot(tx, lotId);
      if (!lot) {
        if (!(await this.repository.lotExists(tx, lotId))) throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
        // [04] 9.3에 전용 코드가 없어 입력 에러로 돌려준다 (quality.md 8장, 2026-10-04 결정)
        throw new AppException('COM-004', '불합격 LOT에만 처리 상태를 지정할 수 있어요');
      }

      const isUnchanged = await this.repository.updateDispositionIfUnchanged(tx, lot.id, new Date(dto.expectedUpdatedAt), {
        dispositionStatus: dto.dispositionStatus,
        dispositionReason,
      });
      if (!isUnchanged) throw new AppException('COM-001', '그 사이 다른 사람이 이 LOT을 고쳤어요. 새로 불러와 주세요');

      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.DISPOSITION_SET,
        actor: user,
        target: { table: 'lot', id: lot.id },
        salesOrderId: lot.productionResult?.productionPlan?.salesOrderItem?.salesOrderId ?? null,
        lotIds: [lot.id],
        before: { dispositionStatus: lot.dispositionStatus, dispositionReason: lot.dispositionReason },
        after: { dispositionStatus: dto.dispositionStatus, dispositionReason },
        reason: dispositionReason,
      });

      const updated = await this.repository.findRejectedLot(tx, lot.id);
      if (!updated) throw new AppException('COM-003');
      const [item] = await this.toListItems(tx, [updated]);
      return item;
    });
  }
}
