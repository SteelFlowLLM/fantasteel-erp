import { Injectable } from '@nestjs/common';
import {
  BUSINESS_EVENT_TYPE_LABEL,
  type ActorType,
  type BusinessEventLotView,
  type BusinessEventType,
  type BusinessEventView,
  type LotType,
  type PageResult,
} from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessEventRepository, type BusinessEventRow } from './business-event.repository';
import type { ListBusinessEventsQuery } from './dto/list-business-events.query';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 서울 날짜 'YYYY-MM-DD'의 0시. 2월 30일처럼 없는 날짜는 Date가 다음 달로 넘기므로 되돌려 비교해 COM-004로 막는다 */
function seoulStartOf(date: string, label: string): Date {
  const at = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(at.getTime()) || new Date(at.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10) !== date) {
    throw new AppException('COM-004', `${label}이 올바른 날짜가 아니에요`);
  }
  return at;
}

/**
 * 작업 로그 조회·이력 재현 (REQ-LOG-001·003, BP-LOG-01, API-238). 조회만 하고 기록하지 않는다.
 * 정렬: 발생 시각 → 이벤트 id (기본 오래된 순, sort=desc면 최신순).
 */
@Injectable()
export class BusinessEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: BusinessEventRepository,
  ) {}

  async list(query: ListBusinessEventsQuery): Promise<PageResult<BusinessEventView>> {
    const where = this.whereOf(query);
    const [rows, total] = await Promise.all([
      this.repository.findPage(this.prisma, where, query.sort, (query.page - 1) * query.size, query.size),
      this.repository.count(this.prisma, where),
    ]);
    return { items: await this.toViews(rows), page: query.page, size: query.size, total };
  }

  private whereOf(query: ListBusinessEventsQuery): Prisma.BusinessEventWhereInput {
    const from = query.from === undefined ? undefined : seoulStartOf(query.from, '시작일');
    // 끝 날짜를 포함하도록 다음 날 0시 전까지
    const toExclusive = query.to === undefined ? undefined : new Date(seoulStartOf(query.to, '종료일').getTime() + DAY_MS);
    if (from && toExclusive && from >= toExclusive) throw new AppException('COM-004', '시작일이 종료일보다 늦어요');
    return {
      salesOrderId: query.salesOrderId,
      businessEventType: query.businessEventType,
      actorType: query.actorType,
      targetType: query.targetType,
      businessEventLots: query.lotId === undefined ? undefined : { some: { lotId: query.lotId } },
      createdAt: from || toExclusive ? { gte: from, lt: toExclusive } : undefined,
    };
  }

  private async toViews(rows: BusinessEventRow[]): Promise<BusinessEventView[]> {
    if (rows.length === 0) return [];
    const unique = (values: (number | null)[]) => [...new Set(values.filter((v): v is number => v !== null))];
    const [employees, salesOrders, eventLots] = await Promise.all([
      this.repository.findEmployees(this.prisma, unique(rows.map((r) => r.actorEmployeeId))),
      this.repository.findSalesOrders(this.prisma, unique(rows.map((r) => r.salesOrderId))),
      this.repository.findEventLots(this.prisma, rows.map((r) => r.id)),
    ]);
    const lots = new Map((await this.repository.findLots(this.prisma, unique(eventLots.map((l) => l.lotId)))).map((l) => [l.id, l]));
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const salesOrderNoById = new Map(salesOrders.map((s) => [s.id, s.salesOrderNo]));
    const lotsByEvent = new Map<number, BusinessEventLotView[]>();
    for (const link of eventLots) {
      const lot = lots.get(link.lotId);
      if (!lot) continue;
      lotsByEvent.set(link.businessEventId, [...(lotsByEvent.get(link.businessEventId) ?? []), { lotId: lot.id, lotNo: lot.lotNo, lotType: lot.lotType as LotType }]);
    }
    return rows.map((row) => {
      const type = row.businessEventType as BusinessEventType;
      const actor = row.actorEmployeeId === null ? undefined : employeeById.get(row.actorEmployeeId);
      return {
        id: row.id,
        businessEventNo: row.businessEventNo,
        businessEventType: type,
        businessEventTypeLabel: BUSINESS_EVENT_TYPE_LABEL[type] ?? row.businessEventType,
        actorType: row.actorType as ActorType,
        actorEmployeeId: row.actorEmployeeId,
        actorEmployeeNo: actor?.employeeNo ?? null,
        actorEmployeeName: actor?.employeeName ?? null,
        targetType: row.targetType,
        targetId: row.targetId,
        salesOrderId: row.salesOrderId,
        salesOrderNo: row.salesOrderId === null ? null : (salesOrderNoById.get(row.salesOrderId) ?? null),
        beforeData: row.beforeData,
        afterData: row.afterData,
        reason: row.reason,
        isAiAssisted: row.isAiAssisted,
        actionDraftId: row.actionDraftId,
        messageId: row.messageId,
        occurredAt: row.createdAt.toISOString(),
        lots: lotsByEvent.get(row.id) ?? [],
      };
    });
  }
}
