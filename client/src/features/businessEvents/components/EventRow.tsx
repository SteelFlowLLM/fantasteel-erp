'use client';

// 작업 로그 한 줄: 접으면 시각·주체·유형·대상·사유·EV- 번호, 펼치면 당시 기록·사유와 근거·변경 전 → 변경 후·관련 LOT (BP-LOG-01).
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ACTOR_TYPE_LABEL, LOT_TYPE_LABEL } from '@/codes';
import type { BusinessEventView } from '@/api/businessEvents';
import { Button } from '@/components/Button';
import { ComingSoon } from '@/components/ComingSoon';
import { Icon } from '@/components/Icon';
import { Tag } from '@/components/Tag';
import { diffRows } from '@/features/businessEvents/lib/eventDiff';
import { lotTraceHref } from '@/features/businessEvents/lib/eventTargets';
import { EVENT_TONE_DOT, eventTone } from '@/features/businessEvents/lib/eventTone';
import { LinkId, MonoId } from '@/features/lotTrace/components/TraceBits';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtHM } from '@/lib/format';

const MAX_LOT_LINKS = 12;

export function ActorChip({ event }: { event: BusinessEventView }) {
  if (event.actorType === 'SYSTEM' || !event.actor) {
    return <span className="inline-flex h-5 flex-none items-center rounded-xs bg-surface-3 px-1.5 text-[11.5px] font-semibold text-ink-2">{ACTOR_TYPE_LABEL.SYSTEM}</span>;
  }
  const a = event.actor;
  return (
    <span
      className="inline-flex h-5 flex-none items-center gap-1 rounded-xs bg-run-bg px-1.5 text-[11.5px] font-semibold text-run"
      title={`${a.employeeName} · ${a.departmentName} ${a.jobGradeName} (${a.employeeNo})`}
    >
      {a.employeeName}
      <span className="font-normal opacity-80">{a.departmentName}</span>
    </span>
  );
}

function TargetLink({ event }: { event: BusinessEventView }) {
  if (!event.targetNo) return <span className="text-ink-3">{event.targetTypeLabel}</span>;
  return event.targetHref ? <LinkId href={event.targetHref}>{event.targetNo}</LinkId> : <MonoId>{event.targetNo}</MonoId>;
}

function DiffTable({ event }: { event: BusinessEventView }) {
  const rows = diffRows(event.beforeData, event.afterData);
  if (!rows.length) return <span className="text-xs text-ink-3">기록된 변경값이 없어요</span>;
  return (
    <table className="w-full border-collapse text-xs tabular-nums">
      <thead>
        <tr className="text-left text-[11px] text-ink-3">
          <th className="pr-1.5 pb-1 font-medium">항목</th>
          <th className="pr-1.5 pb-1 font-medium">변경 전</th>
          <th aria-hidden="true" />
          <th className="pr-1.5 pb-1 font-medium">변경 후</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={cn('align-top', row.changed && '[&>td]:bg-[#fffbea]')}>
            <td className="py-[3px] pr-1.5 font-mono text-[11.5px] whitespace-nowrap text-ink-3">{row.key}</td>
            <td className={cn('py-[3px] pr-1.5 [overflow-wrap:anywhere]', row.before === undefined && 'text-ink-3')}>{row.before ?? '-'}</td>
            <td className="py-[3px] pr-1.5 text-ink-3">
              <Icon name="arrow-right" size="sm" />
            </td>
            <td className={cn('py-[3px] pr-1.5 [overflow-wrap:anywhere]', row.after === undefined && 'text-ink-3')}>
              {row.changed ? <b className="font-semibold">{row.after ?? '-'}</b> : row.after}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kv({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-3">{label}</dt>
          <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EventRow({ event, open, onToggle, showSalesOrder = true }: { event: BusinessEventView; open: boolean; onToggle: () => void; showSalesOrder?: boolean }) {
  const [allLots, setAllLots] = useState(false);
  const lots = allLots ? event.lots : event.lots.slice(0, MAX_LOT_LINKS);
  const tone = eventTone(event);
  const detailId = `event-detail-${event.id}`;
  return (
    <li className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 pb-1.5 before:absolute before:top-3.5 before:bottom-0 before:left-2 before:w-0.5 before:bg-line before:content-[''] last:before:hidden">
      <span className={cn('relative z-[1] mt-[5px] size-[18px] rounded-full border-2', open && 'mt-[9px]', EVENT_TONE_DOT[tone])} />
      <div className={cn('min-w-0', open && 'overflow-hidden rounded-md border border-[#b9cbdd] bg-surface')}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a,button')) onToggle();
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              onToggle();
            }
          }}
          className={cn(
            'flex min-h-7 min-w-0 cursor-pointer items-center gap-2 rounded-xs text-sm hover:bg-surface-2',
            open && 'min-h-9 rounded-none bg-brand-tint px-2 hover:bg-brand-tint',
          )}
        >
          <time className="w-[38px] flex-none text-xs text-ink-3 tabular-nums" dateTime={event.occurredAt}>
            {fmtHM(event.occurredAt)}
          </time>
          <ActorChip event={event} />
          <b className="flex-none font-semibold">{event.businessEventTypeLabel}</b>
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="text-xs text-ink-3">{event.targetTypeLabel}</span>
            <TargetLink event={event} />
          </span>
          {event.reasonCode ? (
            <Tag className="flex-none font-mono" title="사유 코드">
              {event.reasonCode}
            </Tag>
          ) : null}
          <span className="ml-auto flex-none font-mono text-cap text-ink-3">{event.eventNo}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" className="flex-none text-ink-3" />
        </div>
        {open ? (
          <div id={detailId}>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] border-t border-[#d5e0ea] max-[1100px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-1.5 border-r border-line px-3 py-2.5 max-[1100px]:border-r-0 max-[1100px]:border-b">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2">
                  <Icon name="history" size="sm" className="text-brand" /> 당시 기록
                </span>
                <Kv
                  items={[
                    ['작업 로그 번호', <MonoId key="no">{event.eventNo}</MonoId>],
                    [
                      '주체',
                      event.actor ? (
                        <span key="actor">
                          {event.actor.employeeName}
                          <span className="font-normal text-ink-3">
                            {' '}
                            · {event.actor.departmentName} {event.actor.jobGradeName}
                          </span>
                        </span>
                      ) : (
                        ACTOR_TYPE_LABEL[event.actorType]
                      ),
                    ],
                    ['일시', <span key="at" className="tabular-nums">{fmtDateTime(event.occurredAt)}</span>],
                    ['유형', event.businessEventTypeLabel],
                    [
                      '대상',
                      <span key="target" className="inline-flex flex-wrap items-center gap-1.5">
                        {event.targetTypeLabel}
                        <span className="font-mono text-cap font-normal text-ink-3">{event.targetType}</span>
                        <TargetLink event={event} />
                      </span>,
                    ],
                    ...(showSalesOrder && event.salesOrderId && event.salesOrderNo
                      ? ([['수주', <LinkId key="so" href={`/sales-orders/${event.salesOrderId}`}>{event.salesOrderNo}</LinkId>]] as const)
                      : []),
                    ['AI 경유', <ComingSoon key="ai" grade="P2" />],
                  ]}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 border-r border-line px-3 py-2.5 max-[1100px]:border-r-0 max-[1100px]:border-b">
                <span className="text-xs font-semibold text-ink-2">사유·근거</span>
                {event.reasonCode || event.reasonText || event.messageId || event.actionDraftId ? (
                  <Kv
                    items={[
                      ...(event.reasonCode ? ([['사유 코드', <MonoId key="code">{event.reasonCode}</MonoId>]] as const) : []),
                      ...(event.reasonText ? ([['사유', <span key="reason" className="font-normal">{event.reasonText}</span>]] as const) : []),
                      ...(event.messageId
                        ? ([
                            [
                              '원본 메시지',
                              event.messageHref ? (
                                <Link key="msg" href={event.messageHref} className="text-run hover:underline">
                                  메시지 보기
                                </Link>
                              ) : (
                                <span key="msg" className="text-ink-3">
                                  찾을 수 없어요
                                </span>
                              ),
                            ],
                          ] as const)
                        : []),
                      ...(event.actionDraftId
                        ? ([['Action Draft', <LinkId key="draft" href={`/action-drafts/${event.actionDraftId}`}>{`초안 ${event.actionDraftId}`}</LinkId>]] as const)
                        : []),
                    ]}
                  />
                ) : (
                  <span className="text-xs text-ink-3">기록된 사유가 없어요</span>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
                <span className="text-xs font-semibold text-ink-2">변경 전 → 변경 후</span>
                <DiffTable event={event} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="text-cap text-ink-3">관련 LOT</span>
              {lots.map((lot) => (
                <LinkId key={lot.id} href={lotTraceHref(lot.lotNo)} title={LOT_TYPE_LABEL[lot.lotType]}>
                  {lot.lotNo}
                </LinkId>
              ))}
              {!event.lots.length ? <span className="text-cap text-ink-3">없음</span> : null}
              {event.lots.length > MAX_LOT_LINKS ? (
                <Button size="sm" variant="ghost" onClick={() => setAllLots(!allLots)}>
                  {allLots ? '접기' : `외 ${event.lots.length - MAX_LOT_LINKS}개 더 보기`}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
