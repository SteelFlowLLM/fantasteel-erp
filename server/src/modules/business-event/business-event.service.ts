import { Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE_LABEL, type ActorType, type BusinessEventType, type EventReasonCode, type EventTargetType, type LotType } from '@fantasteel/shared';
import { badInput, notFound } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LotGraphService } from '../lot/lot-graph.service';
import { escapeLike } from '../lot/like-pattern';
import { BusinessEventRepository, type BusinessEventRow } from './business-event.repository';
import type { ListBusinessEventsDto } from './dto/list-business-events.dto';

const DEFAULT_LIMIT = 50;
const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface BusinessEventView {
  id: number;
  occurredAt: Date;
  actorType: ActorType;
  /** 사용자면 사원 이름, 시스템이면 "시스템" */
  actorLabel: string;
  actor: { employeeId: number; employeeNo: string; employeeName: string; departmentName: string; jobGrade: string } | null;
  eventType: BusinessEventType;
  eventTypeLabel: string;
  targetType: EventTargetType;
  targetId: number | null;
  targetNo: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  lotIds: number[];
  lots: { id: number; lotNo: string; lotType: LotType }[];
  summary: string;
  before: unknown;
  after: unknown;
  reasonCode: EventReasonCode | null;
  reason: string | null;
  isAiAssisted: boolean;
  messageId: number | null;
  actionDraftId: number | null;
  /** lotId + includeLineage 조회에서, 요청한 LOT이 아니라 조상·자손 LOT의 이벤트이면 true */
  isLineageOnly: boolean;
}

@Injectable()
export class BusinessEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BusinessEventRepository,
    private readonly graph: LotGraphService,
  ) {}

  /** REQ-LOG-003 이력 재현: 수주·LOT 단위는 시간순, 그 외는 최근순. */
  async list(dto: ListBusinessEventsDto) {
    const dir = dto.order ?? (dto.salesOrderId || dto.lotId ? 'asc' : 'desc');
    const limit = dto.limit ?? DEFAULT_LIMIT;
    const where: Prisma.BusinessEventWhereInput[] = [];
    if (dto.salesOrderId) where.push({ salesOrderId: dto.salesOrderId });
    if (dto.lotId) {
      const ids = dto.includeLineage ? await this.graph.lineageIds(this.prisma, dto.lotId) : [dto.lotId];
      where.push({ lotIds: { hasSome: ids } });
    }
    if (dto.eventType) where.push({ eventType: dto.eventType });
    if (dto.actorType) where.push({ actorType: dto.actorType });
    if (dto.targetType) where.push({ targetType: dto.targetType });
    const range: Prisma.DateTimeFilter = {};
    if (dto.from) range.gte = parseBoundary(dto.from, 'from');
    if (dto.to) range.lte = parseBoundary(dto.to, 'to');
    if (dto.from || dto.to) where.push({ occurredAt: range });
    const q = dto.q?.trim();
    if (q) where.push({ OR: [{ summary: { contains: escapeLike(q), mode: 'insensitive' } }, { targetNo: { contains: escapeLike(q), mode: 'insensitive' } }] });

    const rows = await this.repo.list(this.prisma, { AND: where }, dir, limit + 1, dto.cursor);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await this.toViews(page, dto.lotId);
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore, order: dir };
  }

  async getById(id: number): Promise<BusinessEventView> {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw notFound('작업 로그');
    return (await this.toViews([row]))[0];
  }

  private async toViews(rows: BusinessEventRow[], requestedLotId?: number): Promise<BusinessEventView[]> {
    const lotIds = [...new Set(rows.flatMap((r) => r.lotIds))];
    const lots = new Map((lotIds.length ? await this.repo.lotsByIds(this.prisma, lotIds) : []).map((l) => [l.id, l]));
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorType: r.actorType as ActorType,
      actorLabel: r.actorEmployee?.employeeName ?? '시스템',
      actor: r.actorEmployee
        ? {
            employeeId: r.actorEmployee.id,
            employeeNo: r.actorEmployee.employeeNo,
            employeeName: r.actorEmployee.employeeName,
            departmentName: r.actorEmployee.department.departmentName,
            jobGrade: r.actorEmployee.jobGrade,
          }
        : null,
      eventType: r.eventType as BusinessEventType,
      eventTypeLabel: BUSINESS_EVENT_TYPE_LABEL[r.eventType as BusinessEventType] ?? r.eventType,
      targetType: r.targetType as EventTargetType,
      targetId: r.targetId,
      targetNo: r.targetNo,
      salesOrderId: r.salesOrderId,
      salesOrderNo: r.salesOrder?.salesOrderNo ?? null,
      lotIds: r.lotIds,
      lots: r.lotIds.flatMap((id) => {
        const l = lots.get(id);
        return l ? [{ id: l.id, lotNo: l.lotNo, lotType: l.lotType as LotType }] : [];
      }),
      summary: r.summary,
      before: r.beforeData,
      after: r.afterData,
      reasonCode: r.reasonCode as EventReasonCode | null,
      reason: r.reason,
      isAiAssisted: r.isAiAssisted,
      messageId: r.messageId,
      actionDraftId: r.actionDraftId,
      isLineageOnly: requestedLotId ? !r.lotIds.includes(requestedLotId) : false,
    }));
  }
}

/** 날짜만 준 값은 한국 시간(+09:00) 하루 경계로 해석한다. to는 그날 끝까지 포함. */
export function parseBoundary(value: string, kind: 'from' | 'to'): Date {
  const ms = DATE_ONLY.test(value) ? Date.parse(`${value}T00:00:00+09:00`) + (kind === 'to' ? DAY_MS - 1 : 0) : Date.parse(value);
  if (Number.isNaN(ms)) throw badInput('날짜 형식이 올바르지 않습니다');
  return new Date(ms);
}
