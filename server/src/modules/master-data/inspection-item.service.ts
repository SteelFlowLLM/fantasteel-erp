import { Injectable } from '@nestjs/common';
import { PROCESS_CODE_LABEL, type AuthUser, type ProcessCode } from '@fantasteel/shared';
import { Prisma } from '../../generated/prisma/client';
import { badInput, notFound } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInspectionItemDto } from './dto/create-inspection-item.dto';
import { ListInspectionItemsDto } from './dto/list-inspection-items.dto';
import { UpdateInspectionItemDto } from './dto/update-inspection-item.dto';
import { InspectionItemRepository, type InspectionItemRow } from './inspection-item.repository';
import { validateInspectionRange } from './inspection-item.rules';
import { MasterChangeRecorder } from './master-change.recorder';
import { D, duplicate } from './master-data.util';

export const toInspectionItemView = (i: InspectionItemRow) => ({
  id: i.id,
  processCode: i.processCode,
  processName: PROCESS_CODE_LABEL[i.processCode as ProcessCode] ?? i.processCode,
  steelGradeId: i.steelGradeId,
  steelGradeCode: i.steelGrade?.steelGradeCode ?? null,
  inspectionItemCode: i.inspectionItemCode,
  inspectionItemName: i.inspectionItemName,
  unit: i.unit,
  minValue: i.minValue,
  maxValue: i.maxValue,
  isRequired: i.isRequired,
  sortOrder: i.sortOrder,
  updatedAt: i.updatedAt,
});

const label = (i: { processCode: string; inspectionItemCode: string; steelGrade?: { steelGradeCode: string } | null }) =>
  `${PROCESS_CODE_LABEL[i.processCode as ProcessCode] ?? i.processCode} ${i.steelGrade?.steelGradeCode ?? '공통'} ${i.inspectionItemCode}`;

@Injectable()
export class InspectionItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InspectionItemRepository,
    private readonly changes: MasterChangeRecorder,
  ) {}

  async list(q: ListInspectionItemsDto) {
    const where: Prisma.InspectionItemWhereInput = {
      ...(q.processCode ? { processCode: q.processCode } : {}),
      ...(q.steelGradeId ? { OR: [{ steelGradeId: q.steelGradeId }, { steelGradeId: null }] } : {}),
    };
    return (await this.repo.findMany(this.prisma, where)).map(toInspectionItemView);
  }

  async get(id: number) {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('검사 항목');
    return toInspectionItemView(row);
  }

  async create(dto: CreateInspectionItemDto, user: AuthUser) {
    validateInspectionRange(dto.minValue, dto.maxValue);
    return this.prisma.tx(async (tx) => {
      const steelGradeId = dto.steelGradeId ?? null;
      if (steelGradeId !== null) {
        const g = await tx.steelGrade.findUnique({ where: { id: steelGradeId } });
        if (!g) throw notFound('강종');
        if (!g.isActive) throw badInput(`사용 중지된 강종입니다 (${g.steelGradeCode})`);
      }
      if (await this.repo.findByKey(tx, dto.processCode, steelGradeId, dto.inspectionItemCode)) {
        throw duplicate('같은 공정·강종에 이미 등록된 검사 항목 코드입니다');
      }
      const row = await this.repo.create(tx, {
        processCode: dto.processCode,
        steelGradeId,
        inspectionItemCode: dto.inspectionItemCode,
        inspectionItemName: dto.inspectionItemName,
        unit: dto.unit ?? null,
        minValue: dto.minValue === undefined || dto.minValue === null ? null : D(dto.minValue),
        maxValue: dto.maxValue === undefined || dto.maxValue === null ? null : D(dto.maxValue),
        isRequired: dto.isRequired ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
      await this.changes.record(tx, user, { targetNo: `${row.processCode}-${row.steelGrade?.steelGradeCode ?? 'ALL'}-${row.inspectionItemCode}`, targetId: row.id, summary: `검사 항목 ${label(row)} 등록`, after: toInspectionItemView(row) });
      return toInspectionItemView(row);
    });
  }

  async update(id: number, dto: UpdateInspectionItemDto, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('검사 항목');
      const minValue = dto.minValue !== undefined ? dto.minValue : before.minValue?.toNumber() ?? null;
      const maxValue = dto.maxValue !== undefined ? dto.maxValue : before.maxValue?.toNumber() ?? null;
      validateInspectionRange(minValue, maxValue);
      const row = await this.repo.update(tx, id, {
        ...(dto.inspectionItemName !== undefined ? { inspectionItemName: dto.inspectionItemName } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.minValue !== undefined ? { minValue: dto.minValue === null ? null : D(dto.minValue) } : {}),
        ...(dto.maxValue !== undefined ? { maxValue: dto.maxValue === null ? null : D(dto.maxValue) } : {}),
        ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      });
      await this.changes.record(tx, user, {
        targetNo: `${row.processCode}-${row.steelGrade?.steelGradeCode ?? 'ALL'}-${row.inspectionItemCode}`, targetId: row.id, summary: `검사 항목 ${label(row)} 수정`,
        before: toInspectionItemView(before), after: toInspectionItemView(row),
      });
      return toInspectionItemView(row);
    });
  }

  /** 검사 결과는 판정 시점의 기준을 값에 복사해 두므로 항목을 지워도 과거 결과는 바뀌지 않는다. */
  async remove(id: number, user: AuthUser) {
    return this.prisma.tx(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw notFound('검사 항목');
      await this.repo.delete(tx, id);
      await this.changes.record(tx, user, {
        targetNo: `${before.processCode}-${before.steelGrade?.steelGradeCode ?? 'ALL'}-${before.inspectionItemCode}`, targetId: id, summary: `검사 항목 ${label(before)} 삭제`, before: toInspectionItemView(before),
      });
      return { id, deleted: true };
    });
  }
}
