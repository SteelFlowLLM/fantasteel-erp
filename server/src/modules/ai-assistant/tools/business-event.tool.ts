import { BUSINESS_EVENT_SORT, type BusinessEventView } from '@fantasteel/shared';
import type { BusinessEventService } from '../../business-event/business-event.service';
import type { LotService } from '../../lot/lot.service';
import type { SalesOrderService } from '../../sales-order/sales-order.service';
import { optionalDate, optionalString, seoulDateTimeText, TOOL_ROW_LIMIT, ToolArgumentError, type AssistantTool } from './assistant-tool';

/** 작업 로그 (GET /business-events, 로그인한 전 역할). 최신순 */
export function businessEventTool(events: BusinessEventService, salesOrders: SalesOrderService, lots: LotService): AssistantTool {
  return {
    permission: null,
    definition: {
      name: 'get_business_events',
      description:
        '작업 로그(누가 언제 어떤 업무를 했는지)를 최신순으로 조회한다. 수주번호·LOT 번호로 그 대상의 이력을, 날짜로 기간을 거른다. "누가 확정했어", "최근 무슨 일이 있었어"를 물으면 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          salesOrderNo: { type: 'string', description: '수주번호 (정확히)' },
          lotNo: { type: 'string', description: 'LOT 번호 (정확히)' },
          from: { type: 'string', description: '시작일 YYYY-MM-DD' },
          to: { type: 'string', description: '종료일 YYYY-MM-DD (포함)' },
        },
      },
    },
    async run(args) {
      const salesOrderNo = optionalString(args, 'salesOrderNo', 30);
      const lotNo = optionalString(args, 'lotNo');
      const from = optionalDate(args, 'from');
      const to = optionalDate(args, 'to');
      if (from && to && from > to) throw new ToolArgumentError('시작일이 종료일보다 늦어요');

      const salesOrderId = salesOrderNo ? await salesOrderIdOf(salesOrders, salesOrderNo) : undefined;
      const lotId = lotNo ? await lotIdOf(lots, lotNo) : undefined;
      const page = await events.list({ salesOrderId, lotId, from, to, sort: BUSINESS_EVENT_SORT.DESC, page: 1, size: TOOL_ROW_LIMIT });

      const scope = [salesOrderNo, lotNo, from || to ? `${from ?? ''}~${to ?? ''}` : null].filter(Boolean).join(' · ');
      return {
        label: `작업 로그${scope ? ` · ${scope}` : ''}`,
        data: { '전체 건수': page.total, '최신순 작업 로그': page.items.map(eventRow), '생략 건수': Math.max(0, page.total - page.items.length) },
      };
    },
  };
}

async function salesOrderIdOf(salesOrders: SalesOrderService, salesOrderNo: string): Promise<number> {
  const page = await salesOrders.list({ salesOrderNo, page: 1, size: 5 });
  const exact = page.items.find((s) => s.salesOrderNo.toLowerCase() === salesOrderNo.toLowerCase());
  if (!exact) throw new ToolArgumentError(`수주번호 ${salesOrderNo}가 없어요`);
  return exact.id;
}

async function lotIdOf(lots: LotService, lotNo: string): Promise<number> {
  const page = await lots.list({ lotNo, page: 1, size: 5 });
  const exact = page.items.find((l) => l.lotNo.toLowerCase() === lotNo.toLowerCase());
  if (!exact) throw new ToolArgumentError(`LOT 번호 ${lotNo}가 없어요`);
  return exact.id;
}

function eventRow(e: BusinessEventView) {
  return {
    '작업 로그 번호': e.businessEventNo,
    시각: seoulDateTimeText(e.occurredAt),
    유형: e.businessEventTypeLabel,
    주체: e.actorEmployeeName ?? '시스템',
    수주번호: e.salesOrderNo,
    LOT: e.lots.map((l) => l.lotNo),
    사유: e.reason,
    'AI 경유': e.isAiAssisted,
  };
}
