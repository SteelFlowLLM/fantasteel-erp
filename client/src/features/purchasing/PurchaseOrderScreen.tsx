'use client';

// 발주 (REQ-PUR-003, BP-PUR-01): 승인된 구매요청을 원료의 기본 공급업체별로 묶어 공급업체 1곳당 발주 1건(여러 품목, 발주 품목 1행 = 구매요청 1건).
// 발주는 만들면 바로 확정(CONFIRMED)이고 입고예정에 반영된다(미입고량 = 발주량 − 입고 누계, 계산값). 발주량 = 요청 톤(나눠 발주하지 않음).
// 발주한 구매요청은 '발주 완료'가 된다. 승인 전이면 PUR-002.
// 반대 거래(BP-PUR-02): 입고가 없는 발주는 '발주 취소'(연결 구매요청은 발주 취소), 일부만 입고된 발주는 '잔량 마감'(남은 양은 입고예정에서 빠짐). 둘 다 사유 필수.
// 주소: ?po= 발주 상세, ?pr= 그 구매요청을 골라 둔 발주 작성, ?supplier= 그 공급업체 요청을 골라 둔 발주 작성.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION, PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrderStatus } from '@/codes';
import type { PurchaseOrderCandidateItem, PurchaseOrderView } from '@/api/purchasing';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Kpi, StatBar } from '@/components/Kpi';
import { KvList } from '@/components/KvList';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { Progress } from '@/components/Progress';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MasterGroupTitle, MasterItem, MasterNote, PurchaseOrderStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { ReasonDialog } from '@/features/purchasing/components/ReasonDialog';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { earliestDate, groupBySupplier, plannedPurchaseOrders, ratioPercent, summarizeItemNames, type SupplierGroup } from '@/features/purchasing/lib/purchasingView';
import { useCanUse, useCanView } from '@/hooks/usePermission';
import { useCancelPurchaseOrder, useClosePurchaseOrder, useCreatePurchaseOrders, usePurchaseOrderCandidateItems, usePurchaseOrderList } from '@/hooks/usePurchaseOrders';
import { decCmp, decSum } from '@/lib/decimal';
import { fmtDate, fmtDateTime, fmtMD, fmtNum, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

const STATUS_FILTERS: readonly PurchaseOrderStatus[] = ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];
/** 기본 공급업체가 없는 묶음의 주소 값 */
const NO_SUPPLIER = 'none';

const supplierKey = (supplierId: number | null): string => (supplierId === null ? NO_SUPPLIER : String(supplierId));
const purchaseOrderReceivedTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.receivedTon));
const purchaseOrderOrderedTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.orderedTon));
const purchaseOrderRemainingTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.remainingTon));
const purchaseOrderClosedTon = (po: PurchaseOrderView): string => decSum(po.items.map((i) => i.closedTon));
/** 발주 취소·잔량 마감해 더는 입고하지 않는 발주 */
const isEnded = (po: PurchaseOrderView): boolean => po.purchaseOrderStatus === 'CANCELLED' || po.purchaseOrderStatus === 'CLOSED';
/** 남은 품목 중 가장 이른 입고 예정일 (발주 단위 납기는 ERD에 없다) */
const nextExpectedDate = (po: PurchaseOrderView): string | null =>
  earliestDate(po.items.filter((i) => decCmp(i.remainingTon, 0) > 0).map((i) => i.expectedReceiptDate));

export function PurchaseOrderScreen() {
  const url = useUrlParams();
  const selectedPoId = url.getNumber('po');
  const purchaseRequisitionIdParam = url.getNumber('pr');
  const supplierParam = url.get('supplier');
  const canConfirmPurchaseOrder = useCanUse(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const purchaseOrders = usePurchaseOrderList();
  const candidates = usePurchaseOrderCandidateItems();
  const [status, setStatus] = useState<PurchaseOrderStatus | null>(null);

  const purchaseOrderRows = useMemo(() => purchaseOrders.data ?? [], [purchaseOrders.data]);
  const filteredPurchaseOrders = status === null ? purchaseOrderRows : purchaseOrderRows.filter((po) => po.purchaseOrderStatus === status);
  const groups = useMemo(() => groupBySupplier(candidates.data ?? []), [candidates.data]);
  const selectedPo = selectedPoId !== null ? purchaseOrderRows.find((po) => po.id === selectedPoId) : undefined;
  const writing = selectedPoId === null && (candidates.data?.length ?? 0) > 0;
  // 아무것도 고르지 않았으면 첫 공급업체 묶음을 고른 것으로 본다
  const firstSelectable = groups.find((g) => g.supplierId !== null);
  const activeSupplier = supplierParam ?? (purchaseRequisitionIdParam === null && firstSelectable ? supplierKey(firstSelectable.supplierId) : null);

  return (
    <>
      <MasterPane
        petKey="card:purchaseOrders.list"
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">발주</b>
              <span className="text-xs text-ink-3">{purchaseOrderRows.length}건</span>
              <ButtonLink href="/goods-receipts" size="sm" icon="box" className="ml-auto">
                입고
              </ButtonLink>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={status === null} onClick={() => setStatus(null)} data-pet-term="전체">
                전체 <b>{purchaseOrderRows.length}</b>
              </Chip>
              {STATUS_FILTERS.map((value) => (
                <Chip key={value} on={status === value} onClick={() => setStatus(status === value ? null : value)} data-pet-term={PURCHASE_ORDER_STATUS_LABEL[value]}>
                  {PURCHASE_ORDER_STATUS_LABEL[value]} <b>{purchaseOrderRows.filter((po) => po.purchaseOrderStatus === value).length}</b>
                </Chip>
              ))}
            </div>
            {canConfirmPurchaseOrder ? null : <ReadOnlyHint permissions={[PERMISSION.PURCHASE_ORDER_CONFIRM]} />}
          </>
        }
      >
        <MasterGroupTitle title="발주할 구매요청 (승인됨)" meta={candidates.data ? `${candidates.data.length}개 품목` : undefined} />
        <QueryBoundary query={candidates} loadingLabel="발주할 구매요청을 불러오는 중…">
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
                    petItem="supplier"
                    petItemTitle={group.supplierName ?? '기본 공급업체 없음'}
                  >
                    <span className="flex items-center gap-2">
                      <b className="text-sm font-semibold">{group.supplierName ?? '기본 공급업체 없음'}</b>
                      <span data-pet-field="발주 대기" className="ml-auto text-cap text-ink-3">
                        발주 대기 {group.items.length}
                      </span>
                    </span>
                    <span data-pet-field="원료 · 요청 톤" className="flex items-center gap-1.5 text-cap text-ink-3">
                      {summarizeItemNames(group.items)} · {fmtTon(decSum(group.items.map((i) => i.requestedTon)))}
                    </span>
                  </MasterItem>
                ))}
              </>
            )
          }
        </QueryBoundary>
        <MasterGroupTitle title="발주 내역" meta={`${filteredPurchaseOrders.length}건`} />
        <QueryBoundary query={purchaseOrders} loadingLabel="발주를 불러오는 중…">
          {() =>
            filteredPurchaseOrders.length === 0 ? (
              <EmptyNote>{purchaseOrderRows.length === 0 ? '아직 발주가 없어요' : '조건에 맞는 발주가 없어요'}</EmptyNote>
            ) : (
              <>
                {filteredPurchaseOrders.map((po) => {
                  const ordered = purchaseOrderOrderedTon(po);
                  const received = purchaseOrderReceivedTon(po);
                  return (
                    <MasterItem
                      key={po.id}
                      selected={po.id === selectedPoId}
                      onClick={() => url.set({ po: po.id, pr: null, supplier: null })}
                      petItem="purchaseOrder"
                      petItemTitle={po.purchaseOrderNo}
                    >
                      <span className="flex items-center gap-2">
                        <b className="font-mono text-sm font-semibold">{po.purchaseOrderNo}</b>
                        <PurchaseOrderStatusBadge status={po.purchaseOrderStatus} />
                        <span data-pet-field="입고 예정일" className="ml-auto text-cap text-ink-3">
                          {nextExpectedDate(po) ? `입고 예정 ${fmtMD(nextExpectedDate(po) ?? '')}` : ''}
                        </span>
                      </span>
                      <span data-pet-field="공급업체" className="text-sm text-ink">
                        {po.supplierName} <span className="text-ink-3">· {summarizeItemNames(po.items)}</span>
                      </span>
                      <span className="flex items-center gap-2 text-cap text-ink-3">
                        <span data-pet-field="입고 / 발주" className="whitespace-nowrap">
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
        ) : selectedPoId !== null && purchaseOrders.data ? (
          <StateView kind="empty" title="발주를 찾을 수 없어요" />
        ) : writing ? (
          <PurchaseOrderForm
            key={`${purchaseRequisitionIdParam ?? ''}-${activeSupplier ?? ''}`}
            groups={groups}
            initialIds={(candidates.data ?? [])
              .filter((i) => (purchaseRequisitionIdParam !== null ? i.id === purchaseRequisitionIdParam : supplierKey(i.supplierId) === activeSupplier))
              .filter((i) => i.supplierId !== null)
              .map((i) => i.id)}
            canConfirmPurchaseOrder={canConfirmPurchaseOrder}
            onDone={(created) => url.set({ po: created[0]?.id ?? null, pr: null, supplier: null })}
          />
        ) : candidates.data && purchaseOrders.data ? (
          <StateView
            kind="empty"
            icon="building"
            title={purchaseOrderRows.length === 0 ? '발주할 구매요청도, 발주 내역도 없어요' : '발주할 품목이 남아 있지 않아요'}
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

export function PurchaseOrderForm({
  groups,
  initialIds,
  canConfirmPurchaseOrder,
  onDone,
}: {
  groups: SupplierGroup<PurchaseOrderCandidateItem>[];
  initialIds: number[];
  canConfirmPurchaseOrder: boolean;
  onDone: (created: PurchaseOrderView[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialIds));
  const [expectedReceiptDate, setExpectedReceiptDate] = useState('');
  const create = useCreatePurchaseOrders({
    success: (created) => `${created.map((po) => po.purchaseOrderNo).join(', ')} 발주를 확정했어요. 입고예정에 반영돼요`,
    onSuccess: (created) => onDone(created),
  });

  const allItems = groups.flatMap((g) => g.items);
  const chosen = allItems.filter((i) => selected.has(i.id));
  // 공급업체 1곳당 발주 1건. 입고 예정일을 비우면 품목마다 자기 희망 입고일이 들어간다(서버 규칙).
  const planned = plannedPurchaseOrders(chosen, expectedReceiptDate);
  const orders = groupBySupplier(chosen).flatMap((group) =>
    group.supplierId === null
      ? []
      : [{ supplierId: group.supplierId, items: group.items.map((i) => ({ purchaseRequisitionId: i.id, orderedTon: i.requestedTon, expectedReceiptDate })) }],
  );
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
        고른 구매요청은 원료의 <b>기본 공급업체</b>별로 묶여 공급업체 1곳당 발주 1건이 돼요. 발주량은 요청 톤 그대로이고, 발주는 만들면 바로 확정되어 입고예정에 반영돼요.
      </Banner>
      {groups.map((group) => {
        const selectable = group.supplierId !== null;
        const groupIds = group.items.map((i) => i.id);
        const allOn = selectable && groupIds.every((id) => selected.has(id));
        return (
          <Card key={supplierKey(group.supplierId)} petKey="card:purchaseOrders.supplierGroup">
            <CardHead
              title={group.supplierName ?? '기본 공급업체 없음'}
              meta={`승인된 구매요청 ${group.items.length}건 · 미발주 ${fmtTon(decSum(group.items.map((i) => i.requestedTon)))}`}
              actions={
                selectable ? (
                  <label data-pet-term="전체 선택" className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      aria-label={`${group.supplierName ?? '공급업체'} 품목 전체 선택`}
                      checked={allOn}
                      onChange={(event) => setSelected((current) => new Set([...[...current].filter((id) => !groupIds.includes(id)), ...(event.target.checked ? groupIds : [])]))}
                    />
                    전체 선택
                  </label>
                ) : null
              }
            />
            {/* 글자를 키우면 표가 오른쪽 칸보다 넓어져 카드 밖으로 삐져나오므로 카드 안에서 가로로 넘긴다 */}
            <CardBody flush className="overflow-x-auto">
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
                    <tr key={item.id} data-selected={selected.has(item.id)} data-pet-item="purchaseRequisition" data-pet-item-title={item.purchaseRequisitionNo}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`${item.purchaseRequisitionNo} 고르기`}
                          disabled={!selectable}
                          checked={selected.has(item.id)}
                          onChange={(event) => toggle(item.id, event.target.checked)}
                        />
                      </Td>
                      <Td>
                        <Link className="font-mono text-run hover:underline" href={`/purchase-requisitions/${item.id}`}>
                          {item.purchaseRequisitionNo}
                        </Link>
                      </Td>
                      <Td>
                        {item.itemName} <span className="font-mono text-cap text-ink-3">{item.itemCode}</span>
                      </Td>
                      <Td className="font-mono">{item.productionPlanNo ?? <span className="font-sans text-ink-3">-</span>}</Td>
                      <Td>{item.desiredReceiptDate ? fmtDate(item.desiredReceiptDate) : '-'}</Td>
                      <Td align="right" className="font-semibold">
                        {fmtTon(item.requestedTon)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        );
      })}
      <Card petKey="card:purchaseOrders.confirm">
        <CardHead title="발주 확정" meta={`${chosen.length} / ${allItems.length}개 품목 선택`} />
        <CardBody className="flex-row flex-wrap items-start gap-6">
          <Field label={<span data-pet-term="입고 예정일">입고 예정일</span>} htmlFor="po-expected-date" hint="고른 품목 모두에 들어가요. 비우면 품목마다 구매요청의 희망 입고일이 들어가요">
            <DateInput id="po-expected-date" value={expectedReceiptDate} onChange={setExpectedReceiptDate} />
          </Field>
          <div className="flex flex-col gap-1 text-sm">
            <span data-pet-term="만들어질 발주" className="text-xs font-medium text-ink-2">
              만들어질 발주
            </span>
            <b className="font-semibold">
              {planned.length}건 · 공급업체 {planned.length}곳 · 합계 {fmtTon(decSum(chosen.map((i) => i.requestedTon)))}
            </b>
            {planned.map((purchaseOrder) => (
              <span
                key={purchaseOrder.supplierId}
                data-pet-item="purchaseOrder"
                data-pet-item-title={`만들어질 발주 · ${purchaseOrder.supplierName ?? '-'}`}
                className="text-cap text-ink-2"
              >
                {purchaseOrder.supplierName ?? '-'} · 입고 예정 {purchaseOrder.expectedReceiptDate ? fmtDate(purchaseOrder.expectedReceiptDate) : '없음'} · 품목 {purchaseOrder.itemCount}개 · {fmtTon(purchaseOrder.totalTon)}
              </span>
            ))}
          </div>
        </CardBody>
        <CardFoot>
          <span className="text-cap text-ink-3">{chosen.length === 0 ? '발주할 구매요청을 하나 이상 골라 주세요' : '발주한 구매요청은 발주 완료가 돼요'}</span>
          <Button
            variant="primary"
            icon="check"
            className="ml-auto"
            disabled={!canConfirmPurchaseOrder || chosen.length === 0 || create.isPending}
            title={canConfirmPurchaseOrder ? undefined : permissionNeedText([PERMISSION.PURCHASE_ORDER_CONFIRM])}
            onClick={() => create.mutate(orders)}
          >
            {create.isPending ? '처리하는 중…' : '발주 확정'}
          </Button>
        </CardFoot>
      </Card>
    </div>
  );
}

type EndAction = 'cancel' | 'close';

function PurchaseOrderDetail({ po }: { po: PurchaseOrderView }) {
  const canSeeReceipts = useCanView(PERMISSION.GOODS_RECEIPT_CONFIRM, PERMISSION.PURCHASE_ORDER_CONFIRM);
  const canConfirmPurchaseOrder = useCanUse(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const ordered = purchaseOrderOrderedTon(po);
  const received = purchaseOrderReceivedTon(po);
  const remaining = purchaseOrderRemainingTon(po);
  const closed = purchaseOrderClosedTon(po);
  const ended = isEnded(po);
  const receipts = po.items.flatMap((line) => line.goodsReceipts.map((receipt) => ({ ...receipt, itemName: line.itemName, purchaseRequisitionNo: line.purchaseRequisitionNo })));
  const [acting, setActing] = useState<EndAction | null>(null);
  const done = { onSuccess: () => setActing(null) };
  const cancel = useCancelPurchaseOrder({ success: (result) => `${result.purchaseOrderNo} 발주를 취소했어요. 연결 구매요청은 발주 취소가 됐어요`, ...done });
  const close = useClosePurchaseOrder({ success: (result) => `${result.purchaseOrderNo} 남은 양을 잔량 마감했어요. 입고예정에서 빠져요`, ...done });
  const action = acting === 'cancel' ? cancel : close;
  // 입고가 없으면 발주 취소, 일부만 들어왔으면 잔량 마감 (서버 PUR-004·005와 같은 조건)
  const endAction: EndAction | null = po.purchaseOrderStatus === 'CONFIRMED' ? 'cancel' : po.purchaseOrderStatus === 'PARTIALLY_RECEIVED' ? 'close' : null;

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
          <>
            {endAction ? (
              <Button
                size="sm"
                variant="danger-outline"
                icon="x"
                disabled={!canConfirmPurchaseOrder}
                title={canConfirmPurchaseOrder ? undefined : permissionNeedText([PERMISSION.PURCHASE_ORDER_CONFIRM])}
                onClick={() => setActing(endAction)}
              >
                {endAction === 'cancel' ? '발주 취소' : '잔량 마감'}
              </Button>
            ) : null}
            {canSeeReceipts ? (
              <ButtonLink href={`/goods-receipts?po=${po.id}`} size="sm" variant={po.purchaseOrderStatus === 'RECEIVED' || ended ? 'default' : 'primary'} icon="box">
                {po.purchaseOrderStatus === 'RECEIVED' || ended ? '입고 내역' : '입고 처리'}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <p className="-mt-2 text-sm text-ink-2">
        {po.supplierName} · 발주 확정 {fmtDateTime(po.createdAt)} · 품목 {po.items.length}개 · 발주 {po.orderedEmployeeName ?? '-'}
      </p>
      {ended ? (
        <Banner tone="wait">
          <b>{po.purchaseOrderStatus === 'CANCELLED' ? '발주 취소' : '잔량 마감'}</b>
          {po.statusChange ? ` · ${po.statusChange.employeeName ?? '-'} ${fmtDateTime(po.statusChange.at)}` : ''} · 사유 {po.statusChange?.reason ?? '-'} ·{' '}
          {po.purchaseOrderStatus === 'CANCELLED' ? '연결 구매요청은 발주 취소가 됐고, 같은 원료가 필요하면 새로 요청해요' : `남은 ${fmtTon(closed)}은 입고예정에서 빠졌어요`}
        </Banner>
      ) : null}
      <StatBar petKey="card:purchaseOrders.summary">
        <Kpi flat label="발주" value={fmtNum(ordered, 3)} unit="t" />
        <Kpi flat label="입고 누계" value={fmtNum(received, 3)} unit="t" sub={`발주 대비 ${Math.round(ratioPercent(received, ordered))}%`} />
        {ended ? (
          <Kpi flat label={po.purchaseOrderStatus === 'CANCELLED' ? '취소한 양' : '마감한 잔량'} value={fmtNum(closed, 3)} unit="t" sub="입고예정에서 빠졌어요 · 더는 입고하지 않아요" />
        ) : (
          <Kpi flat label="입고예정" value={fmtNum(remaining, 3)} unit="t" sub="발주 − 입고 누계 (MRP 입고예정)" />
        )}
      </StatBar>
      <Card petKey="card:purchaseOrders.items">
        <CardHead title="발주 품목" />
        {/* 글자를 키우면 표가 오른쪽 칸보다 넓어져 카드 밖으로 삐져나오므로 카드 안에서 가로로 넘긴다 (아래 표들도 같은 이유) */}
        <CardBody flush className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>원료</Th>
                <Th>연결 구매요청</Th>
                <Th>입고 예정일</Th>
                <Th align="right">발주</Th>
                <Th align="right">입고</Th>
                <Th align="right">입고예정</Th>
                <Th>진행</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {po.items.map((line) => (
                <tr key={line.id} data-pet-item="purchaseOrderItem" data-pet-item-title={`${po.purchaseOrderNo} ${line.purchaseRequisitionNo ?? line.itemName}`}>
                  <Td>
                    {line.itemName} <span className="font-mono text-cap text-ink-3">{line.itemCode}</span>
                  </Td>
                  <Td className="font-mono">{line.purchaseRequisitionNo ?? '-'}</Td>
                  <Td>{line.expectedReceiptDate ? fmtDate(line.expectedReceiptDate) : '-'}</Td>
                  <Td align="right">{fmtTon(line.orderedTon)}</Td>
                  <Td align="right">{fmtTon(line.receivedTon)}</Td>
                  <Td align="right" className="font-semibold">
                    {fmtTon(line.remainingTon)}
                  </Td>
                  <Td className="w-40">
                    <Progress value={ratioPercent(line.receivedTon, line.orderedTon)} tone={ratioPercent(line.receivedTon, line.orderedTon) >= 100 ? 'ok' : 'run'} label={`${line.purchaseRequisitionNo ?? line.itemName} 입고 진행`} />
                  </Td>
                  <Td align="right">
                    {ended ? (
                      <span className="text-cap text-ink-3">{po.purchaseOrderStatus === 'CANCELLED' ? '발주 취소' : `잔량 마감 ${fmtTon(line.closedTon)}`}</span>
                    ) : ratioPercent(line.receivedTon, line.orderedTon) >= 100 ? (
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
                <Td>합계</Td>
                <Td />
                <Td />
                <Td align="right">{fmtTon(ordered)}</Td>
                <Td align="right">{fmtTon(received)}</Td>
                <Td align="right">{fmtTon(remaining)}</Td>
                <Td />
                <Td />
              </tr>
            </tfoot>
          </Table>
        </CardBody>
      </Card>
      <Card petKey="card:purchaseOrders.receipts">
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
        <CardBody flush className="overflow-x-auto">
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
                  <tr key={receipt.id} data-pet-item="goodsReceipt" data-pet-item-title={receipt.goodsReceiptNo}>
                    <Td className="font-mono">
                      {receipt.goodsReceiptNo}{' '}
                      {receipt.reversedGoodsReceiptNo ? (
                        <Badge tone="neutral">입고 취소 · {receipt.reversedGoodsReceiptNo}</Badge>
                      ) : receipt.reversalGoodsReceiptNo ? (
                        <Badge tone="neutral">취소됨</Badge>
                      ) : null}
                    </Td>
                    <Td>
                      {receipt.itemName} <span className="font-mono text-cap text-ink-3">{receipt.purchaseRequisitionNo}</span>
                    </Td>
                    <Td>{fmtDate(receipt.receivedDate)}</Td>
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
      {acting ? (
        <ReasonDialog
          id={`po-${acting}-${po.id}`}
          title={acting === 'cancel' ? '발주를 취소할까요?' : '남은 양을 잔량 마감할까요?'}
          confirmLabel={acting === 'cancel' ? '발주 취소' : '잔량 마감'}
          reasonLabel={acting === 'cancel' ? '취소 사유' : '마감 사유'}
          pending={action.isPending}
          error={action.error}
          onCancel={() => {
            setActing(null);
            action.reset();
          }}
          onConfirm={(reason) => action.mutate({ purchaseOrderId: po.id, reason })}
        >
          <KvList
            items={[
              { label: '발주', value: `${po.purchaseOrderNo} · ${po.supplierName}` },
              { label: '발주 / 입고', value: `${fmtTon(ordered)} / ${fmtTon(received)}` },
              { label: acting === 'cancel' ? '취소할 양' : '마감할 잔량', value: fmtTon(remaining) },
            ]}
          />
          <p className="text-cap text-ink-3">
            {acting === 'cancel'
              ? '취소하면 되돌릴 수 없어요. 연결 구매요청은 발주 취소가 되고, 같은 원료가 필요하면 새로 구매요청해요.'
              : '마감하면 되돌릴 수 없어요. 남은 양은 입고예정(MRP)에서 빠지고 이 발주로는 더 입고하지 않아요.'}
          </p>
        </ReasonDialog>
      ) : null}
    </div>
  );
}
