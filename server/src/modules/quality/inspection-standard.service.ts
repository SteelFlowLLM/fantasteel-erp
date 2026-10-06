import { Injectable } from '@nestjs/common';
import type { InspectionStandardDetail, InspectionStandardListItem, PageResult, ProcessType } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateInspectionStandardDto } from './dto/create-inspection-standard.dto';
import { INSPECTED_PROCESS_TYPES } from './dto/list-quality-inspections.dto';
import type { ListInspectionStandardsDto } from './dto/list-inspection-standards.dto';
import { findStandardItemProblem, inspectionStandardCodeOf } from './inspection-standard-items';
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

  /**
   * 검사 기준 등록 (API-121, REQ-QC-002): 공정·강종의 첫 기준을 버전 1로 만든다.
   * 이미 기준이 있으면 거부하고 새 버전(API-122)으로 고치게 한다 (quality.md 8장 API 모양, 2026-10-04 결정).
   * 제강 기준의 항목이 강종 성분 규격이다(TRM-020). 기준 변경에 맞는 BUSINESS_EVENT_TYPE이 없어 작업 로그는 남기지 않는다([06]).
   */
  async createInspectionStandard(dto: CreateInspectionStandardDto): Promise<InspectionStandardDetail> {
    const items = dto.items.map((item) => ({
      inspectionItemCode: item.inspectionItemCode.trim(),
      inspectionItemName: item.inspectionItemName.trim(),
      unit: item.unit?.trim() || null,
      minValue: toDecimal(item.minValue),
      maxValue: toDecimal(item.maxValue),
      thicknessOverMm: toDecimal(item.thicknessOverMm),
      thicknessUptoMm: toDecimal(item.thicknessUptoMm),
      isRequired: item.isRequired ?? true,
    }));
    const problem = findStandardItemProblem(items);
    if (problem) throw new AppException('COM-004', problem);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const steelGrade = await this.repository.findSteelGrade(tx, dto.steelGradeId);
        if (!steelGrade) throw new AppException('COM-003', '강종을 찾을 수 없어요');
        const existing = await this.repository.findStandardByProcessAndSteelGrade(tx, dto.processType, steelGrade.id);
        if (existing) throw duplicateStandard(existing.inspectionStandardCode);

        return this.repository.createStandardWithItems(
          tx,
          {
            inspectionStandardCode: inspectionStandardCodeOf(steelGrade.steelGradeCode, dto.processType),
            versionNo: 1,
            processType: dto.processType,
            steelGradeId: steelGrade.id,
          },
          items,
        );
      });
      return this.getInspectionStandard(created.id);
    } catch (error) {
      // 같은 공정·강종을 동시에 등록하면 (코드, 버전) unique가 막는다
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateStandard();
      throw error;
    }
  }
}

const toDecimal = (value: string | null | undefined) => (value === null || value === undefined ? null : new Prisma.Decimal(value));

/** 중복 등록 (2026-10-04 결정: [04] 9.3에 코드가 없어 입력 에러로 돌려준다) */
const duplicateStandard = (code?: string) =>
  new AppException('COM-004', `이미 있는 검사 기준이에요${code ? ` (${code})` : ''}. 새 버전으로 고쳐 주세요`);
