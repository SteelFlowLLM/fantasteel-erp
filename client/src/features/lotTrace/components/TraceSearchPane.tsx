'use client';

// LOT 추적 왼쪽 칸: 방향 고르기, LOT 번호·출하요청 번호 검색(BP-LOT-01 입력), 종류 칩과 최근 LOT.
import { useState, type ReactNode } from 'react';
import { LOT_TYPE, LOT_TYPE_LABEL, type LotType } from '@/codes';
import type { LotListItem, ShipmentRequestHit } from '@/api/lotTrace';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { MasterPane } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, Spinner } from '@/components/StateView';
import { InspectionBadge, LotStatusBadge, LotTypeIcon, ShipmentStatusBadge } from '@/features/lotTrace/components/TraceBits';
import { TRACE_DIRECTION_LABEL, type TraceDirection } from '@/features/lotTrace/lib/traceGraph';
import { useDebouncedValue } from '@/hooks/useGlobalSearch';
import { useLotSearch, useShipmentRequestSearch } from '@/hooks/useLotTrace';
import { cn } from '@/lib/cn';
import { fmtDate, fmtInt } from '@/lib/format';

const TYPE_FILTERS: readonly (LotType | '')[] = ['', LOT_TYPE.COIL, LOT_TYPE.SLAB, LOT_TYPE.HEAT, LOT_TYPE.HOT_METAL, LOT_TYPE.RAW_MATERIAL];
const SEARCH_LIMIT = 20;
const RECENT_LIMIT = 40;

export interface TraceSearchPaneProps {
  activeLotNo: string;
  activeShipmentRequestNo: string;
  direction: TraceDirection;
  canChangeDirection: boolean;
  onPickLot: (lotNo: string) => void;
  onPickShipmentRequest: (shipmentRequestNo: string) => void;
  onDirection: (direction: TraceDirection) => void;
}

function ListButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full flex-col gap-0.5 border-0 border-b border-line px-4 py-2 text-left text-ink',
        active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover' : 'bg-transparent hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

function LotItem({ lot, active, onPick, showSummary }: { lot: LotListItem; active: boolean; onPick: (lotNo: string) => void; showSummary: boolean }) {
  return (
    <ListButton active={active} onClick={() => onPick(lot.lotNo)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <LotTypeIcon type={lot.lotType} />
        <span className={cn('truncate font-mono text-mono', active && 'font-semibold')}>{lot.lotNo}</span>
        <span className="ml-auto flex-none">{lot.inspectionResult ? <InspectionBadge result={lot.inspectionResult} /> : <LotStatusBadge status={lot.lotStatus} />}</span>
      </span>
      <span className="truncate text-cap text-ink-3">
        {LOT_TYPE_LABEL[lot.lotType]}
        {showSummary && lot.summary ? ` · ${lot.summary}` : ''} · {fmtDate(lot.producedDate)}
      </span>
    </ListButton>
  );
}

function ShipmentItem({ hit, active, onPick }: { hit: ShipmentRequestHit; active: boolean; onPick: (no: string) => void }) {
  return (
    <ListButton active={active} onClick={() => onPick(hit.shipmentRequestNo)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon name="truck" size="sm" />
        <span className={cn('truncate font-mono text-mono', active && 'font-semibold')}>{hit.shipmentRequestNo}</span>
        <span className="ml-auto flex-none">
          <ShipmentStatusBadge status={hit.shipmentRequestStatus} />
        </span>
      </span>
      <span className="truncate text-cap text-ink-3">출하요청 · {hit.customerName}</span>
    </ListButton>
  );
}

const sameNo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function TraceSearchPane({ activeLotNo, activeShipmentRequestNo, direction, canChangeDirection, onPickLot, onPickShipmentRequest, onDirection }: TraceSearchPaneProps) {
  const [keyword, setKeyword] = useState('');
  const [lotType, setLotType] = useState<LotType | ''>('');
  const [message, setMessage] = useState<string | null>(null);
  const term = useDebouncedValue(keyword.trim());
  const searching = keyword.trim().length > 0;
  const lotHits = useLotSearch({ keyword: term, limit: SEARCH_LIMIT });
  const shipmentHits = useShipmentRequestSearch(term);
  const recent = useLotSearch({ lotType, limit: RECENT_LIMIT });

  const submit = () => {
    const text = keyword.trim();
    if (!text) return;
    if (term !== text || lotHits.isFetching || shipmentHits.isFetching) {
      setMessage('찾는 중이에요. 잠시 뒤 다시 눌러 주세요');
      return;
    }
    const lot = lotHits.data?.items.find((l) => sameNo(l.lotNo, text));
    const shipment = shipmentHits.data?.find((s) => sameNo(s.shipmentRequestNo, text));
    if (lot) {
      onPickLot(lot.lotNo);
      setKeyword('');
    } else if (shipment) {
      onPickShipmentRequest(shipment.shipmentRequestNo);
      setKeyword('');
    } else {
      const any = (lotHits.data?.items.length ?? 0) + (shipmentHits.data?.length ?? 0) > 0;
      setMessage(any ? `'${text}'와 정확히 같은 번호는 없어요. 아래에서 골라 주세요` : `'${text}'에 맞는 LOT·출하요청이 없어요`);
    }
  };

  return (
    <MasterPane
      className="max-[1100px]:w-64"
      head={
        <>
          <b className="text-base font-semibold">LOT 검색</b>
          <div role="radiogroup" aria-label="추적 방향" className="grid grid-cols-2 gap-0.5 rounded-sm bg-surface-3 p-0.5">
            {(['backward', 'forward'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                disabled={!canChangeDirection}
                title={d === 'backward' ? '코일 → 원료' : '원료·히트 → 출하요청'}
                onClick={() => onDirection(d)}
                className="h-[26px] rounded-[3px] text-xs font-medium text-ink-2 disabled:cursor-not-allowed disabled:opacity-60 aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-[0_1px_2px_rgba(18,24,32,0.12)]"
              >
                {TRACE_DIRECTION_LABEL[d]} {d === 'backward' ? '←' : '→'}
              </button>
            ))}
          </div>
          <Input
            type="search"
            leadingIcon="search"
            className="font-mono"
            value={keyword}
            placeholder="LOT 번호·출하요청 번호"
            aria-label="LOT 번호·출하요청 번호 검색"
            onChange={(event) => {
              setKeyword(event.target.value);
              setMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
            }}
          />
          {message ? (
            <span role="alert" className="flex items-center gap-1 text-cap text-danger">
              <Icon name="alert" size="sm" />
              {message}
            </span>
          ) : (
            <span className="text-cap text-ink-3">일부만 입력해도 돼요. Enter를 누르면 그 번호를 추적해요</span>
          )}
          {!searching ? (
            <div role="group" aria-label="LOT 종류" className="flex flex-wrap gap-1">
              {TYPE_FILTERS.map((type) => (
                <Chip key={type || 'all'} on={lotType === type} className="h-6 px-2" onClick={() => setLotType(type)}>
                  {type ? LOT_TYPE_LABEL[type] : '전체'}
                </Chip>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      {searching ? (
        <>
          <div className="px-4 pt-2.5 pb-1.5 text-cap text-ink-3">검색 결과</div>
          {lotHits.isFetching || shipmentHits.isFetching || term !== keyword.trim() ? (
            <div className="px-4 py-2">
              <Spinner label="찾는 중…" />
            </div>
          ) : null}
          {shipmentHits.data?.map((hit) => (
            <ShipmentItem key={`s-${hit.id}`} hit={hit} active={sameNo(hit.shipmentRequestNo, activeShipmentRequestNo)} onPick={onPickShipmentRequest} />
          ))}
          {lotHits.data?.items.map((lot) => (
            <LotItem key={lot.id} lot={lot} active={sameNo(lot.lotNo, activeLotNo)} onPick={onPickLot} showSummary={false} />
          ))}
          {lotHits.data && !lotHits.data.items.length && !shipmentHits.data?.length && term === keyword.trim() && !lotHits.isFetching ? (
            <EmptyNote>번호가 맞는 LOT·출하요청이 없어요</EmptyNote>
          ) : null}
        </>
      ) : (
        <QueryBoundary query={recent}>
          {(data) => (
            <>
              <div className="px-4 pt-2.5 pb-1.5 text-cap text-ink-3">
                최근 LOT · 전체 {fmtInt(data.total)}개 중 {fmtInt(data.items.length)}개
              </div>
              {data.items.map((lot) => (
                <LotItem key={lot.id} lot={lot} active={sameNo(lot.lotNo, activeLotNo)} onPick={onPickLot} showSummary />
              ))}
              {!data.items.length ? <EmptyNote>조건에 맞는 LOT이 없어요</EmptyNote> : null}
            </>
          )}
        </QueryBoundary>
      )}
    </MasterPane>
  );
}
