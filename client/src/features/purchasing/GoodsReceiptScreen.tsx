'use client';

// 입고 (REQ-PUR-004, REQ-LOT-003·004, BP-PUR-02): 발주 품목 줄을 골라 입고 톤·입고일을 넣으면 등록이 곧 확정이다(상태값·수정 없음).
// 미입고량을 넘으면 PUR-003, 입고일은 오늘까지. 야드는 원료의 기본 야드로 자동 지정한다(야드 선택·비고 없음, PLAN 7장).
// 입고 1건마다 원료 LOT(RM-원료코드-YYMMDD-NNN, 잔량 = 입고량)이 생기고 발주 입고 누계·입고예정·상태가 바뀐다.
// 입고 취소(BP-PUR-02 반대 거래): 원료 LOT을 쓰기 전에만, 사유와 함께. 원래 입고는 남고 음수 입고 줄이 더해진다(LOT은 입고 취소·잔량 0).
// 발주 취소·잔량 마감한 발주는 더 입고하지 않는다.
// 주소: ?item= 발주 품목 줄, ?po= 그 발주의 첫 미입고 줄.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION } from '@/codes';
import { ApiError, InputError } from '@/api/errors';
import type { GoodsReceiptResult, GoodsReceiptView, ReceiptLine } from '@/api/goodsReceipts';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DateInput } from '@/components/DateInput';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { Kpi, StatBar } from '@/components/Kpi';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { Progress } from '@/components/Progress';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { MasterGroupTitle, MasterItem, MasterNote, PurchaseOrderStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { ReasonDialog } from '@/features/purchasing/components/ReasonDialog';
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { isOverdue, ratioPercent, rawMaterialLotNoPattern, receiptRowLabel, trimTonText } from '@/features/purchasing/lib/purchasingView';
import { useCancelGoodsReceipt, useGoodsReceiptList, useReceiptLines, useReceiveGoods } from '@/hooks/useGoodsReceipts';
import { useCanUse, useCanView } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtDate, fmtMD, fmtMDHM, fmtNum, fmtTon, todayStr } from '@/lib/format';
import { withIGa } from '@/lib/josa';
import { permissionNeedText } from '@/lib/permissions';
import { errorMessageOf } from '@/stores/useToastStore';

type LineTab = 'open' | 'all';
type HistoryScope = 'line' | 'all';

const RECENT_COUNT = 5;
const lotHref = (lotNo: string): string => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;
/** 입고 줄 상태 글: 닫힌 발주는 상태 이름, 다 받았으면 입고 끝 */
const lineDoneText = (line: ReceiptLine): string | null =>
  line.isClosed ? (line.purchaseOrderStatus === 'CANCELLED' ? '발주 취소' : `잔량 마감 ${fmtTon(line.closedTon)}`) : line.isFullyReceived ? '입고 끝' : null;

export function GoodsReceiptScreen() {
  const url = useUrlParams();
  const itemParam = url.getNumber('item');
  const poParam = url.getNumber('po');
  const today = todayStr();
  const canReceive = useCanUse(PERMISSION.GOODS_RECEIPT_CONFIRM);
  const canSeeOrders = useCanView(PERMISSION.PURCHASE_ORDER_CONFIRM);
  // 입고예정은 발주 목록(GET /purchase-orders, 발주 확정 조회 권한)에서 만든다. 입고만 조회하는 역할(물류)은 부르면 403이라 부르지 않는다
  const lines = useReceiptLines(canSeeOrders);
  const receipts = useGoodsReceiptList(true, canSeeOrders);
  const [tab, setTab] = useState<LineTab>('open');
  const [keyword, setKeyword] = useState('');

  const allLines = useMemo(() => lines.data ?? [], [lines.data]);
  const openLines = allLines.filter((l) => !l.isFullyReceived);
  const word = keyword.trim().toLowerCase();
  const shown = (tab === 'open' ? openLines : allLines).filter(
    (l) => word === '' || l.purchaseOrderNo.toLowerCase().includes(word) || l.itemName.includes(word) || l.itemCode.toLowerCase().includes(word) || l.supplierName.includes(word),
  );
  const active =
    (itemParam !== null ? allLines.find((l) => l.purchaseOrderItemId === itemParam) : undefined) ??
    (poParam !== null ? (allLines.find((l) => l.purchaseOrderId === poParam && !l.isFullyReceived) ?? allLines.find((l) => l.purchaseOrderId === poParam)) : undefined) ??
    (itemParam === null && poParam === null ? openLines[0] : undefined);

  return (
    <>
      <MasterPane
        petKey="card:goodsReceipts.list"
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">입고예정</b>
              {canSeeOrders ? <span className="text-xs text-ink-3">{openLines.length}건</span> : null}
              {canSeeOrders ? (
                <ButtonLink href="/purchase-orders" size="sm" icon="building" className="ml-auto">
                  발주
                </ButtonLink>
              ) : null}
            </div>
            {canSeeOrders ? (
              <>
                <Input leadingIcon="search" placeholder="발주번호·원료·공급업체 검색" value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="입고예정 검색" />
                <div className="flex gap-1.5">
                  <Chip on={tab === 'open'} onClick={() => setTab('open')} data-pet-term="입고예정">
                    입고예정 <b>{openLines.length}</b>
                  </Chip>
                  <Chip on={tab === 'all'} onClick={() => setTab('all')} data-pet-term="전체">
                    전체 <b>{allLines.length}</b>
                  </Chip>
                </div>
              </>
            ) : null}
            {canReceive ? null : <ReadOnlyHint permissions={[PERMISSION.GOODS_RECEIPT_CONFIRM]} />}
          </>
        }
      >
        {canSeeOrders ? (
          <QueryBoundary query={lines} loadingLabel="입고예정을 불러오는 중…">
            {() =>
              shown.length === 0 ? (
                <EmptyNote>{tab === 'open' ? '입고예정인 발주가 없어요' : '발주가 없어요'}</EmptyNote>
              ) : (
                <>
                  {shown.map((line) => {
                    const overdue = isOverdue(line.expectedReceiptDate, today, line.remainingTon);
                    return (
                      <MasterItem
                        key={line.purchaseOrderItemId}
                        selected={line.purchaseOrderItemId === active?.purchaseOrderItemId}
                        label={receiptRowLabel(line)}
                        onClick={() => url.set({ item: line.purchaseOrderItemId, po: null })}
                        petItem="purchaseOrderItem"
                        petItemTitle={`${line.purchaseOrderNo} ${line.purchaseRequisitionNo ?? line.itemName}`}
                      >
                        <span className="flex items-center gap-2">
                          <b className="font-mono text-sm font-semibold">
                            {line.purchaseOrderNo} <span className="text-cap font-medium text-ink-3">{line.purchaseRequisitionNo}</span>
                          </b>
                          <PurchaseOrderStatusBadge status={line.purchaseOrderStatus} />
                          <span data-pet-field="입고 예정일" className={cn('ml-auto text-cap', overdue ? 'font-semibold text-danger' : 'text-ink-3')}>
                            {line.expectedReceiptDate ? `입고 예정 ${fmtMD(line.expectedReceiptDate)}` : ''}
                          </span>
                        </span>
                        <span data-pet-field="원료 · 공급업체" className="text-sm text-ink">
                          {line.itemName} <span className="text-ink-3">· {line.supplierName}</span>
                        </span>
                        <span className="flex items-center gap-2 text-cap text-ink-3">
                          <span data-pet-field="입고예정" className="whitespace-nowrap">{lineDoneText(line) ?? `입고예정 ${fmtTon(line.remainingTon)}`}</span>
                          <Progress value={ratioPercent(line.receivedTon, line.orderedTon)} tone={line.isFullyReceived ? 'ok' : 'run'} showLabel={false} label="입고 진행" className="flex-1" />
                        </span>
                      </MasterItem>
                    );
                  })}
                </>
              )
            }
          </QueryBoundary>
        ) : (
          <EmptyNote>입고예정은 발주 조회 권한이 있어야 보여요 · 아래 최근 입고에서 입고 내역과 원료 LOT을 볼 수 있어요</EmptyNote>
        )}
        <MasterGroupTitle title="최근 입고" />
        <QueryBoundary query={receipts} loadingLabel="입고 내역을 불러오는 중…">
          {(data) =>
            data.length === 0 ? (
              <EmptyNote>확정된 입고가 없어요</EmptyNote>
            ) : (
              <ul>
                {data.slice(0, RECENT_COUNT).map((receipt) => (
                  <li
                    key={receipt.id}
                    data-pet-item="goodsReceipt"
                    data-pet-item-title={receipt.goodsReceiptNo}
                    className="flex flex-col gap-0.5 border-b border-line px-4 py-2 text-cap text-ink-3"
                  >
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <b className="font-mono font-semibold">{receipt.goodsReceiptNo}</b>
                      {receipt.reversedGoodsReceiptNo ? <Badge tone="neutral">입고 취소</Badge> : receipt.reversalGoodsReceiptNo ? <Badge tone="neutral">취소됨</Badge> : null}
                      <span data-pet-field="입고 톤" className="ml-auto tabular-nums">
                        {fmtTon(receipt.receivedTon)}
                      </span>
                    </span>
                    <span data-pet-field="원료 · 공급업체 · 입고일">
                      {[receipt.itemName, receipt.supplierName, fmtDate(receipt.receivedDate)].filter(Boolean).join(' · ')}
                    </span>
                    {receipt.lotNo ? (
                      <Link className="font-mono text-run hover:underline" href={lotHref(receipt.lotNo)}>
                        {receipt.lotNo}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
        <MasterNote>입고 등록이 곧 입고 확정이에요. 원료 LOT이 바로 만들어지고 고칠 수 없어요. 잘못 받은 입고는 LOT을 쓰기 전에 입고 취소로 되돌려요. 입고 검사는 하지 않아요.</MasterNote>
      </MasterPane>
      <PageMain>
        {active ? (
          <ReceiptWork
            key={active.purchaseOrderItemId}
            line={active}
            receipts={receipts.data ?? []}
            endedPurchaseOrderIds={new Set(allLines.filter((l) => l.isClosed).map((l) => l.purchaseOrderId))}
            canReceive={canReceive}
            canSeeOrders={canSeeOrders}
            onPin={() => url.set({ item: active.purchaseOrderItemId, po: null })}
          />
        ) : !canSeeOrders ? (
          <StateView kind="empty" icon="box" title="입고 내역을 보는 화면이에요" text="입고예정·입고 확정은 구매 담당이 해요. 왼쪽 최근 입고에서 원료 LOT을 누르면 LOT 추적으로 볼 수 있어요" />
        ) : lines.data ? (
          <StateView
            kind="empty"
            icon="box"
            title={itemParam !== null || poParam !== null ? '발주 품목을 찾을 수 없어요' : '입고할 발주가 없어요'}
            text="발주를 확정하면 미입고량이 입고예정으로 여기에 올라와요"
            actions={
              canSeeOrders ? (
                <ButtonLink href="/purchase-orders" size="sm" icon="building">
                  발주 화면
                </ButtonLink>
              ) : null
            }
          />
        ) : null}
      </PageMain>
    </>
  );
}

function ReceiptWork({
  line,
  receipts,
  endedPurchaseOrderIds,
  canReceive,
  canSeeOrders,
  onPin,
}: {
  line: ReceiptLine;
  receipts: GoodsReceiptView[];
  /** 발주 취소·잔량 마감한 발주 (그 발주의 입고는 취소하지 않는다, PUR-007) */
  endedPurchaseOrderIds: ReadonlySet<number>;
  canReceive: boolean;
  canSeeOrders: boolean;
  /** 확정할 때 이 줄을 주소에 고정한다 (모두 들어와 입고예정 목록에서 빠져도 결과를 계속 보이게) */
  onPin: () => void;
}) {
  const [receivedTon, setReceivedTon] = useState(() => trimTonText(line.remainingTon));
  const [receivedDate, setReceivedDate] = useState(() => todayStr());
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<GoodsReceiptResult | null>(null);
  const [scope, setScope] = useState<HistoryScope>('line');
  const [cancelling, setCancelling] = useState<GoodsReceiptView | null>(null);
  const cancelReceipt = useCancelGoodsReceipt({
    success: (reversal) => `${reversal.reversedGoodsReceiptNo ?? ''} 입고를 취소했어요. 원료 LOT은 입고 취소가 되고 입고예정이 되돌아와요`,
    onSuccess: () => {
      setCancelling(null);
      setDone(null);
    },
  });
  // 취소할 수 있어 보이는 입고: 원래 입고이고 아직 취소하지 않았으며 닫힌 발주가 아님 (LOT을 썼는지는 서버가 본다, PUR-006)
  const cancellable = (receipt: GoodsReceiptView) => receipt.reversedGoodsReceiptId === null && receipt.reversalGoodsReceiptNo === null && receipt.lotNo !== null && !endedPurchaseOrderIds.has(receipt.purchaseOrderId);

  const receive = useReceiveGoods({
    success: (result) => `입고를 확정했어요. 원료 LOT ${withIGa(result.lotNo)} 만들어졌어요`,
    onSuccess: (result) => {
      setDone(result);
      setConfirming(false);
      setFieldErrors({});
      setFailure(null);
      setReceivedTon(trimTonText(result.lineRemainingTon));
    },
    onError: (error) => {
      setConfirming(false);
      if (error instanceof InputError) {
        setFieldErrors(error.fieldErrors);
        setFailure(Object.keys(error.fieldErrors).length === 0 ? error.message : null);
      } else {
        setFieldErrors({});
        setFailure(error instanceof ApiError && error.code === 'PUR-003' ? `미입고량(${fmtTon(line.remainingTon)})보다 많이 입고할 수 없어요 · ${errorMessageOf(error)}` : errorMessageOf(error));
      }
    },
  });

  const history = scope === 'line' ? receipts.filter((r) => r.purchaseOrderItemId === line.purchaseOrderItemId) : receipts;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb="입고"
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{line.purchaseOrderNo}</span>
            <span className="font-mono text-lg font-medium text-ink-3">{line.purchaseRequisitionNo}</span>
            <PurchaseOrderStatusBadge status={line.purchaseOrderStatus} />
          </span>
        }
        actions={
          <>
            {canSeeOrders ? (
              <ButtonLink href={`/purchase-orders?po=${line.purchaseOrderId}`} size="sm" icon="chevron-left">
                발주
              </ButtonLink>
            ) : null}
            <ButtonLink href="/lots/trace" size="sm" icon="trace">
              LOT 추적
            </ButtonLink>
          </>
        }
      />
      <p className="-mt-2 text-sm text-ink-2">
        {line.itemName} <span className="font-mono text-cap text-ink-3">{line.itemCode}</span> · {line.supplierName} · 입고 예정 {line.expectedReceiptDate ? fmtDate(line.expectedReceiptDate) : '-'} · 구매요청{' '}
        <span className="font-mono">{line.purchaseRequisitionNo ?? '-'}</span>
      </p>
      <StatBar petKey="card:goodsReceipts.summary">
        <Kpi flat label="발주" value={fmtNum(line.orderedTon, 3)} unit="t" />
        <Kpi flat label="입고 누계" value={fmtNum(line.receivedTon, 3)} unit="t" sub={`발주 대비 ${Math.round(ratioPercent(line.receivedTon, line.orderedTon))}%`} />
        {line.isClosed ? (
          <Kpi flat label={line.purchaseOrderStatus === 'CANCELLED' ? '취소한 양' : '마감한 잔량'} value={fmtNum(line.closedTon, 3)} unit="t" sub="입고예정에서 빠졌어요 · 더는 입고하지 않아요" />
        ) : (
          <Kpi flat label="입고예정" value={fmtNum(line.remainingTon, 3)} unit="t" sub={line.isFullyReceived ? '입고 끝' : '발주 − 입고 누계 · 나눠서 입고할 수 있어요'} />
        )}
      </StatBar>

      {done ? (
        <Banner tone="ok">
          <span data-pet-item="goodsReceipt" data-pet-item-title={done.goodsReceiptNo}>
            <b>입고 확정 완료</b> · {done.goodsReceiptNo} · 원료 LOT{' '}
            <Link className="font-mono font-semibold underline" href={lotHref(done.lotNo)}>
              {done.lotNo}
            </Link>{' '}
            · {line.itemName} {fmtTon(done.receivedTon)} · {done.yardName ?? '야드 미지정'} · 잔량 {fmtTon(done.receivedTon)} · 발주 품목 입고 누계 {fmtTon(done.lineReceivedTon)} · 입고예정{' '}
            {fmtTon(done.lineRemainingTon)}
          </span>
        </Banner>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
        <Card petKey="card:goodsReceipts.form">
          <CardHead title="입고 등록" meta="등록하면 바로 확정돼요" />
          {line.isClosed ? (
            <CardBody>
              <EmptyNote>{line.purchaseOrderStatus === 'CANCELLED' ? '취소한 발주라 입고하지 않아요' : '잔량 마감한 발주라 더는 입고하지 않아요'}</EmptyNote>
            </CardBody>
          ) : line.isFullyReceived ? (
            <CardBody>
              <EmptyNote>이 발주 품목은 모두 입고했어요</EmptyNote>
            </CardBody>
          ) : (
            <>
              <CardBody className="flex-row flex-wrap items-start gap-4">
                {failure ? <Banner tone="danger" className="w-full">{failure}</Banner> : null}
                <Field label={<span data-pet-term="입고 톤">입고 톤</span>} required htmlFor="gr-ton" error={fieldErrors.receivedTon ?? null} hint="미입고량 이하 · 소수 3자리까지">
                  <Input
                    id="gr-ton"
                    className="w-[160px]"
                    numeric
                    inputMode="decimal"
                    suffix="t"
                    placeholder="0.000"
                    value={receivedTon}
                    invalid={Boolean(fieldErrors.receivedTon)}
                    disabled={!canReceive}
                    onChange={(event) => setReceivedTon(event.target.value)}
                  />
                </Field>
                <Field label={<span data-pet-term="입고일">입고일</span>} required htmlFor="gr-date" error={fieldErrors.receivedDate ?? null} hint="오늘까지 · 원료 LOT 번호의 날짜가 돼요">
                  <DateInput id="gr-date" value={receivedDate} onChange={setReceivedDate} invalid={Boolean(fieldErrors.receivedDate)} disabled={!canReceive} />
                </Field>
                <Field label={<span data-pet-term="야드">야드</span>} hint="원료의 기본 야드로 자동 지정돼요">
                  <span className="flex h-8 items-center text-sm font-medium">{line.defaultYardName ?? '-'}</span>
                </Field>
              </CardBody>
              <CardFoot>
                <span className="text-cap text-ink-3">확정하면 원료 LOT이 만들어지고 재고·MRP 잔량에 바로 반영돼요. 확정한 입고는 고칠 수 없고, LOT을 쓰기 전에만 입고 취소할 수 있어요.</span>
                <Button
                  variant="primary"
                  icon="check"
                  className="ml-auto"
                  disabled={!canReceive || receive.isPending}
                  title={canReceive ? undefined : permissionNeedText([PERMISSION.GOODS_RECEIPT_CONFIRM])}
                  onClick={() => setConfirming(true)}
                >
                  입고 확정
                </Button>
              </CardFoot>
            </>
          )}
        </Card>
        <Card petKey="card:goodsReceipts.lot">
          <CardHead title="원료 LOT" meta="확정할 때 생성" />
          <CardBody>
            {/* 펫이 LOT 번호만 읽지 않게 번호 규칙 줄까지 한 항목으로 묶는다 (CardBody와 같은 간격이라 모양은 그대로) */}
            <div data-pet-item="lot" data-pet-item-title={rawMaterialLotNoPattern(line.itemCode)} className="flex flex-col gap-3">
              <span className="font-mono text-base font-semibold">{rawMaterialLotNoPattern(line.itemCode)}</span>
              <span className="text-cap leading-normal text-ink-3">
                <span data-pet-field="번호 매김">번호는 입고를 확정할 때 매겨요 (YYMMDD = 입고일)</span> · <span data-pet-field="생성 단위">입고 1건마다 LOT 1개</span> ·{' '}
                <span data-pet-field="잔량">잔량 = 입고 톤</span>
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card petKey="card:goodsReceipts.history">
        <CardHead
          title="입고 내역"
          actions={
            <Segmented<HistoryScope>
              ariaLabel="입고 내역 범위"
              items={[
                { key: 'line', label: <span data-pet-term="이 발주 품목">이 발주 품목</span> },
                { key: 'all', label: <span data-pet-term="전체">전체</span> },
              ]}
              active={scope}
              onChange={setScope}
            />
          }
        />
        {/* 글자를 키우면 표가 오른쪽 칸보다 넓어져 카드 밖으로 삐져나오므로 카드 안에서 가로로 넘긴다 */}
        <CardBody flush className="overflow-x-auto">
          {history.length === 0 ? (
            <EmptyNote>{scope === 'line' ? '이 발주 품목의 입고가 아직 없어요' : '입고 내역이 없어요'}</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>입고번호</Th>
                  <Th>발주번호</Th>
                  <Th>원료</Th>
                  <Th>입고일</Th>
                  <Th align="right">입고 톤</Th>
                  <Th>야드</Th>
                  <Th>원료 LOT</Th>
                  <Th>확정</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {history.map((receipt) => (
                  <tr key={receipt.id} data-selected={done?.goodsReceiptId === receipt.id} data-pet-item="goodsReceipt" data-pet-item-title={receipt.goodsReceiptNo}>
                    <Td className="font-mono">
                      {receipt.goodsReceiptNo}
                      {receipt.reversedGoodsReceiptNo ? <span className="block font-sans text-cap text-ink-3">{receipt.reversedGoodsReceiptNo} 취소</span> : null}
                    </Td>
                    <Td className="font-mono">{receipt.purchaseOrderNo}</Td>
                    <Td>{receipt.itemName}</Td>
                    <Td>{fmtDate(receipt.receivedDate)}</Td>
                    <Td align="right">{fmtTon(receipt.receivedTon)}</Td>
                    <Td>{receipt.yardName ?? '-'}</Td>
                    <Td>
                      {receipt.lotNo ? (
                        <Link className="font-mono text-run hover:underline" href={lotHref(receipt.lotNo)}>
                          {receipt.lotNo}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </Td>
                    <Td className="text-cap text-ink-3">
                      {receipt.confirmedEmployeeName ?? '-'} · {fmtMDHM(receipt.createdAt)}
                    </Td>
                    <Td align="right">
                      {receipt.reversedGoodsReceiptNo ? (
                        <span title={receipt.cancelReason ?? undefined}>
                          <Badge tone="neutral">입고 취소</Badge>
                        </span>
                      ) : receipt.reversalGoodsReceiptNo ? (
                        <span title={receipt.cancelReason ?? undefined} className="text-cap text-ink-3">
                          취소됨 · {receipt.reversalGoodsReceiptNo}
                        </span>
                      ) : cancellable(receipt) ? (
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          disabled={!canReceive}
                          title={canReceive ? undefined : permissionNeedText([PERMISSION.GOODS_RECEIPT_CONFIRM])}
                          onClick={() => setCancelling(receipt)}
                        >
                          입고 취소
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {cancelling ? (
        <ReasonDialog
          id={`gr-cancel-${cancelling.id}`}
          title="입고를 취소할까요?"
          confirmLabel="입고 취소"
          reasonLabel="취소 사유"
          pending={cancelReceipt.isPending}
          error={cancelReceipt.error}
          onCancel={() => {
            setCancelling(null);
            cancelReceipt.reset();
          }}
          onConfirm={(reason) => cancelReceipt.mutate({ goodsReceiptId: cancelling.id, reason })}
        >
          <KvList
            items={[
              { label: '입고', value: `${cancelling.goodsReceiptNo} · ${cancelling.purchaseOrderNo}` },
              { label: '원료 · 입고 톤', value: `${cancelling.itemName} ${fmtTon(cancelling.receivedTon)}` },
              { label: '원료 LOT', value: cancelling.lotNo ?? '-' },
            ]}
          />
          <p className="text-cap text-ink-3">원료 LOT을 아직 쓰지 않았을 때만 취소돼요(투입·배정 전). 원래 입고는 남고 음수 입고가 더해지며, LOT은 입고 취소·잔량 0이 되고 입고예정이 되돌아와요.</p>
        </ReasonDialog>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="입고를 확정할까요?"
          confirmLabel="입고 확정"
          pending={receive.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            onPin();
            receive.mutate({ purchaseOrderItemId: line.purchaseOrderItemId, receivedTon, receivedDate });
          }}
        >
          <KvList
            items={[
              { label: '발주 품목', value: `${line.purchaseOrderNo} ${line.purchaseRequisitionNo ?? ''} · ${line.itemName}` },
              { label: '입고 톤', value: receivedTon ? `${receivedTon} t` : '-' },
              { label: '입고일', value: receivedDate || '-' },
              { label: '야드', value: line.defaultYardName ?? '-' },
            ]}
          />
          <p className="text-cap text-ink-3">확정하면 원료 LOT이 만들어지고 고칠 수 없어요.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
