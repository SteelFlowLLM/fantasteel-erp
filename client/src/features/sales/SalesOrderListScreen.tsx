'use client';

// 수주 목록 /sales-orders (REQ-SO-004·005, 보고서 1 A-1): 필터 레일 | 툴바·수주 표 | 선택한 수주 미리보기.
// 헤더 상태는 품목 상태에서 계산(SO-005), 납기 위험은 생산 설정값의 납기 위험 기준일로 계산한 표시값.
import Link from 'next/link';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ITEM_TYPE_LABEL, PERMISSION, SALES_ORDER_ITEM_STATUS_LABEL } from '@/codes';
import type { SalesOrderListRow } from '@/api/salesOrders';
import { Button, ButtonLink } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { Tag } from '@/components/Tag';
import { useCustomerList } from '@/hooks/useLookups';
import { useCanUse } from '@/hooks/usePermission';
import { useSalesOrderList } from '@/hooks/useSalesOrders';
import { fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { progressOf } from '@/lib/inventoryMath';
import { SalesOrderPreviewPane } from '@/features/sales/components/SalesOrderPreviewPane';
import {
  businessEventsHref,
  DueRiskBadge,
  DueText,
  MeasureBar,
  SALES_ORDER_STATUS_KEYS,
  SalesOrderStatusBadge,
} from '@/features/sales/components/SalesOrderParts';
import {
  activeFilterCount,
  EMPTY_FILTER,
  filterSalesOrders,
  qtyUnitOf,
  type SalesOrderFilter,
  type SalesOrderStatusFilter,
} from '@/features/sales/lib/salesOrderForm';

const PAGE_SIZE = 50;

const STATUS_TABS: readonly { key: SalesOrderStatusFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'OPEN', label: SALES_ORDER_ITEM_STATUS_LABEL.OPEN },
  { key: 'PARTIALLY_SHIPPED', label: SALES_ORDER_ITEM_STATUS_LABEL.PARTIALLY_SHIPPED },
  { key: 'SHIPPED', label: SALES_ORDER_ITEM_STATUS_LABEL.SHIPPED },
];

function RadioRow({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm text-ink-2 hover:bg-surface-2 has-checked:font-semibold has-checked:text-ink">
      <input type="radio" name={name} className="size-3.5" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-0.5 border-b border-line px-3 py-3">
      <legend className="mb-1 px-1.5 text-cap font-semibold text-ink-3">{title}</legend>
      {children}
    </fieldset>
  );
}

/** 품목 요약: 1품목이면 "SS275 슬래브 250×1200×10000 10매", 여러 품목이면 "… 5매 + … 6개" */
function ItemSummary({ row }: { row: SalesOrderListRow }) {
  if (row.itemLines.length === 1) {
    const line = row.itemLines[0];
    if (!line) return null;
    return (
      <span className="truncate">
        {line.itemName} {line.orderedQty}
        {qtyUnitOf([line.itemType])}
      </span>
    );
  }
  return (
    <span className="truncate" title={row.itemLines.map((l) => `${l.itemName} ${l.orderedQty}${qtyUnitOf([l.itemType])}`).join(' + ')}>
      {row.itemLines.map((line, index) => (
        <Fragment key={line.lineNo}>
          {index > 0 ? ' + ' : ''}
          {ITEM_TYPE_LABEL[line.itemType]} {line.orderedQty}
          {qtyUnitOf([line.itemType])}
        </Fragment>
      ))}
    </span>
  );
}

export function SalesOrderListScreen() {
  const list = useSalesOrderList();
  const customers = useCustomerList();
  const canCreate = useCanUse(PERMISSION.SALES_ORDER_CREATE);
  const [filter, setFilter] = useState<SalesOrderFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const rows = useMemo(() => filterSalesOrders(list.data ?? [], filter), [list.data, filter]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = rows.find((r) => r.id === selectedId) ?? pageRows[0] ?? null;
  const applied = activeFilterCount(filter);

  const update = (patch: Partial<SalesOrderFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };

  return (
    <>
      <section aria-label="수주 필터" className="flex min-h-0 w-60 flex-none flex-col border-r border-line bg-surface">
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 pt-3.5 pb-2.5">
          <b className="text-sm font-semibold">필터</b>
          {applied > 0 ? <Tag tone="run">적용 {applied}</Tag> : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => update(EMPTY_FILTER)} disabled={applied === 0 && filter.keyword === ''}>
            초기화
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FilterGroup title="상태">
            <RadioRow name="so-status" checked={filter.status === 'ALL'} onChange={() => update({ status: 'ALL' })}>
              전체
            </RadioRow>
            {SALES_ORDER_STATUS_KEYS.map((status) => (
              <RadioRow key={status} name="so-status" checked={filter.status === status} onChange={() => update({ status })}>
                {SALES_ORDER_ITEM_STATUS_LABEL[status]}
              </RadioRow>
            ))}
            <label className="mt-1 flex h-7 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm font-medium text-danger hover:bg-danger-bg">
              <input type="checkbox" className="size-3.5" checked={filter.riskOnly} onChange={(event) => update({ riskOnly: event.target.checked })} />
              납기 위험만
            </label>
          </FilterGroup>
          <FilterGroup title="고객사">
            <RadioRow name="so-customer" checked={filter.customerId === null} onChange={() => update({ customerId: null })}>
              전체
            </RadioRow>
            {customers.isPending ? <span className="px-1.5 text-cap text-ink-3">불러오는 중…</span> : null}
            {customers.error ? <span className="px-1.5 text-cap text-danger">고객사 목록을 불러오지 못했어요</span> : null}
            {(customers.data ?? []).map((customer) => (
              <RadioRow key={customer.id} name="so-customer" checked={filter.customerId === customer.id} onChange={() => update({ customerId: customer.id })}>
                {customer.customerName}
              </RadioRow>
            ))}
          </FilterGroup>
          <FilterGroup title="품목 유형">
            <RadioRow name="so-type" checked={filter.itemType === 'ALL'} onChange={() => update({ itemType: 'ALL' })}>
              전체
            </RadioRow>
            <RadioRow name="so-type" checked={filter.itemType === 'SLAB'} onChange={() => update({ itemType: 'SLAB' })}>
              {ITEM_TYPE_LABEL.SLAB}
            </RadioRow>
            <RadioRow name="so-type" checked={filter.itemType === 'COIL'} onChange={() => update({ itemType: 'COIL' })}>
              {ITEM_TYPE_LABEL.COIL}
            </RadioRow>
          </FilterGroup>
        </div>
      </section>

      <PageMain className="min-w-[560px]">
        <div className="flex flex-none flex-wrap items-center gap-2">
          <Input
            leadingIcon="search"
            className="w-64"
            placeholder="수주번호·고객사 검색"
            value={filter.keyword}
            onChange={(event) => update({ keyword: event.target.value })}
            aria-label="수주 검색"
          />
          <Segmented
            ariaLabel="상태"
            items={STATUS_TABS}
            active={STATUS_TABS.some((t) => t.key === filter.status) ? filter.status : 'ALL'}
            onChange={(status) => update({ status })}
          />
          <span className="text-cap text-ink-3">
            {rows.length.toLocaleString('en-US')}건{list.isFetching && !list.isPending ? ' · 새로 불러오는 중…' : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ButtonLink size="sm" icon="history" href={businessEventsHref(selected?.id ?? null)}>
              작업 로그
            </ButtonLink>
            {canCreate ? (
              <ButtonLink size="sm" variant="primary" icon="plus" href="/sales-orders/new">
                수주 등록
              </ButtonLink>
            ) : (
              <Button size="sm" variant="primary" icon="plus" disabled title={permissionNeedText([PERMISSION.SALES_ORDER_CREATE])}>
                수주 등록
              </Button>
            )}
          </div>
        </div>
        {canCreate ? null : <ReadOnlyHint permissions={[PERMISSION.SALES_ORDER_CREATE]} />}

        <QueryBoundary query={list} loadingLabel="수주를 불러오는 중…">
          {(all) => (
            <div className="flex min-h-0 flex-col rounded-md border border-line bg-surface shadow-1">
              <div className="min-h-0 overflow-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>수주번호</Th>
                      <Th>고객사</Th>
                      <Th>품목 요약</Th>
                      <Th align="right">수주 매수</Th>
                      <Th align="right" title="매수 × 1매 이론중량 계산값">
                        톤 (계산값)
                      </Th>
                      <Th title="검사합격(확보) 매수 ÷ 수주 매수 — 예약과 출하를 합친 확보 매수예요">검사합격 / 수주</Th>
                      <Th>상태</Th>
                      <Th>납기</Th>
                      <Th>담당</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const unit = qtyUnitOf(row.itemTypes);
                      const done = row.status === 'SHIPPED' || row.status === 'CANCELLED';
                      return (
                        <tr
                          key={row.id}
                          data-selected={selected?.id === row.id}
                          data-muted={row.status === 'CANCELLED'}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(row.id)}
                        >
                          <Td>
                            <Link
                              href={`/sales-orders/${row.id}`}
                              className="font-mono text-xs font-semibold text-run hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {row.salesOrderNo}
                            </Link>
                          </Td>
                          <Td>{row.customerName}</Td>
                          <Td className="max-w-[280px]">
                            <ItemSummary row={row} />
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {row.totalOrderedQty.toLocaleString('en-US')}
                            <small className="ml-px text-cap text-ink-3">{unit}</small>
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {fmtTon(row.totalOrderedTon)}
                          </Td>
                          <Td>
                            <MeasureBar
                              label="검사합격"
                              unit={unit}
                              tone="ok"
                              measure={progressOf(row.totalActiveReservedQty + row.totalShippedQty, row.totalOrderedQty)}
                            />
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-1">
                              <SalesOrderStatusBadge status={row.status} />
                              {row.isDueRisk ? <DueRiskBadge /> : null}
                              {row.hasReproductionNeed ? <Tag tone="outline">재생산 필요</Tag> : null}
                            </span>
                          </Td>
                          <Td>
                            <DueText dueDate={row.earliestDueDate} risk={row.isDueRisk} done={done} />
                          </Td>
                          <Td>{row.ownerName ?? '-'}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {pageRows.length === 0 ? (
                  <EmptyNote>{all.length === 0 ? '등록된 수주가 없어요' : '조건에 맞는 수주가 없어요 · 왼쪽 필터를 초기화해 보세요'}</EmptyNote>
                ) : null}
              </div>
              {rows.length > PAGE_SIZE ? (
                <div className="flex flex-none items-center gap-2 border-t border-line px-3 py-2 text-cap text-ink-3">
                  <span>
                    {rows.length}건 중 {currentPage * PAGE_SIZE + 1}~{Math.min(rows.length, (currentPage + 1) * PAGE_SIZE)}
                  </span>
                  <Button size="sm" className="ml-auto" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                    이전
                  </Button>
                  <span className="tabular-nums">
                    {currentPage + 1} / {pageCount}
                  </span>
                  <Button size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
                    다음
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </QueryBoundary>
        <p className="flex-none text-cap text-ink-3">
          검사합격은 이 수주 몫으로 확보한 합격 제품(예약 + 출하) 매수예요. 지표마다 분모를 함께 보여 주고, 단계를 더하지 않아요.
        </p>
      </PageMain>

      <SalesOrderPreviewPane salesOrderId={selected?.id ?? null} />
    </>
  );
}
