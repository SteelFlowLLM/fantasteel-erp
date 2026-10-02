import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE,
  QUALITY_INSPECTION_LIST_STATUS,
  type AuthUser,
  type PageResult,
  type QualityInspectionDetail,
  type QualityInspectionListItem,
} from '@fantasteel/shared';
import { BusinessEventRecorder } from '../../common/business-event/business-event.recorder';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JUDGED_INSPECTION_RESULTS, type ListQualityInspectionsDto } from './dto/list-quality-inspections.dto';
import type { RegisterQualityInspectionDto } from './dto/register-quality-inspection.dto';
import { isItemApplicable, judgeInspection } from './inspection-judge';
import { toQualityInspectionDetail } from './quality-inspection-detail';
import {
  INSPECTED_LOT_TYPES,
  lotTypesForProcess,
  pickLatestStandards,
  toInspectedLotSummary,
  toQualityInspectionListItem,
  type InspectedLotType,
} from './quality-inspection-list';
import { QualityRepository } from './quality.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/** 입력 측정값 → 항목 id별 값. 같은 항목을 두 번 보내거나 이 LOT에 적용되지 않는 항목이면 COM-004 */
function toMeasuredValues(dto: RegisterQualityInspectionDto, applicableItemIds: Set<number>): Map<number, Prisma.Decimal> {
  const measured = new Map<number, Prisma.Decimal>();
  for (const { inspectionStandardItemId, measuredValue } of dto.values) {
    if (!applicableItemIds.has(inspectionStandardItemId)) {
      throw new AppException('COM-004', `이 LOT에 적용되지 않는 검사 항목이에요 (항목 id ${inspectionStandardItemId})`);
    }
    if (measured.has(inspectionStandardItemId)) {
      throw new AppException('COM-004', `같은 검사 항목을 두 번 보냈어요 (항목 id ${inspectionStandardItemId})`);
    }
    measured.set(inspectionStandardItemId, new Prisma.Decimal(measuredValue));
  }
  return measured;
}

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 트랜잭션: this.prisma.$transaction(async (tx) => { ... }) 안에서 repository와 businessEventRecorder.record(tx, ...)를 부른다.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: QualityRepository,
    private readonly businessEventRecorder: BusinessEventRecorder,
  ) {}

  /**
   * 검사 대기·검사 목록 (API-125, REQ-QC-001).
   * 검사 대기 = 검사 행이 없거나 PENDING인 히트·슬래브·코일 LOT. 상위 히트가 불합격인 슬래브·코일은 뺀다.
   */
  async listQualityInspections(query: ListQualityInspectionsDto): Promise<PageResult<QualityInspectionListItem>> {
    const isPending = (query.status ?? QUALITY_INSPECTION_LIST_STATUS.PENDING) === QUALITY_INSPECTION_LIST_STATUS.PENDING;
    if (isPending && query.inspectionResult) {
      throw new AppException('COM-004', '판정 필터는 status=done일 때만 쓸 수 있어요');
    }
    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;

    const [{ lots, total }, standards] = await Promise.all([
      this.repository.findInspectionListLots(this.prisma, {
        lotTypes: lotTypesForProcess(query.processType),
        isPending,
        inspectionResults: query.inspectionResult ? [query.inspectionResult] : [...JUDGED_INSPECTION_RESULTS],
        lotId: query.lotId,
        lotNo: query.lotNo,
        skip: (page - 1) * size,
        take: size,
      }),
      this.repository.findInspectionStandardVersions(this.prisma),
    ]);
    const latestStandards = pickLatestStandards(standards);
    return { items: lots.map((lot) => toQualityInspectionListItem(lot, latestStandards)), page, size, total };
  }

  /** 검사 상세 (API-116, REQ-QC-001·003): LOT·항목별 측정값·판정과 판정에 쓴 기준 버전 */
  async getQualityInspection(qualityInspectionId: number): Promise<QualityInspectionDetail> {
    const record = await this.repository.findInspectionDetail(this.prisma, qualityInspectionId);
    if (!record) throw new AppException('COM-003', '검사를 찾을 수 없어요');
    return toQualityInspectionDetail(record);
  }

  /**
   * 검사 등록·자동 판정 (API-117·224, REQ-QC-001·003, BP-QC-01).
   * LOT당 1건. 그 공정·강종의 최신 기준 버전으로 판정하고 버전을 남긴다. 작업 로그는 같은 tx에서 남긴다.
   */
  async registerQualityInspection(dto: RegisterQualityInspectionDto, user: AuthUser): Promise<QualityInspectionDetail> {
    return this.prisma.$transaction(async (tx) => {
      const lot = await this.repository.findLotForRegistration(tx, dto.lotId);
      if (!lot) throw new AppException('COM-003', 'LOT을 찾을 수 없어요');
      if (!INSPECTED_LOT_TYPES.includes(lot.lotType as InspectedLotType)) {
        throw new AppException('COM-004', '검사 대상은 히트·슬래브·코일 LOT이에요');
      }
      // 같은 LOT 동시 등록은 lot_id unique가 막는다 (P2002 → COM-001)
      if (lot.qualityInspection) {
        throw new AppException('COM-001', '이미 검사가 등록된 LOT이에요. 측정값은 검사 수정으로 고쳐 주세요');
      }

      const summary = toInspectedLotSummary(lot);
      const standard =
        summary.steelGradeId === null
          ? null
          : await this.repository.findLatestInspectionStandard(tx, summary.processType, summary.steelGradeId);
      if (!standard) throw new AppException('MST-001', '이 LOT의 공정·강종에 검사 기준이 없어요');

      const thicknessMm = lot.item?.thicknessMm ?? null;
      const applicableItems = standard.inspectionStandardItems.filter((item) => isItemApplicable(item, thicknessMm));
      const measuredByItemId = toMeasuredValues(dto, new Set(applicableItems.map((item) => item.id)));
      const judgement = judgeInspection(applicableItems, measuredByItemId);

      const inspection = await this.repository.createQualityInspection(tx, {
        lotId: lot.id,
        inspectionStandardId: standard.id,
        inspectionResult: judgement.inspectionResult,
        inspectorEmployeeId: user.employeeId,
        inspectedAt: new Date(),
      });
      await this.repository.createQualityInspectionValues(
        tx,
        [...measuredByItemId].map(([inspectionStandardItemId, measuredValue]) => ({
          qualityInspectionId: inspection.id,
          inspectionStandardItemId,
          measuredValue,
        })),
      );

      const codeOf = new Map(applicableItems.map((item) => [item.id, item.inspectionItemCode]));
      await this.businessEventRecorder.record(tx, {
        type: BUSINESS_EVENT_TYPE.INSPECTION_REGISTERED,
        actor: user,
        target: { table: 'quality_inspection', id: inspection.id },
        salesOrderId: lot.productionResult?.productionPlan?.salesOrderItem?.salesOrderId ?? null,
        lotIds: [lot.id],
        // 불합격은 별도 이벤트 없이 이 이벤트의 판정 결과로 구분한다 ([06] BUSINESS_EVENT_TYPE, quality.md 5장)
        after: {
          inspectionResult: judgement.inspectionResult,
          inspectionStandardCode: standard.inspectionStandardCode,
          versionNo: standard.versionNo,
          values: [...measuredByItemId].map(([itemId, value]) => ({
            inspectionStandardItemId: itemId,
            inspectionItemCode: codeOf.get(itemId),
            measuredValue: value.toFixed(4),
          })),
          failedItemCodes: judgement.failedItemIds.map((id) => codeOf.get(id)),
          missingRequiredItemCodes: judgement.missingRequiredItemIds.map((id) => codeOf.get(id)),
        },
      });

      // TODO(leehs32780): inventory 모듈의 onLotsEligibilityChanged(tx, lotIds, actor)가 생기면 여기서 부른다.
      //   적격이 된 LOT on_hand +1·자동 예약, FAIL이면 하위 LOT 배정 해제 (quality.md 4장 "판정 뒤 재고 반영", 이슈 #18)

      const detail = await this.repository.findInspectionDetail(tx, inspection.id);
      if (!detail) throw new AppException('COM-003');
      return toQualityInspectionDetail(detail);
    });
  }
}
