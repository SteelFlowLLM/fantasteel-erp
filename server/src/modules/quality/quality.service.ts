import { Injectable } from '@nestjs/common';
import {
  QUALITY_INSPECTION_LIST_STATUS,
  type PageResult,
  type QualityInspectionDetail,
  type QualityInspectionListItem,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { JUDGED_INSPECTION_RESULTS, type ListQualityInspectionsDto } from './dto/list-quality-inspections.dto';
import { toQualityInspectionDetail } from './quality-inspection-detail';
import { lotTypesForProcess, pickLatestStandards, toQualityInspectionListItem } from './quality-inspection-list';
import { QualityRepository } from './quality.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/**
 * 업무 로직·트랜잭션·데이터에 따른 권한 검사 (컨벤션 6장).
 * 트랜잭션: this.prisma.$transaction(async (tx) => { ... }) 안에서 repository와 businessEventRecorder.record(tx, ...)를 부른다.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: QualityRepository,
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
}
