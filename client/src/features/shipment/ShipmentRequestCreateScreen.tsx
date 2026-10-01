'use client';
// 출하요청 등록 (REQ-SHP-001, BP-SHP-01, 보고서 1 A-6).
// 고객사 → 그 고객사의 출하할 수 있는 수주 품목만 고른다(shipment_request.customer_id). 출하 매수는 정수만(SO-002 문구, 글자를 지우지 않음),
// 출하 가능 잔량 초과는 SHP-002. 출하 요청일 필수. 요청자 = 지금 사원. 메모 없음(PLAN 5장).
// 저장하면 바로 배정 화면으로 가서 FIFO 추천을 연다 (SHP-001 "요청 시 배정 추천").
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { InputError } from '@/api/client';
import type { ShippableCustomer } from '@/api/shipmentRequests';
import { PERMISSION, PRODUCT_QTY_UNIT, RESERVATION_STATUS_LABEL } from '@/codes';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Input, Select } from '@/components/Input';
import { Kpi, StatBar } from '@/components/Kpi';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { ItemTypeTag, SalesOrderLink } from '@/features/shipment/components/ShipmentBadges';
import { lineWeightTon, qtyUnitOf, requestQtyError, totalWeightTon, validQtyOf } from '@/features/shipment/lib/shipmentForm';
import { useMe } from '@/hooks/useMe';
import { useCanUse } from '@/hooks/usePermission';
import { useCreateShipmentRequest, useShippableCustomers, useShippableItems } from '@/hooks/useShipmentRequests';
import { fmtMD, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

type ShippableRow = NonNullable<ReturnType<typeof useShippableItems>['data']>[number];

export function ShipmentRequestCreateScreen() {
  const customersQuery = useShippableCustomers();
  return (
    <QueryBoundary query={customersQuery} loadingLabel="출하할 수 있는 수주를 불러오는 중…">
      {(customers) => <CreateForm customers={customers} />}
    </QueryBoundary>
  );
}

function CreateForm({ customers }: { customers: ShippableCustomer[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const canEdit = useCanUse(PERMISSION.SHIPMENT_REQUEST_MANAGE);
  const presetSalesOrderId = Number(params.get('salesOrderId')) || null;
  const presetCustomer = presetSalesOrderId ? customers.find((c) => c.salesOrderIds.includes(presetSalesOrderId)) : undefined;
  const withItems = customers.filter((c) => c.itemCount > 0);
  const [customerId, setCustomerId] = useState<number | null>(presetCustomer?.customerId ?? (withItems.length === 1 ? withItems[0].customerId : null));
  const itemsQuery = useShippableItems(customerId);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  /** 수주 품목 id → 입력한 출하 매수 글자 (고른 품목만) */
  const [qtyTexts, setQtyTexts] = useState<Map<number, string>>(new Map());
  const [presetApplied, setPresetApplied] = useState(false);
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  // 수주 화면에서 들어오면 그 수주의 품목을 출하 가능 매수 전량으로 미리 고른다
  useEffect(() => {
    if (presetApplied || !presetSalesOrderId || itemsQuery.data === undefined) return;
    setPresetApplied(true);
    setQtyTexts(new Map(itemsQuery.data.filter((i) => i.salesOrderId === presetSalesOrderId).map((i) => [i.salesOrderItemId, String(i.shippableQty)])));
  }, [presetApplied, presetSalesOrderId, itemsQuery.data]);

  const create = useCreateShipmentRequest((result) => router.push(`/shipment-requests/${result.id}?new=1`));

  const selected = items.filter((i) => qtyTexts.has(i.salesOrderItemId));
  const qtyOf = (row: ShippableRow) => qtyTexts.get(row.salesOrderItemId) ?? '';
  const errorOf = (row: ShippableRow) => requestQtyError(qtyOf(row), row.shippableQty, PRODUCT_QTY_UNIT[row.itemType]);
  const lineErrors = selected.map(errorOf);
  const totalQty = selected.reduce((s, r) => s + validQtyOf(qtyOf(r)), 0);
  const totalTon = totalWeightTon(selected.map((r) => ({ qtyText: qtyOf(r), unitWeightTon: r.unitWeightTon })));
  const unit = qtyUnitOf(selected.map((r) => r.itemType));
  const earliestDue = selected.map((r) => r.dueDate).sort()[0];
  const dateError = fieldErrors.requestedShipDate ?? (submitted && !requestedShipDate ? '출하 요청일을 입력해 주세요' : null);
  const ready = canEdit && customerId !== null && selected.length > 0 && lineErrors.every((e) => e === null) && requestedShipDate !== '';

  const pickCustomer = (value: string) => {
    setCustomerId(value ? Number(value) : null);
    setQtyTexts(new Map());
    setKeyword('');
  };
  const toggle = (row: ShippableRow) => {
    const next = new Map(qtyTexts);
    if (next.has(row.salesOrderItemId)) next.delete(row.salesOrderItemId);
    else next.set(row.salesOrderItemId, String(row.shippableQty));
    setQtyTexts(next);
  };
  const setQty = (row: ShippableRow, text: string) => setQtyTexts(new Map(qtyTexts).set(row.salesOrderItemId, text));

  const submit = () => {
    setSubmitted(true);
    setFieldErrors({});
    if (!ready || customerId === null) return;
    create.mutate(
      { customerId, requestedShipDate, items: selected.map((r) => ({ salesOrderItemId: r.salesOrderItemId, requestQty: qtyOf(r) })) },
      { onError: (error) => setFieldErrors(error instanceof InputError ? error.fieldErrors : {}) },
    );
  };

  const word = keyword.trim().toLowerCase();
  const visible = items.filter((i) => !word || i.salesOrderNo.toLowerCase().includes(word) || i.itemCode.toLowerCase().includes(word));
  const groups = [...new Set(visible.map((i) => i.salesOrderId))].map((salesOrderId) => visible.filter((i) => i.salesOrderId === salesOrderId));

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">출하 가능 수주</h2>
              <span className="text-xs text-ink-3">같은 고객사만 묶어요</span>
            </div>
            <Field label="고객사" required htmlFor="sr-customer">
              <Select id="sr-customer" value={customerId ?? ''} onChange={(e) => pickCustomer(e.target.value)}>
                <option value="">고객사를 골라 주세요</option>
                {customers.map((c) => (
                  <option key={c.customerId} value={c.customerId} disabled={c.itemCount === 0}>
                    {c.customerName} ({c.itemCount}품목)
                  </option>
                ))}
              </Select>
            </Field>
            <Input leadingIcon="search" placeholder="수주번호·규격 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} disabled={customerId === null} aria-label="수주 품목 검색" />
          </>
        }
      >
        {customerId === null ? (
          <EmptyNote>고객사를 먼저 골라 주세요. 같은 고객사의 수주 품목만 묶을 수 있어요.</EmptyNote>
        ) : (
          // 불러오는 중·불러오지 못함은 QueryBoundary가 보인다 (오류를 '품목 없음'으로 숨기지 않는다)
          <QueryBoundary query={itemsQuery} loadingLabel="출하할 수 있는 품목을 불러오는 중…">
            {(loaded) =>
              loaded.length === 0 ? (
                <EmptyNote>이 고객사는 출하요청할 수 있는 품목이 없어요. 합격 재고가 예약된 품목만 나와요.</EmptyNote>
              ) : groups.length === 0 ? (
                <EmptyNote>조건에 맞는 품목이 없어요.</EmptyNote>
              ) : (
                <ul className="flex flex-col">
                  {groups.map((group) => (
                    <li key={group[0].salesOrderId} className="border-b border-line">
                      <div className="flex items-center gap-2 bg-surface-2 px-4 py-1.5 text-xs">
                        <SalesOrderLink salesOrderId={group[0].salesOrderId} salesOrderNo={group[0].salesOrderNo} />
                        <span className="text-ink-3">{group.length}품목</span>
                      </div>
                      {group.map((row) => {
                        const unitLabel = PRODUCT_QTY_UNIT[row.itemType];
                        const checked = qtyTexts.has(row.salesOrderItemId);
                        return (
                          <label key={row.salesOrderItemId} className="flex cursor-pointer items-start gap-2.5 px-4 py-2 hover:bg-surface-2">
                            <input type="checkbox" className="mt-1" checked={checked} onChange={() => toggle(row)} />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                <ItemTypeTag itemType={row.itemType} />
                                <span className="truncate font-mono text-mono">{row.itemCode}</span>
                              </span>
                              <span className="text-xs text-ink-3">
                                품목 {row.lineNo} · 납기 {fmtMD(row.dueDate)} · 출하 가능 {row.shippableQty}
                                {unitLabel}
                              </span>
                            </span>
                            <span className="text-right text-xs text-ink-2">
                              {checked ? (
                                <b className="text-run">
                                  {qtyOf(row) || '0'} 요청
                                </b>
                              ) : (
                                <>
                                  예약 {row.activeReservedQty}
                                  {row.openRequestQty > 0 ? ` · 요청됨 ${row.openRequestQty}` : ''}
                                </>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
        )}
        <p className="px-4 py-3 text-cap text-ink-3">출하 가능 매수 = {RESERVATION_STATUS_LABEL.ACTIVE} 매수 − 다른 진행 중 출하요청 매수예요.</p>
      </MasterPane>
      <PageMain>
        <PageHead
          crumb="출하요청"
          title="새 출하요청"
          actions={
            <>
              <ButtonLink href="/shipment-requests" variant="ghost">
                목록
              </ButtonLink>
              <Button variant="primary" icon="arrow-right" disabled={!canEdit || create.isPending} title={canEdit ? undefined : permissionNeedText([PERMISSION.SHIPMENT_REQUEST_MANAGE])} onClick={submit}>
                {create.isPending ? '등록하는 중…' : '등록하고 FIFO 추천 보기'}
              </Button>
            </>
          }
        />
        <StatBar>
          <Kpi flat label="묶은 품목" value={selected.length} unit="품목" sub={`수주 ${new Set(selected.map((r) => r.salesOrderId)).size}건`} />
          <Kpi flat label="출하 매수" value={totalQty} unit={unit} />
          <Kpi flat label="이론중량 (계산값)" value={fmtTon(totalTon).replace(' t', '')} unit="t" sub="매수 × 1매 이론중량 · 등록할 때 다시 계산해요" />
          <Kpi flat label="출하 요청일" value={requestedShipDate ? fmtMD(requestedShipDate) : '-'} sub={earliestDue ? `가장 이른 납기 ${earliestDue}` : '품목을 고르면 납기가 보여요'} />
        </StatBar>
        <Card>
          <CardHead title="선택한 품목" meta={selected.length ? `${selected.length}품목` : undefined} />
          {selected.length === 0 ? (
            <EmptyNote>{customerId === null ? '왼쪽에서 고객사를 고르고 출하할 품목을 체크해 주세요.' : '왼쪽 목록에서 출하할 품목을 체크해 주세요.'}</EmptyNote>
          ) : (
            <div className="overflow-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>수주</Th>
                    <Th>구분</Th>
                    <Th>강종</Th>
                    <Th>규격</Th>
                    <Th>납기</Th>
                    <Th align="right">수주 매수</Th>
                    <Th align="right">출고 누계</Th>
                    <Th align="right">예약 매수</Th>
                    <Th align="right">다른 출하요청</Th>
                    <Th align="right">출하 가능</Th>
                    <Th align="right">출하 매수</Th>
                    <Th align="right">이론중량 (계산값)</Th>
                    <Th aria-label="빼기" />
                  </tr>
                </thead>
                <tbody>
                  {selected.map((row) => {
                    const error = errorOf(row);
                    const unitLabel = PRODUCT_QTY_UNIT[row.itemType];
                    return (
                      <tr key={row.salesOrderItemId} data-risk={error !== null}>
                        <Td>
                          <SalesOrderLink salesOrderId={row.salesOrderId} salesOrderNo={row.salesOrderNo} lineNo={row.lineNo} />
                        </Td>
                        <Td>
                          <ItemTypeTag itemType={row.itemType} />
                        </Td>
                        <Td className="font-mono text-mono">{row.steelGradeCode ?? '-'}</Td>
                        <Td className="font-mono text-mono">{row.itemCode}</Td>
                        <Td>{row.dueDate}</Td>
                        <Td align="right">{row.orderedQty}</Td>
                        <Td align="right">{row.shippedQty}</Td>
                        <Td align="right">{row.activeReservedQty}</Td>
                        <Td align="right">{row.openRequestQty}</Td>
                        <Td align="right" className="font-semibold">
                          {row.shippableQty}
                          {unitLabel}
                        </Td>
                        <Td align="right" className="py-1">
                          <div className="flex flex-col items-end gap-0.5">
                            <Input
                              numeric
                              inputMode="numeric"
                              suffix={unitLabel}
                              value={qtyOf(row)}
                              onChange={(e) => setQty(row, e.target.value)}
                              invalid={error !== null}
                              title={`1 ~ ${row.shippableQty}`}
                              aria-label={`${row.salesOrderNo} ${row.lineNo}번 품목 출하 매수`}
                              className="w-24"
                            />
                            {error ? <span className="max-w-56 whitespace-normal text-right text-cap text-danger">{error}</span> : null}
                          </div>
                        </Td>
                        <Td align="right">{fmtTon(lineWeightTon(qtyOf(row), row.unitWeightTon))}</Td>
                        <Td>
                          <IconButton icon="x" label="빼기" onClick={() => toggle(row)} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <Td colSpan={10}>합계 · 수주 {new Set(selected.map((r) => r.salesOrderId)).size}건</Td>
                    <Td align="right">
                      {totalQty}
                      {unit}
                    </Td>
                    <Td align="right">{fmtTon(totalTon)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2.5 text-cap text-ink-3">부분 출하는 출하요청을 나눠서 해요. 예: 10매 중 4매를 먼저 요청하고, 나머지 6매는 다음 출하요청으로 해요.</p>
        </Card>
        <Card>
          <CardHead title="요청 정보" meta="출하요청 번호는 등록할 때 정해져요" />
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="출하 요청일" required htmlFor="sr-date" error={dateError} hint="출고는 물류가 확정해요">
              <DateInput id="sr-date" value={requestedShipDate} onChange={setRequestedShipDate} invalid={dateError !== null} ariaLabel="출하 요청일" />
            </Field>
            <Field label="요청자">
              <Input readOnly value={`${me.employeeName} · ${me.departmentName}`} aria-label="요청자" />
            </Field>
          </CardBody>
        </Card>
        <Banner tone="run" icon="info">
          등록하면 품목마다 강종·규격이 같은 합격 LOT을 FIFO(생산완료일 → LOT 번호)로 바로 추천해요. 추천은 저장하지 않고, 담당자가 확정해요.
        </Banner>
      </PageMain>
    </>
  );
}
