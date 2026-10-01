'use client';
// 출하요청 목록 (REQ-SHP-001, 보고서 1 A-5). 상태 칩은 URL ?status=에 둔다.
// C 반영: '출하번호' → '출하요청 번호', 상태 표시명은 공통 코드 그대로, 메모 없음.
// 옛 목록처럼 출하요청 번호·수주·'LOT 배정 →'은 링크다(키보드로도 열 수 있게). 행 클릭은 마우스 지름길로 둔다.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PERMISSION, SHIPMENT_REQUEST_STATUS, SHIPMENT_REQUEST_STATUS_LABEL, type ShipmentRequestStatus } from '@/codes';
import type { ShipmentListRow } from '@/api/shipmentRequests';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DateInput } from '@/components/DateInput';
import { Input, Select } from '@/components/Input';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MillSheetLink, SalesOrderLink, ShipmentRequestLink, ShipmentRequestStatusBadge } from '@/features/shipment/components/ShipmentBadges';
import { qtyUnitOf } from '@/features/shipment/lib/shipmentForm';
import { useCanUse } from '@/hooks/usePermission';
import { useShipmentRequestList } from '@/hooks/useShipmentRequests';
import { fmtMDdow, fmtMDHM, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const STATUSES = Object.values(SHIPMENT_REQUEST_STATUS);
const isStatus = (value: string | null): value is ShipmentRequestStatus => STATUSES.some((s) => s === value);

export function ShipmentRequestListScreen() {
  const query = useShipmentRequestList();
  const canEdit = useCanUse(PERMISSION.SHIPMENT_REQUEST_MANAGE);
  return (
    <PageMain>
      <PageHead
        crumb="출하"
        title="출하요청"
        actions={
          <>
            {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.SHIPMENT_REQUEST_MANAGE]} />}
            {canEdit ? (
              <ButtonLink href="/shipment-requests/new" variant="primary" icon="plus">
                출하요청 등록
              </ButtonLink>
            ) : (
              <Button variant="primary" icon="lock" disabled title={permissionNeedText([PERMISSION.SHIPMENT_REQUEST_MANAGE])}>
                출하요청 등록
              </Button>
            )}
          </>
        }
      />
      <p className="-mt-2 text-sm text-ink-3">같은 고객사의 수주 품목을 묶어 요청하고, 합격 LOT을 FIFO로 배정해요.</p>
      <QueryBoundary query={query} loadingLabel="출하요청을 불러오는 중…">
        {(rows) => <ShipmentRequestTable rows={rows} />}
      </QueryBoundary>
    </PageMain>
  );
}

function ShipmentRequestTable({ rows }: { rows: ShipmentListRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : null;
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [keyword, setKeyword] = useState('');

  const setStatus = (next: ShipmentRequestStatus | null) => {
    const search = new URLSearchParams(params.toString());
    if (next) search.set('status', next);
    else search.delete('status');
    const text = search.toString();
    router.replace(text ? `${pathname}?${text}` : pathname);
  };

  const customers = useMemo(() => [...new Map(rows.map((r) => [r.customerId, r.customerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const filtered = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.shipmentRequestStatus !== status) return false;
      if (customerId && String(r.customerId) !== customerId) return false;
      if (from && r.requestedShipDate < from) return false;
      if (to && r.requestedShipDate > to) return false;
      if (!word) return true;
      return [r.shipmentRequestNo, r.customerName, ...r.salesOrderNos, ...r.itemCodes].some((t) => t.toLowerCase().includes(word));
    });
  }, [rows, status, customerId, from, to, keyword]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={status === null} onClick={() => setStatus(null)}>
          전체 <b>{rows.length}</b>
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
            {SHIPMENT_REQUEST_STATUS_LABEL[s]} <b>{rows.filter((r) => r.shipmentRequestStatus === s).length}</b>
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Select aria-label="고객사" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-40">
          <option value="">고객사 전체</option>
          {customers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-ink-3">출하 요청일</span>
        <DateInput value={from} onChange={setFrom} ariaLabel="출하 요청일 시작" className="w-[130px]" />
        <span className="text-ink-3">~</span>
        <DateInput value={to} onChange={setTo} ariaLabel="출하 요청일 끝" className="w-[130px]" />
        <Input
          leadingIcon="search"
          placeholder="출하요청 번호·고객사·수주·규격 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-64"
          aria-label="검색"
        />
      </div>
      <Card>
        <CardHead title="출하요청 목록" meta={`${filtered.length}/${rows.length}건 · 최신순`} />
        {rows.length === 0 ? (
          <EmptyNote>아직 등록된 출하요청이 없어요.</EmptyNote>
        ) : filtered.length === 0 ? (
          <EmptyNote>조건에 맞는 출하요청이 없어요.</EmptyNote>
        ) : (
          <div className="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th>출하요청 번호</Th>
                  <Th>상태</Th>
                  <Th>고객사</Th>
                  <Th>출하 요청일</Th>
                  <Th>품목</Th>
                  <Th>수주</Th>
                  <Th align="right">요청 매수</Th>
                  <Th align="right">이론중량</Th>
                  <Th align="right">배정</Th>
                  <Th>요청</Th>
                  <Th>다음</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const unit = qtyUnitOf(r.itemTypes);
                  return (
                    <tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/shipment-requests/${r.id}`)}>
                      <Td className="font-semibold">
                        <ShipmentRequestLink id={r.id} no={r.shipmentRequestNo} />
                      </Td>
                      <Td>
                        <ShipmentRequestStatusBadge status={r.shipmentRequestStatus} />
                      </Td>
                      <Td>{r.customerName}</Td>
                      <Td className="tabular-nums">{fmtMDdow(`${r.requestedShipDate}T00:00:00+09:00`)}</Td>
                      <Td title={r.itemCodes.join('\n')} className="font-mono text-mono">
                        {r.itemCodes[0] ?? '-'}
                        {r.itemCodes.length > 1 ? <span className="text-ink-3"> 외 {r.itemCodes.length - 1}</span> : null}
                      </Td>
                      <Td title={r.salesOrders.map((so) => so.salesOrderNo).join('\n')}>
                        {r.salesOrders[0] ? <SalesOrderLink salesOrderId={r.salesOrders[0].salesOrderId} salesOrderNo={r.salesOrders[0].salesOrderNo} /> : '-'}
                        {r.salesOrders.length > 1 ? <span className="text-ink-3"> 외 {r.salesOrders.length - 1}</span> : null}
                      </Td>
                      <Td align="right">
                        {r.totalRequestQty}
                        {unit}
                      </Td>
                      <Td align="right">{fmtTon(r.totalWeightTon)}</Td>
                      <Td align="right">{r.shipmentRequestStatus === 'CANCELLED' ? '-' : `${r.totalAllocatedQty} / ${r.totalRequestQty}`}</Td>
                      <Td className="text-xs text-ink-2">
                        {r.requesterName ?? '-'} · {fmtMDHM(r.createdAt)}
                      </Td>
                      <Td>
                        <NextStep row={r} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}

function NextStep({ row }: { row: ShipmentListRow }) {
  if (row.shipmentRequestStatus === 'REQUESTED')
    return (
      <Link href={`/shipment-requests/${row.id}`} className="text-xs font-medium text-wait hover:underline" onClick={(e) => e.stopPropagation()}>
        LOT 배정 →
      </Link>
    );
  if (row.shipmentRequestStatus === 'ALLOCATED')
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <ButtonLink href={`/goods-issues?request=${row.id}`} size="sm">
          출고 확정
        </ButtonLink>
      </span>
    );
  if (row.shipmentRequestStatus === 'ISSUED')
    return (
      <span className="flex flex-wrap gap-1.5">
        {row.millSheets.map((m) => (
          <MillSheetLink key={m.id} id={m.id} no={m.millSheetNo} />
        ))}
      </span>
    );
  return <span className="text-ink-3">-</span>;
}
