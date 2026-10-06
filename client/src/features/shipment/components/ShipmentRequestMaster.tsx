'use client';
// 출하요청 배정 화면의 왼쪽 목록 (보고서 1 A-7). 상태 칩 문구는 공통 코드 표시명 그대로.
import { useState } from 'react';
import Link from 'next/link';
import { PERMISSION, SHIPMENT_REQUEST_STATUS_LABEL, type ShipmentRequestStatus } from '@/codes';
import type { ShipmentListRow } from '@/api/shipmentRequests';
import { ButtonLink } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { MasterPane } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { ShipmentRequestStatusBadge } from '@/features/shipment/components/ShipmentBadges';
import { qtyUnitOf } from '@/features/shipment/lib/shipmentForm';
import { useCanUse } from '@/hooks/usePermission';
import { useShipmentRequestList } from '@/hooks/useShipmentRequests';
import { cn } from '@/lib/cn';
import { fmtMD, fmtMDHM, fmtTon } from '@/lib/format';

type Filter = 'ALL' | Extract<ShipmentRequestStatus, 'REQUESTED' | 'ALLOCATED'>;
const FILTERS: Filter[] = ['ALL', 'REQUESTED', 'ALLOCATED'];

export function ShipmentRequestMaster({ selectedId }: { selectedId: number }) {
  const query = useShipmentRequestList();
  const canEdit = useCanUse(PERMISSION.SHIPMENT_REQUEST_MANAGE);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [keyword, setKeyword] = useState('');
  const rows = query.data ?? [];
  const word = keyword.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (filter === 'ALL' || r.shipmentRequestStatus === filter) &&
      (!word || [r.shipmentRequestNo, r.customerName, ...r.salesOrderNos].some((t) => t.toLowerCase().includes(word))),
  );

  return (
    <MasterPane
      head={
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">출하요청</h2>
            <span className="text-xs text-ink-3">{rows.length}건</span>
            {canEdit ? (
              <ButtonLink href="/shipment-requests/new" size="sm" icon="plus" className="ml-auto">
                새 출하요청
              </ButtonLink>
            ) : null}
          </div>
          <Input leadingIcon="search" placeholder="출하요청 번호·수주·고객사 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="출하요청 검색" />
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? '전체' : SHIPMENT_REQUEST_STATUS_LABEL[f]}
                <b>{f === 'ALL' ? rows.length : rows.filter((r) => r.shipmentRequestStatus === f).length}</b>
              </Chip>
            ))}
          </div>
        </>
      }
    >
      <QueryBoundary query={query}>
        {() =>
          visible.length === 0 ? (
            <EmptyNote>조건에 맞는 출하요청이 없어요.</EmptyNote>
          ) : (
            <ul>
              {visible.map((r) => (
                <MasterItem key={r.id} row={r} selected={r.id === selectedId} />
              ))}
            </ul>
          )
        }
      </QueryBoundary>
      <p className="border-t border-line px-4 py-3 text-cap text-ink-3">
        배정 규칙: 강종·규격이 같은 합격·미배정 LOT을 생산완료일 오래된 순(같으면 LOT 번호 순)으로 추천 · 담당자 확정 · 출고 확정 전까지 바꿀 수 있어요.
      </p>
    </MasterPane>
  );
}

function captionOf(r: ShipmentListRow): string {
  if (r.shipmentRequestStatus === 'REQUESTED') return `요청 ${fmtMDHM(r.createdAt)} · 배정 ${r.totalAllocatedQty}/${r.totalRequestQty}`;
  if (r.shipmentRequestStatus === 'ALLOCATED') return '배정 확정 · 물류 출고 확정 전';
  if (r.shipmentRequestStatus === 'CANCELLED') return `취소 ${fmtMDHM(r.cancelledAt)}`;
  return `출고 ${fmtMDHM(r.issuedAt)} · 밀시트 ${r.millSheets.length}장`;
}

function MasterItem({ row, selected }: { row: ShipmentListRow; selected: boolean }) {
  const unit = qtyUnitOf(row.itemTypes);
  return (
    <li>
      <Link
        href={`/shipment-requests/${row.id}`}
        aria-current={selected ? 'page' : undefined}
        className={cn('flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2', selected && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover')}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-mono font-semibold">{row.shipmentRequestNo}</span>
          <span className="ml-auto">
            <ShipmentRequestStatusBadge status={row.shipmentRequestStatus} />
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{row.customerName}</span>
          <span className="font-mono text-cap text-ink-3">{row.salesOrderNos.length > 1 ? `수주 ${row.salesOrderNos.length}건` : row.salesOrderNos[0]}</span>
        </span>
        <span className="text-xs text-ink-2">
          {row.itemCodes[0]}
          {row.itemCodes.length > 1 ? ` 외 ${row.itemCodes.length - 1}` : ''} · {row.totalRequestQty}
          {unit} · {fmtTon(row.totalWeightTon)}
        </span>
        <span className="text-cap text-ink-3">
          출하 요청일 {fmtMD(row.requestedShipDate)} · {captionOf(row)}
        </span>
      </Link>
    </li>
  );
}
