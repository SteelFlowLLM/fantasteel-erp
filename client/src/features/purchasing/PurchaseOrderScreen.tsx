'use client';

// 발주 (REQ-PUR-003, BP-PUR-01): 승인된 구매요청 품목을 품목의 기본 공급업체별로 묶어 공급업체 1곳당 발주 1건(여러 줄).
// 발주는 만들면 바로 확정(CONFIRMED)이고 입고예정(scheduled_receipt_ton)에 반영된다. 발주량 = 요청 톤(나눠 발주하지 않음).
// 요청의 모든 품목을 발주하면 구매요청이 '발주 완료'가 된다. 승인 전이면 PUR-002.
// 주소: ?po= 발주 상세, ?pr= 그 요청 품목을 골라 둔 발주 작성, ?supplier= 그 공급업체 품목을 골라 둔 발주 작성.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION, PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrderStatus } from '@/codes';
import type { OrderableRequisitionItem, PurchaseOrderView } from '@/api/purchasing';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Kpi, StatBar } from '@/components/Kpi';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { Progress } from '@/components/Progress';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MasterGroupTitle, MasterItem, MasterNote, PurchaseOrderStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { earliestDate, groupBySupplier, ratioPercent, summarizeItemNames, type SupplierGroup } from '@/features/purchasing/lib/purchasingView';
import { useCanUse, useCanView } from '@/hooks/usePermission';
import { useCreatePurchaseOrders, useOrderableRequisitionItems, usePurchaseOrderList } from '@/hooks/usePurchaseOrders';
import { decSum } from '@/lib/decimal';
import { fmtDate, fmtDateTime, fmtMD, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const STATUS_FILTERS: readonly PurchaseOrderStatus[] = ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'];
/** 기본 공급업체가 없는 묶음의 주소 값 */
const NO_SUPPLIER = 'none';

const supplierKey = (supplierId: number | null): string => (supplierId === null ? NO_SUPPLIER : String(supplierId));
const orderReceivedTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.receivedTon));
const orderOrderedTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.orderedTon));
const orderScheduledTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.scheduledReceiptTon));

export function PurchaseOrderScreen() {
  const url = useUrlParams();
  const selectedPoId = url.getNumber('po');
  const prParam = url.getNumber('pr');
  const supplierParam = url.get('supplier');
  const canOrder = useCanUse(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const orders = usePurchaseOrderList();
  const orderable = useOrderableRequisitionItems();
  const [status, setStatus] = useState<PurchaseOrderStatus | null>(null);

  const orderRows = useMemo(() => orders.data ?? [], [orders.data]);
  const filteredOrders = status === null ? orderRows : orderRows.filter((po) => po.purchaseOrderStatus === status);
  const groups = useMemo(() => groupBySupplier(orderable.data ?? []), [orderable.data]);
  const selectedPo = selectedPoId !== null ? orderRows.find((po) => po.id === selectedPoId) : undefined;
  const writing = selectedPoId === null && (orderable.data?.length ?? 0) > 0;
  // 아무것도 고르지 않았으면 첫 공급업체 묶음을 고른 것으로 본다
  const firstSelectable = groups.find((g) => g.supplierId !== null);
  const activeSupplier = supplierParam ?? (prParam === null && firstSelectable ? supplierKey(firstSelectable.supplierId) : null);

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">발주</b>
              <span className="text-xs text-ink-3">{orderRows.length}건</span>
              <ButtonLink href="/goods-receipts" size="sm" icon="box" className="ml-auto">
                입고
              </ButtonLink>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={status === null} onClick={() => setStatus(null)}>
                전체 <b>{orderRows.length}</b>
              </Chip>
              {STATUS_FILTERS.map((value) => (
                <Chip key={value} on={status === value} onClick={() => setStatus(status === value ? null : value)}>
                  {PURCHASE_ORDER_STATUS_LABEL[value]} <b>{orderRows.filter((po) => po.purchaseOrderStatus === value).length}</b>
                </Chip>
              ))}
            </div>
            {canOrder ? null : <ReadOnlyHint permissions={[PERMISSION.PURCHASE_ORDER_CONFIRM]} />}
          </>
        }
      >
        <MasterGroupTitle title="발주할 구매요청 (승인됨)" meta={orderable.data ? `${orderable.data.length}개 품목` : undefined} />
        <QueryBoundary query={orderable} loadingLabel="발주할 구매요청을 불러오는 중…">
          {(items) =>
            items.length === 0 ? (
              <EmptyNote>발주를 기다리는 승인 요청이 없어요</EmptyNote>
            ) : (
              <>
                {groups.map((group) => (
                  <MasterItem
                    key={supplierKey(group.supplierId)}
                    selected={writing && activeSupplier === supplierKey(group.supplierId)}
                    onClick={() => url.set({ supplier: supplierKey(group.supplierId), po: null, pr: null })}
                  >
                    <span className="flex items-center gap-2">
                      <b className="text-sm font-semibold">{group.supplierName ?? '기본 공급업체 없음'}</b>
                      <span className="ml-auto text-cap text-ink-3">발주 대기 {group.items.length}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-cap text-ink-3">
                      {summarizeItemNames(group.items)} · {fmtTon(decSum(group.items.map((i) => i.requiredTon)))}
                    </span>
                  </MasterItem>
                ))}
              </>
            )
          }
        </QueryBoundary>
        <MasterGroupTitle title="발주 내역" meta={`${filteredOrders.length}건`} />
        <QueryBoundary query={orders} loadingLabel="발주를 불러오는 중…">
          {() =>
            filteredOrders.length === 0 ? (
              <EmptyNote>{orderRows.length === 0 ? '아직 발주가 없어요' : '조건에 맞는 발주가 없어요'}</EmptyNote>
            ) : (
              <>
                {filteredOrders.map((po) => {
                  const ordered = orderOrderedTon(po);
                  const received = orderReceivedTon(po);
                  return (
                    <MasterItem key={po.id} selected={po.id === selectedPoId} onClick={() => url.set({ po: po.id, pr: null, supplier: null })}>
                      <span className="flex items-center gap-2">
                        <b className="font-mono text-sm font-semibold">{po.purchaseOrderNo}</b>
                        <PurchaseOrderStatusBadge status={po.purchaseOrderStatus} />
                        <span className="ml-auto text-cap text-ink-3">{po.dueDate ? `납기 ${fmtMD(po.dueDate)}` : ''}</span>
                      </span>
                      <span className="text-sm text-ink">
                        {po.supplierName} <span className="text-ink-3">· {summarizeItemNames(po.items)}</span>
                      </span>
                      <span className="flex items-center gap-2 text-cap text-ink-3">
                        <span className="whitespace-nowrap">
                          입고 {fmtTon(received)} / {fmtTon(ordered)}
                        </span>
                        <Progress value={ratioPercent(received, ordered)} tone={po.purchaseOrderStatus === 'RECEIVED' ? 'ok' : 'run'} showLabel={false} label="입고 진행" className="flex-1" />
                      </span>
                    </MasterItem>
                  );
                })}
              </>
            )
          }
        </QueryBoundary>
        <MasterNote>승인된 구매요청만 발주할 수 있어요. 공급업체 1곳당 발주 1건에 여러 품목을 묶어요.</MasterNote>
      </MasterPane>
      <PageMain>
        {selectedPo ? (
          <PurchaseOrderDetail po={selectedPo} />
        ) : selectedPoId !== null && orders.data ? (
          <StateView kind="empty" title="발주를 찾을 수 없어요" />
        ) : writing ? (
          <OrderForm
            key={`${prParam ?? ''}-${activeSupplier ?? ''}`}
            groups={groups}
            initialIds={(orderable.data ?? [])
              .filter((i) => (prParam !== null ? i.purchaseRequisitionId === prParam : supplierKey(i.supplierId) === activeSupplier))
              .filter((i) => i.supplierId !== null)
              .map((i) => i.id)}
            canOrder={canOrder}
            onDone={(created) => url.set({ po: created[0]?.id ?? null, pr: null, supplier: null })}
          />
        ) : orderable.data && orders.data ? (
          <StateView
            kind="empty"
            icon="building"
            title={orderRows.length === 0 ? '발주할 구매요청도, 발주 내역도 없어요' : '발주할 품목이 남아 있지 않아요'}
            text="구매요청이 부서장 승인을 받으면 여기에 올라와요. 왼쪽에서 발주를 고르면 입고 현황을 볼 수 있어요"
            actions={
              <ButtonLink href="/purchase-requisitions" size="sm" icon="cart">
                구매요청 목록
              </ButtonLink>
            }
          />
        ) : null}
      </PageMain>
    </>
  );
}

function OrderForm({
  groups,
  initialIds,
  canOrder,
  onDone,
}: {
  groups: SupplierGroup<OrderableRequisitionItem>[];
  initialIds: number[];
  canOrder: boolean;
  onDone: (created: PurchaseOrderView[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialIds));
  const [dueDate, setDueDate] = useState('');
  const create = useCreatePurchaseOrders({
    success: (created) => `${created.map((po) => po.purchaseOrderNo).join(', ')} 발주를 확정했어요. 입고예정에 반영돼요`,
    onSuccess: (created) => onDone(created),
  });

  const allItems = groups.flatMap((g) => g.items);
  const chosen = allItems.filter((i) => selected.has(i.id));
  const supplierCount = new Set(chosen.map((i) => i.supplierId)).size;
  const earliest = earliestDate(chosen.map((i) => i.desiredReceiptDate));
  const toggle = (id: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHead crumb="발주" title="발주 작성" />
      <Banner tone="run">
        고른 품목은 품목의 <b>기본 공급업체</b>별로 묶여 공급업체 1곳당 발주 1건이 돼요. 발주량은 요청 톤 그대로이고, 발주는 만들면 바로 확정되어 입고예정에 반영돼요.
      </Banner>
      {groups.map((group) => {
        const selectable = group.supplierId !== null;
        const groupIds = group.items.map((i) => i.id);
        const allOn = selectable && groupIds.every((id) => selected.has(id));
        return (
          <Card key={supplierKey(group.supplierId)}>
            <CardHead
              title={group.supplierName ?? '기본 공급업체 없음'}
              meta={`승인된 요청 품목 ${group.items.length}건 · 미발주 ${fmtTon(decSum(group.items.map((i) => i.requiredTon)))}`}
              actions={
                selectable ? (
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={(event) => setSelected((current) => new Set([...[...current].filter((id) => !groupIds.includes(id)), ...(event.target.checked ? groupIds : [])]))}
                    />
                    전체 선택
                  </label>
                ) : null
              }
            />
            <CardBody flush>
              {selectable ? null : <Banner tone="wait" className="m-3">이 원료들은 기본 공급업체가 지정되지 않아 발주할 수 없어요. 기준정보에서 원료의 기본 공급업체를 지정해 주세요.</Banner>}
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>구매요청</Th>
                    <Th>원료</Th>
                    <Th>근거 생산계획</Th>
                    <Th>희망 입고일</Th>
                    <Th align="right">발주 톤</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.id} data-selected={selected.has(item.id)}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`${item.purchaseRequisitionNo} ${item.lineNo}번 품목 고르기`}
                          disabled={!selectable}
                          checked={selected.has(item.id)}
                          onChange={(event) => toggle(item.id, event.target.checked)}
                        />
                      </Td>
                      <Td>
                        <Link className="font-mono text-run hover:underline" href={`/purchase-requisitions/${item.purchaseRequisitionId}`}>
                          {item.purchaseRequisitionNo}
                        </Link>{' '}
                        <span className="text-cap text-ink-3">#{item.lineNo}</span>
                      </Td>
                      <Td>
                        {item.itemName} <span className="font-mono text-cap text-ink-3">{item.itemCode}</span>
                      </Td>
                      <Td className="font-mono">{item.productionPlanNo ?? <span className="font-sans text-ink-3">-</span>}</Td>
                      <Td>{item.desiredReceiptDate ? fmtDate(item.desiredReceiptDate) : '-'}</Td>
                      <Td align="right" className="font-semibold">
                        {fmtTon(item.requiredTon)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        );
      })}
      <Card>
        <CardHead title="발주 확정" meta={`${chosen.length} / ${allItems.length}개 품목 선택`} />
        <CardBody className="flex-row flex-wrap items-start gap-6">
          <Field label="납기 (입고 예정일)" htmlFor="po-due-date" hint={earliest ? `비우면 고른 요청의 가장 이른 희망 입고일 ${fmtDate(earliest)}` : '비우면 고른 요청의 가장 이른 희망 입고일'}>
            <DateInput id="po-due-date" value={dueDate} onChange={setDueDate} />
          </Field>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-ink-2">만들어질 발주</span>
            <b className="font-semibold">
              {supplierCount}건 · 공급업체 {supplierCount}곳 · 합계 {fmtTon(decSum(chosen.map((i) => i.requiredTon)))}
            </b>
          </div>
        </CardBody>
        <CardFoot>
          <span className="text-cap text-ink-3">{chosen.length === 0 ? '발주할 품목을 하나 이상 골라 주세요' : '요청의 모든 품목을 발주하면 그 구매요청은 발주 완료가 돼요'}</span>
          <Button
            variant="primary"
            icon="check"
            className="ml-auto"
            disabled={!canOrder || chosen.length === 0 || create.isPending}
            title={canOrder ? undefined : permissionNeedText([PERMISSION.PURCHASE_ORDER_CONFIRM])}
            onClick={() => create.mutate({ purchaseRequisitionItemIds: chosen.map((i) => i.id), dueDate })}
          >
            {create.isPending ? '처리하는 중…' : '발주 확정'}
          </Button>
        </CardFoot>
      </Card>
    </div>
  );
}

function PurchaseOrderDetail({ po }: { po: PurchaseOrderView }) {
  const canSeeReceipts = useCanView(PERMISSION.GOODS_RECEIPT_CONFIRM, PERMISSION.PURCHASE_ORDER_CONFIRM);
  const ordered = orderOrderedTon(po);
  const received = orderReceivedTon(po);
  const scheduled = orderScheduledTon(po);
  const receipts = po.items.flatMap((line) => line.goodsReceipts.map((receipt) => ({ ...receipt, itemName: line.itemName, lineNo: line.lineNo })));

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb="발주"
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{po.purchaseOrderNo}</span>
            <PurchaseOrderStatusBadge status={po.purchaseOrderStatus} />
          </span>
        }
        actions={
          canSeeReceipts ? (
            <ButtonLink href={`/goods-receipts?po=${po.id}`} size="sm" variant={po.purchaseOrderStatus === 'RECEIVED' ? 'default' : 'primary'} icon="box">
              {po.purchaseOrderStatus === 'RECEIVED' ? '입고 내역' : '입고 처리'}
            </ButtonLink>
          ) : null
        }
      />
      <p className="-mt-2 text-sm text-ink-2">
        {po.supplierName} · 발주 확정 {fmtDateTime(po.createdAt)} · 납기 {po.dueDate ? fmtDate(po.dueDate) : '-'} · 품목 {po.items.length}개 · 발주 {po.orderedEmployeeName ?? '-'}
      </p>
      <StatBar>
        <Kpi flat label="발주" value={fmtTon(ordered)} />
        <Kpi flat label="입고 누계" value={fmtTon(received)} sub={`발주 대비 ${Math.round(ratioPercent(received, ordered))}%`} />
        <Kpi flat label="입고예정" value={fmtTon(scheduled)} sub="발주 − 입고 누계 (MRP 입고예정)" />
      </StatBar>
      <Card>
        <CardHead title="발주 품목" />
        <CardBody flush>
          <Table>
            <thead>
              <tr>
                <Th align="right">#</Th>
                <Th>원료</Th>
                <Th>연결 구매요청</Th>
                <Th align="right">발주</Th>
                <Th align="right">입고</Th>
                <Th align="right">입고예정</Th>
                <Th>진행</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {po.items.map((line) => (
                <tr key={line.id}>
                  <Td align="right" className="text-ink-3">
                    {line.lineNo}
                  </Td>
                  <Td>
                    {line.itemName} <span className="font-mono text-cap text-ink-3">{line.itemCode}</span>
                  </Td>
                  <Td className="font-mono">{line.purchaseRequisitionNo ?? '-'}</Td>
                  <Td align="right">{fmtTon(line.orderedTon)}</Td>
                  <Td align="right">{fmtTon(line.receivedTon)}</Td>
                  <Td align="right" className="font-semibold">
                    {fmtTon(line.scheduledReceiptTon)}
                  </Td>
                  <Td className="w-40">
                    <Progress value={ratioPercent(line.receivedTon, line.orderedTon)} tone={ratioPercent(line.receivedTon, line.orderedTon) >= 100 ? 'ok' : 'run'} label={`${line.lineNo}번 입고 진행`} />
                  </Td>
                  <Td align="right">
                    {ratioPercent(line.receivedTon, line.orderedTon) >= 100 ? (
                      <span className="text-cap text-ink-3">입고 끝</span>
                    ) : canSeeReceipts ? (
                      <ButtonLink href={`/goods-receipts?po=${po.id}&item=${line.id}`} size="sm">
                        입고 등록
                      </ButtonLink>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td />
                <Td>합계</Td>
                <Td />
                <Td align="right">{fmtTon(ordered)}</Td>
                <Td align="right">{fmtTon(received)}</Td>
                <Td align="right">{fmtTon(scheduled)}</Td>
                <Td />
                <Td />
              </tr>
            </tfoot>
          </Table>
        </CardBody>
      </Card>
      <Card>
        <CardHead
          title="입고 내역"
          meta="입고를 확정하면 원료 LOT이 만들어져요"
          actions={
            canSeeReceipts ? (
              <Link href={`/goods-receipts?po=${po.id}`} className="text-xs text-run hover:underline">
                입고 화면 &gt;
              </Link>
            ) : null
          }
        />
        <CardBody flush>
          {receipts.length === 0 ? (
            <EmptyNote>아직 입고가 없어요</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>입고번호</Th>
                  <Th>원료</Th>
                  <Th>입고일</Th>
                  <Th align="right">입고 톤</Th>
                  <Th>원료 LOT</Th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <Td className="font-mono">{receipt.goodsReceiptNo}</Td>
                    <Td>
                      {receipt.itemName} <span className="text-cap text-ink-3">#{receipt.lineNo}</span>
                    </Td>
                    <Td>{fmtDate(receipt.receiptDate)}</Td>
                    <Td align="right">{fmtTon(receipt.receivedTon)}</Td>
                    <Td>
                      {receipt.lotNo ? (
                        <Link className="font-mono text-run hover:underline" href={`/lots/trace?lot=${encodeURIComponent(receipt.lotNo)}`}>
                          {receipt.lotNo}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
