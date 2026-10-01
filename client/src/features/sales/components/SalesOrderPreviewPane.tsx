'use client';

// 수주 목록 오른쪽 미리보기 (보고서 1 A-1 ⑤): 머리·버튼, 품목별 충족, 생산 연결, 최근 작업 로그.
import Link from 'next/link';
import { ButtonLink } from '@/components/Button';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { useSalesOrderDetail, useSalesOrderTimeline } from '@/hooks/useSalesOrders';
import { fmtDate, fmtMDHM } from '@/lib/format';
import { qtyUnitOf } from '@/features/sales/lib/salesOrderForm';
import { FulfillmentMeasures, ShipmentRequestButton, WorkRoomButton } from '@/features/sales/components/SalesOrderActions';
import {
  businessEventsHref,
  DueRiskBadge,
  DueText,
  EventLine,
  ItemLabel,
  PlanLink,
  PlanStatusBadge,
  SalesOrderStatusBadge,
  SectionTitle,
} from '@/features/sales/components/SalesOrderParts';

const RECENT_EVENT_COUNT = 8;

export function SalesOrderPreviewPane({ salesOrderId }: { salesOrderId: number | null }) {
  const detail = useSalesOrderDetail(salesOrderId);
  const timeline = useSalesOrderTimeline(salesOrderId);

  return (
    <aside aria-label="선택한 수주 미리보기" className="flex w-[400px] flex-none flex-col overflow-auto border-l border-line bg-surface">
      {salesOrderId === null ? (
        <EmptyNote className="py-10">미리 볼 수주가 없어요</EmptyNote>
      ) : (
        <QueryBoundary query={detail} loadingLabel="수주를 불러오는 중…">
          {(so) => {
            const plans = so.items.flatMap((item) => item.plans.map((plan) => ({ ...plan, lineNo: item.lineNo })));
            const recent = [...(timeline.data ?? [])].reverse().slice(0, RECENT_EVENT_COUNT);
            const done = so.status === 'SHIPPED' || so.status === 'CANCELLED';
            return (
              <div className="flex flex-col">
                <header className="flex flex-col gap-1.5 border-b border-line px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Link href={`/sales-orders/${so.id}`} className="font-mono text-base font-semibold hover:underline">
                      {so.salesOrderNo}
                    </Link>
                    <SalesOrderStatusBadge status={so.status} />
                    {so.isDueRisk ? <DueRiskBadge /> : null}
                  </div>
                  <span className="text-sm font-medium">{so.customerName}</span>
                  <span className="text-cap text-ink-3">
                    등록 {fmtMDHM(so.createdAt)} · 담당 {so.ownerName ?? '-'} · 납기 <DueText dueDate={so.earliestDueDate} risk={so.isDueRisk} done={done} />
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <WorkRoomButton salesOrderId={so.id} salesOrderNo={so.salesOrderNo} hasRoom={so.workRoomId !== null} />
                    <ShipmentRequestButton summary={so} />
                    <ButtonLink size="sm" variant="primary" href={`/sales-orders/${so.id}`}>
                      상세 보기
                    </ButtonLink>
                  </div>
                </header>

                <section className="flex flex-col gap-3 border-b border-line px-4 py-3.5">
                  <SectionTitle meta="분모를 지표마다 따로 보여요">품목별 충족</SectionTitle>
                  {so.items.map((item) => (
                    <div key={item.salesOrderItemId} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <ItemLabel lineNo={item.lineNo} itemType={item.itemType} itemName={item.itemName} />
                        <span className="ml-auto text-cap text-ink-3 tabular-nums">납기 {fmtDate(item.dueDate)}</span>
                      </div>
                      <FulfillmentMeasures item={item} compact />
                      {item.shortage.reproductionNeedQty > 0 ? (
                        <span className="text-cap font-semibold text-danger">
                          재생산 필요 {item.shortage.reproductionNeedQty}
                          {qtyUnitOf([item.itemType])} · 상세에서 만들 수 있어요
                        </span>
                      ) : null}
                    </div>
                  ))}
                </section>

                <section className="flex flex-col gap-2 border-b border-line px-4 py-3.5">
                  <SectionTitle meta={`${plans.length}건`}>생산 연결</SectionTitle>
                  {plans.length === 0 ? (
                    <EmptyNote className="py-2">연결된 생산계획이 없어요 · 재고로 모두 예약됐거나 부족 매수가 없어요</EmptyNote>
                  ) : (
                    plans.map((plan) => (
                      <div key={plan.productionPlanId} className="flex items-center gap-2 text-xs">
                        <PlanLink productionPlanId={plan.productionPlanId} productionPlanNo={plan.productionPlanNo} />
                        <span className="text-ink-2">
                          품목 {plan.lineNo} · 부족 {plan.shortageQty} · 잔여 목표 {plan.remainingTargetQty} · 히트 {plan.heatCount}
                        </span>
                        {plan.isReproduction ? <Tag tone="outline">재생산</Tag> : null}
                        <span className="ml-auto">
                          <PlanStatusBadge status={plan.productionPlanStatus} />
                        </span>
                      </div>
                    ))
                  )}
                </section>

                <section className="flex flex-col gap-2 px-4 py-3.5">
                  <div className="flex items-center">
                    <SectionTitle meta="최근순">최근 작업 로그</SectionTitle>
                    <ButtonLink size="sm" variant="ghost" className="ml-auto" href={businessEventsHref(so.id)}>
                      전체 보기
                    </ButtonLink>
                  </div>
                  {timeline.error ? <EmptyNote className="py-2">작업 로그를 불러오지 못했어요</EmptyNote> : null}
                  {timeline.isPending ? <EmptyNote className="py-2">불러오는 중…</EmptyNote> : null}
                  {timeline.data && recent.length === 0 ? <EmptyNote className="py-2">기록된 작업이 없어요</EmptyNote> : null}
                  {recent.map((event) => (
                    <EventLine key={event.id} event={event} />
                  ))}
                </section>
              </div>
            );
          }}
        </QueryBoundary>
      )}
    </aside>
  );
}
