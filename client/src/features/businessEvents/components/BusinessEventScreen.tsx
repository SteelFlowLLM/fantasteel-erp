'use client';

// 작업 로그 (REQ-LOG-001~003, BP-LOG-01). 조회 전용 — 작업 로그는 기록만 하고 고치거나 지우지 않는다.
// 주소: /business-events?salesOrderId=&lotId=&eventType=&actorType=&targetType=&from=&to=
//  - 수주(salesOrderId)나 LOT(lotId)을 고르면 이력 재현(오래된 순), 아니면 전체 작업 로그(최신순).
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  ACTOR_TYPE,
  ACTOR_TYPE_LABEL,
  BUSINESS_EVENT_AREA,
  BUSINESS_EVENT_AREAS,
  BUSINESS_EVENT_TYPE,
  BUSINESS_EVENT_TYPE_LABEL,
  type ActorType,
  type BusinessEventType,
} from '@/codes';
import { ApiError } from '@/api/client';
import type { BusinessEventFilter } from '@/api/businessEvents';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DateInput } from '@/components/DateInput';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Input';
import { PageHead, PageMain } from '@/components/Page';
import { StateView } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { EventLegend, EventTimeline } from '@/features/businessEvents/components/EventTimeline';
import { LotPicker, SalesOrderPicker } from '@/features/businessEvents/components/SubjectPickers';
import { TARGET_FILTER_TABLES, isTargetFilterTable, lotTraceHref, targetTableLabel } from '@/features/businessEvents/lib/eventTargets';
import { SCREEN, canOpenScreen } from '@/features/shell/screens';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { useBusinessEventSubject } from '@/hooks/useBusinessEvents';
import { useMe } from '@/hooks/useMe';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPES = Object.values(BUSINESS_EVENT_TYPE);
const asId = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : undefined);
const isEventType = (value: string | null): value is BusinessEventType => value !== null && (EVENT_TYPES as string[]).includes(value);
const isActorType = (value: string | null): value is ActorType => value === ACTOR_TYPE.USER || value === ACTOR_TYPE.SYSTEM;

function useFilterFromParams(): BusinessEventFilter {
  const params = useSearchParams();
  return useMemo(() => {
    const filter: BusinessEventFilter = {};
    const salesOrderId = asId(params.get('salesOrderId'));
    const lotId = asId(params.get('lotId'));
    const eventType = params.get('eventType');
    const actorType = params.get('actorType');
    const targetType = params.get('targetType') ?? '';
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (salesOrderId !== undefined) filter.salesOrderId = salesOrderId;
    if (lotId !== undefined) filter.lotId = lotId;
    if (isEventType(eventType)) filter.businessEventType = eventType;
    if (isActorType(actorType)) filter.actorType = actorType;
    if (isTargetFilterTable(targetType)) filter.targetType = targetType;
    if (DATE_ONLY.test(from)) filter.from = from;
    if (DATE_ONLY.test(to)) filter.to = to;
    return filter;
  }, [params]);
}

export function BusinessEventScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const filter = useFilterFromParams();
  const subject = useBusinessEventSubject(filter);
  const isReplay = filter.salesOrderId !== undefined || filter.lotId !== undefined;

  const patch = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const salesOrderNo = subject.salesOrder?.salesOrderNo ?? null;
  const lotNo = subject.lot?.lotNo ?? null;
  const subjectTitle = [salesOrderNo, lotNo].filter(Boolean).join(' · ');
  useShellTitle('작업 로그', isReplay ? `이력 재현${subjectTitle ? ` · ${subjectTitle}` : ''}` : undefined);

  const notFound = subject.error instanceof ApiError && subject.error.code === 'COM-003';
  const anyFilter = params.toString().length > 0;
  const canOpenSalesOrder = canOpenScreen(me, SCREEN.salesOrders.access);
  const replayKind = filter.salesOrderId !== undefined ? '수주' : 'LOT';

  return (
    <PageMain className="gap-3">
      <PageHead
        crumb={
          <>
            <Link href="/dashboard" className="text-ink-3 hover:underline">
              대시보드
            </Link>
            <Icon name="chevron-right" size="sm" />
            작업 로그
            <Icon name="chevron-right" size="sm" />
            {isReplay ? `이력 재현 (${replayKind})` : '전체'}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className={isReplay ? 'font-mono' : undefined}>{isReplay ? subjectTitle || '…' : '전체 작업 로그'}</span>
            {isReplay ? <Tag tone="brand">이력 재현 · 시간순</Tag> : null}
            {subject.salesOrder ? <span className="text-xs font-normal text-ink-3">{subject.salesOrder.customerName}</span> : null}
          </span>
        }
        actions={
          <>
            {filter.salesOrderId !== undefined && canOpenSalesOrder ? (
              <ButtonLink icon="clipboard" href={`/sales-orders/${filter.salesOrderId}`}>
                수주 상세
              </ButtonLink>
            ) : null}
            {lotNo ? (
              <ButtonLink icon="trace" href={lotTraceHref(lotNo)}>
                LOT 추적
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <span className="-mt-2 text-cap text-ink-3">작업 로그는 기록만 남고 고치거나 지울 수 없어요</span>

      <div className="flex flex-none flex-wrap items-center gap-2">
        <SalesOrderPicker
          salesOrderId={filter.salesOrderId}
          salesOrderNo={salesOrderNo}
          onPick={(id) => patch({ salesOrderId: String(id) })}
          onClear={() => patch({ salesOrderId: null })}
        />
        <LotPicker lotId={filter.lotId} lotNo={lotNo} onPick={(id) => patch({ lotId: String(id) })} onClear={() => patch({ lotId: null })} />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <span className="text-xs font-medium text-ink-2">주체</span>
        <Chip on={!filter.actorType} onClick={() => patch({ actorType: null })}>
          전체
        </Chip>
        {[ACTOR_TYPE.USER, ACTOR_TYPE.SYSTEM].map((actor) => (
          <Chip key={actor} on={filter.actorType === actor} onClick={() => patch({ actorType: actor })}>
            {ACTOR_TYPE_LABEL[actor]}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" icon="refresh" className="ml-auto" disabled={!anyFilter} onClick={() => router.replace(pathname)}>
          조건 초기화
        </Button>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2">
        <Select className="w-[200px]" aria-label="작업 로그 유형" value={filter.businessEventType ?? ''} onChange={(e) => patch({ eventType: e.target.value || null })}>
          <option value="">유형: 전체</option>
          {BUSINESS_EVENT_AREAS.map((area) => (
            <optgroup key={area} label={area}>
              {EVENT_TYPES.filter((type) => BUSINESS_EVENT_AREA[type] === area).map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_EVENT_TYPE_LABEL[type]}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select className="w-[170px]" aria-label="대상" value={filter.targetType ?? ''} onChange={(e) => patch({ targetType: e.target.value || null })}>
          <option value="">대상: 전체</option>
          {TARGET_FILTER_TABLES.map((table) => (
            <option key={table} value={table}>
              {targetTableLabel(table)}
            </option>
          ))}
        </Select>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <span className="text-xs font-medium text-ink-2">기간</span>
        <DateInput value={filter.from ?? ''} onChange={(value) => patch({ from: value })} ariaLabel="시작일" placeholder="시작일" className="w-[140px]" />
        <span className="text-ink-3">~</span>
        <DateInput value={filter.to ?? ''} onChange={(value) => patch({ to: value })} ariaLabel="종료일" placeholder="종료일" min={filter.from} className="w-[140px]" />
      </div>

      <Card className="min-h-[320px] flex-1">
        <CardHead
          title={isReplay ? '이력 재현' : '최근 작업 로그'}
          meta={isReplay ? '처리와 판단을 일어난 순서대로 다시 봐요 (같은 시각은 작업 로그 순)' : '최신순이에요. 수주나 LOT을 고르면 이력 재현이 돼요'}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-2.5">
          {notFound ? (
            <StateView
              kind="error"
              title={filter.salesOrderId !== undefined ? '이 수주를 찾지 못했어요' : '이 LOT을 찾지 못했어요'}
              text={subject.error instanceof ApiError ? [subject.error.message, subject.error.detail].filter(Boolean).join(' · ') : undefined}
              code="COM-003"
              actions={
                <Button size="sm" onClick={() => patch({ salesOrderId: null, lotId: null })}>
                  수주·LOT 조건 지우기
                </Button>
              }
            />
          ) : (
            <EventTimeline key={JSON.stringify(filter)} filter={filter} />
          )}
        </div>
        <CardFoot>
          <EventLegend />
        </CardFoot>
      </Card>
    </PageMain>
  );
}
