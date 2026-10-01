// 수주 충족 현황 (REQ-DSH-001, TRM-042, REQ-SO-004): 진행 중 수주 품목의 생산중·검사합격·예약·출하 매수와 진행률.
// 단계는 서로 다른 단계라 더해서 "충족 매수"로 보이지 않는다(4.5). 막대는 출하 | 예약(검사합격 중 미출하) | 생산중을 수주 매수 대비 길이로만 나란히 둔다.
import Link from 'next/link';
import type { FulfillmentItemRow, OrderFulfillmentData } from '@/api/dashboard';
import { Icon } from '@/components/Icon';
import { Table, Td, Th } from '@/components/Table';
import { LegendItem, WidgetBody, WidgetEmpty, WidgetFrame, type WidgetProps } from '@/features/dashboard/components/WidgetFrame';
import { dueLabel } from '@/features/dashboard/lib/widgetMath';
import { useDashboardWidget, useDashboardWidgetAccess } from '@/hooks/useDashboardWidget';
import { fmtMD, fmtPct, fmtTon } from '@/lib/format';
import { cn } from '@/lib/cn';

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%`;

function StageBar({ item }: { item: FulfillmentItemRow }) {
  const whole = Math.max(item.orderedQty, item.shippedQty + item.reservedQty + item.inProductionQty);
  const seg = (qty: number, colorClass: string, label: string) => (qty > 0 ? <span className={colorClass} style={{ width: pct(qty, whole) }} title={`${label} ${qty}`} /> : null);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex h-3 min-w-10 flex-1 overflow-hidden rounded-xs bg-surface-3">
        {seg(item.shippedQty, 'bg-ink-3', '출하')}
        {seg(item.reservedQty, 'bg-chart-1', '예약')}
        {seg(item.inProductionQty, 'bg-run', '생산중')}
      </div>
      <b className="w-9 text-right text-xs font-semibold tabular-nums">{fmtPct(item.shippedRatio)}</b>
    </div>
  );
}

function FulfillmentBody({ data }: { data: OrderFulfillmentData }) {
  if (data.salesOrders.length === 0) return <WidgetEmpty>진행 중인 수주가 없어요</WidgetEmpty>;
  return (
    <>
      <div className="min-h-0 flex-1">
        <Table compact className="min-w-[700px] [&_td]:px-1.5 [&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:px-1.5">
          <thead>
            <tr>
              <Th>수주 번호</Th>
              <Th>고객사</Th>
              <Th>품목</Th>
              <Th align="right">수주</Th>
              <Th align="right" title="진행중 생산계획의 잔여 목표 (분모: 수주 매수)">
                생산중
              </Th>
              <Th align="right" title="ACTIVE 예약 + 출하 (분모: 수주 매수)">
                검사합격
              </Th>
              <Th align="right" title="ACTIVE 예약 (분모: 미출하 매수)">
                예약
              </Th>
              <Th align="right">출하</Th>
              <Th className="w-28" title="출하 ÷ 수주 매수">
                진행률
              </Th>
              <Th>납기</Th>
            </tr>
          </thead>
          <tbody>
            {data.salesOrders.map((so) =>
              so.items.map((item, index) => (
                <tr key={item.salesOrderItemId} data-risk={item.isDueRisk || undefined}>
                  {index === 0 ? (
                    <>
                      <Td rowSpan={so.items.length} className="align-top font-mono text-xs font-medium">
                        <Link href={`/sales-orders/${so.salesOrderId}`} className="text-run hover:underline">
                          {so.salesOrderNo}
                        </Link>
                      </Td>
                      <Td rowSpan={so.items.length} className="max-w-24 truncate align-top" title={so.customerName}>
                        {so.customerName}
                      </Td>
                    </>
                  ) : null}
                  <Td className={cn('max-w-44 truncate font-mono text-xs', index > 0 && 'border-l border-line')} title={item.itemCode}>
                    {item.itemCode}
                  </Td>
                  <Td align="right" title={fmtTon(item.orderedTon)}>
                    {item.orderedQty}
                  </Td>
                  <Td align="right">{item.inProductionQty}</Td>
                  <Td align="right">{item.passedQty}</Td>
                  <Td align="right" title={`미출하 ${item.unshippedQty}`}>
                    {item.reservedQty}
                  </Td>
                  <Td align="right">{item.shippedQty}</Td>
                  <Td>
                    <StageBar item={item} />
                  </Td>
                  <Td className={cn('tabular-nums', item.isDueRisk && 'font-semibold text-danger')} title={item.isDueRisk ? `납기 ${data.deliveryRiskDays}일 이내 · 출하 남음` : undefined}>
                    <span className="inline-flex items-center gap-1">
                      {item.isDueRisk ? <Icon name="alert" size="sm" /> : null}
                      {fmtMD(item.dueDate)} ({dueLabel(item.daysToDue)})
                    </span>
                  </Td>
                </tr>
              )),
            )}
          </tbody>
        </Table>
      </div>
      <footer className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-2 px-4 py-1.5">
        <LegendItem colorClass="bg-ink-3" label="출하" />
        <LegendItem colorClass="bg-chart-1" label="예약" />
        <LegendItem colorClass="bg-run" label="생산중" />
        <span className="ml-auto truncate text-cap text-ink-3" title="검사합격 = 예약 + 출하 · 예약의 분모 = 미출하 매수 · 단계를 더해 충족 매수로 보지 않아요">
          진행률 = 출하 ÷ 수주 매수 · 검사합격 = 예약 + 출하
        </span>
      </footer>
    </>
  );
}

export function OrderFulfillmentWidget(props: WidgetProps) {
  const access = useDashboardWidgetAccess('ORDER_FULFILLMENT');
  const query = useDashboardWidget('ORDER_FULFILLMENT', access.allowed);
  return (
    <WidgetFrame widgetKey="ORDER_FULFILLMENT" {...props} meta={query.data ? `${query.data.salesOrders.length}건 · 납기 빠른 순` : null}>
      <WidgetBody allowed={access.allowed} permissions={access.permissions} query={query}>
        {(data) => <FulfillmentBody data={data} />}
      </WidgetBody>
    </WidgetFrame>
  );
}
