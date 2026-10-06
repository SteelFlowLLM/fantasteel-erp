import { Injectable } from '@nestjs/common';
import type { InspectionStandardDetail, InspectionStandardListItem, PageResult, ProcessType } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSPECTED_PROCESS_TYPES } from './dto/list-quality-inspections.dto';
import type { ListInspectionStandardsDto } from './dto/list-inspection-standards.dto';
import { InspectionStandardRepository, type InspectionStandardWithItems } from './inspection-standard.repository';
import { pickLatestStandards } from './quality-inspection-list';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

const toValueText = (value: Prisma.Decimal | null) => value?.toFixed(4) ?? null;
const toThicknessText = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;
const processOrder = (processType: string) => INSPECTED_PROCESS_TYPES.indexOf(processType as (typeof INSPECTED_PROCESS_TYPES)[number]);

function toInspectionStandardListItem(standard: InspectionStandardWithItems): InspectionStandardListItem {
  return {
    inspectionStandardId: standard.id,
    inspectionStandardCode: standard.inspectionStandardCode,
    versionNo: standard.versionNo,
    processType: standard.processType as ProcessType,
    steelGradeId: standard.steelGrade.id,
    steelGradeCode: standard.steelGrade.steelGradeCode,
    createdAt: standard.createdAt.toISOString(),
    items: standard.inspectionStandardItems.map((item) => ({
      inspectionStandardItemId: item.id,
      inspectionItemCode: item.inspectionItemCode,
      inspectionItemName: item.inspectionItemName,
      unit: item.unit,
      minValue: toValueText(item.minValue),
      maxValue: toValueText(item.maxValue),
      thicknessOverMm: toThicknessText(item.thicknessOverMm),
      thicknessUptoMm: toThicknessText(item.thicknessUptoMm),
      isRequired: item.isRequired,
    })),
  };
}

/** 검사 기준 조회·관리 (REQ-QC-002, REQ-MST-002). 기준은 수정하지 않고 새 버전으로 추가한다 ([ERD] inspection_standard Note) */
@Injectable()
export class InspectionStandardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InspectionStandardRepository,
  ) {}

  /**
   * 검사 기준 목록 (API-221): 공정·강종마다 최신 버전 하나와 그 항목 min/max·적용 두께 구간.
   * 최신 = 검사 등록이 판정에 고르는 버전과 같다(quality.md 4장 "기준 고르기"). 옛 버전은 목록에 넣지 않는다 (2026-10-04 결정).
   * 정렬: 공정(제강 → 연주 → 열연) → 강종 코드.
   */
  async listInspectionStandards(query: ListInspectionStandardsDto): Promise<PageResult<InspectionStandardListItem>> {
    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;

    const versions = await this.repository.findStandardVersions(this.prisma, {
      processType: query.processType,
      steelGradeId: query.steelGradeId,
    });
    const steelGradeCodeOf = new Map(versions.map((v) => [v.id, v.steelGrade.steelGradeCode]));
    const latest = [...pickLatestStandards(versions).values()].sort(
      (a, b) =>
        processOrder(a.processType) - processOrder(b.processType) ||
        (steelGradeCodeOf.get(a.id) ?? '').localeCompare(steelGradeCodeOf.get(b.id) ?? ''),
    );
    const pageIds = latest.slice((page - 1) * size, page * size).map((standard) => standard.id);

    const standards = await this.repository.findStandardsWithItems(this.prisma, pageIds);
    const byId = new Map(standards.map((standard) => [standard.id, standard]));
    const items = pageIds.map((id) => {
      const standard = byId.get(id);
      if (!standard) throw new AppException('COM-003');
      return toInspectionStandardListItem(standard);
    });
    return { items, page, size, total: latest.length };
  }

  /**
   * 검사 기준 상세 (API-120): 기준 버전 1건의 항목·단위·min/max·적용 두께 구간·필수 여부.
   * :id는 버전 id라 옛 버전도 그대로 보여 준다(검사 기록은 판정에 쓴 버전을 참조, REQ-QC-002).
   */
  async getInspectionStandard(inspectionStandardId: number): Promise<InspectionStandardDetail> {
    const standard = await this.repository.findStandardWithItems(this.prisma, inspectionStandardId);
    if (!standard) throw new AppException('COM-003', '검사 기준을 찾을 수 없어요');
    return toInspectionStandardListItem(standard);
  }
}
