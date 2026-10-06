'use client';

// 입고 (REQ-PUR-004, REQ-LOT-003·004, BP-PUR-02): 발주 품목 줄을 골라 입고 톤·입고일을 넣으면 등록이 곧 확정이다(상태값·수정 없음).
// 미입고량을 넘으면 PUR-003, 입고일은 오늘까지. 야드는 원료의 기본 야드로 자동 지정한다(야드 선택·비고 없음, PLAN 7장).
// 입고 1건마다 원료 LOT(RM-원료코드-YYMMDD-NNN, 잔량 = 입고량)이 생기고 발주 입고 누계·입고예정·상태가 바뀐다.
// 주소: ?item= 발주 품목 줄, ?po= 그 발주의 첫 미입고 줄.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION } from '@/codes';
import { ApiError, InputError } from '@/api/client';
import type { GoodsReceiptResult, GoodsReceiptView, ReceiptLine } from '@/api/goodsReceipts';
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
import { useUrlParams } from '@/features/purchasing/hooks/useUrlParams';
import { isOverdue, ratioPercent, rawMaterialLotNoPattern, receiptRowLabel, trimTonText } from '@/features/purchasing/lib/purchasingView';
import { useGoodsReceiptList, useReceiptLines, useReceiveGoods } from '@/hooks/useGoodsReceipts';
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

export function GoodsReceiptScreen() {
  const url = useUrlParams();
  const itemParam = url.getNumber('item');
  const poParam = url.getNumber('po');
  const today = todayStr();
  const canReceive = useCanUse(PERMISSION.GOODS_RECEIPT_CONFIRM);
  const canSeeOrders = useCanView(PERMISSION.PURCHASE_ORDER_CONFIRM);
  const lines = useReceiptLines();
  const receipts = useGoodsReceiptList();
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
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">입고예정</b>
              <span className="text-xs text-ink-3">{openLines.length}건</span>
              {canSeeOrders ? (
                <ButtonLink href="/purchase-orders" size="sm" icon="building" className="ml-auto">
                  발주
                </ButtonLink>
              ) : null}
            </div>
            <Input leadingIcon="search" placeholder="발주번호·원료·공급업체 검색" value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="입고예정 검색" />
            <div className="flex gap-1.5">
              <Chip on={tab === 'open'} onClick={() => setTab('open')}>
                입고예정 <b>{openLines.length}</b>
              </Chip>
              <Chip on={tab === 'all'} onClick={() => setTab('all')}>
                전체 <b>{allLines.length}</b>
              </Chip>
            </div>
            {canReceive ? null : <ReadOnlyHint permissions={[PERMISSION.GOODS_RECEIPT_CONFIRM]} />}
          </>
        }
      >
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
                    >
                      <span className="flex items-center gap-2">
                        <b className="font-mono text-sm font-semibold">
                          {line.purchaseOrderNo} <span className="text-cap font-medium text-ink-3">{line.purchaseRequisitionNo}</span>
                        </b>
                        <PurchaseOrderStatusBadge status={line.purchaseOrderStatus} />
                        <span className={cn('ml-auto text-cap', overdue ? 'font-semibold text-danger' : 'text-ink-3')}>{line.expectedReceiptDate ? `입고 예정 ${fmtMD(line.expectedReceiptDate)}` : ''}</span>
                      </span>
                      <span className="text-sm text-ink">
                        {line.itemName} <span className="text-ink-3">· {line.supplierName}</span>
                      </span>
                      <span className="flex items-center gap-2 text-cap text-ink-3">
                        <span className="whitespace-nowrap">{line.isFullyReceived ? '입고 끝' : `입고예정 ${fmtTon(line.remainingTon)}`}</span>
                        <Progress value={ratioPercent(line.receivedTon, line.orderedTon)} tone={line.isFullyReceived ? 'ok' : 'run'} showLabel={false} label="입고 진행" className="flex-1" />
                      </span>
                    </MasterItem>
                  );
                })}
              </>
            )
          }
        </QueryBoundary>
        <MasterGroupTitle title="최근 입고" />
        <QueryBoundary query={receipts} loadingLabel="입고 내역을 불러오는 중…">
          {(data) =>
            data.length === 0 ? (
              <EmptyNote>확정된 입고가 없어요</EmptyNote>
            ) : (
              <ul>
                {data.slice(0, RECENT_COUNT).map((receipt) => (
                  <li key={receipt.id} className="flex flex-col gap-0.5 border-b border-line px-4 py-2 text-cap text-ink-3">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <b className="font-mono font-semibold">{receipt.goodsReceiptNo}</b>
                      <span className="ml-auto tabular-nums">{fmtTon(receipt.receivedTon)}</span>
                    </span>
                    <span>
                      {receipt.itemName} · {receipt.supplierName} · {fmtDate(receipt.receivedDate)}
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
        <MasterNote>입고 등록이 곧 입고 확정이에요. 원료 LOT이 바로 만들어지고 고칠 수 없어요. 입고 검사는 하지 않아요.</MasterNote>
      </MasterPane>
      <PageMain>
        {active ? (
          <ReceiptWork
            key={active.purchaseOrderItemId}
            line={active}
            receipts={receipts.data ?? []}
            canReceive={canReceive}
            canSeeOrders={canSeeOrders}
            onPin={() => url.set({ item: active.purchaseOrderItemId, po: null })}
          />
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
  canReceive,
  canSeeOrders,
  onPin,
}: {
  line: ReceiptLine;
  receipts: GoodsReceiptView[];
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
      <StatBar>
        <Kpi flat label="발주" value={fmtNum(line.orderedTon, 3)} unit="t" />
        <Kpi flat label="입고 누계" value={fmtNum(line.receivedTon, 3)} unit="t" sub={`발주 대비 ${Math.round(ratioPercent(line.receivedTon, line.orderedTon))}%`} />
        <Kpi flat label="입고예정" value={fmtNum(line.remainingTon, 3)} unit="t" sub={line.isFullyReceived ? '입고 끝' : '발주 − 입고 누계 · 나눠서 입고할 수 있어요'} />
      </StatBar>

      {done ? (
        <Banner tone="ok">
          <b>입고 확정 완료</b> · {done.goodsReceiptNo} · 원료 LOT{' '}
          <Link className="font-mono font-semibold underline" href={lotHref(done.lotNo)}>
            {done.lotNo}
          </Link>{' '}
          · {line.itemName} {fmtTon(done.receivedTon)} · {done.yardName ?? '야드 미지정'} · 잔량 {fmtTon(done.receivedTon)} · 발주 품목 입고 누계 {fmtTon(done.lineReceivedTon)} · 입고예정{' '}
          {fmtTon(done.lineRemainingTon)}
        </Banner>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
        <Card>
          <CardHead title="입고 등록" meta="등록하면 바로 확정돼요" />
          {line.isFullyReceived ? (
            <CardBody>
              <EmptyNote>이 발주 품목은 모두 입고했어요</EmptyNote>
            </CardBody>
          ) : (
            <>
              <CardBody className="flex-row flex-wrap items-start gap-4">
                {failure ? <Banner tone="danger" className="w-full">{failure}</Banner> : null}
                <Field label="입고 톤" required htmlFor="gr-ton" error={fieldErrors.receivedTon ?? null} hint="미입고량 이하 · 소수 3자리까지">
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
                <Field label="입고일" required htmlFor="gr-date" error={fieldErrors.receivedDate ?? null} hint="오늘까지 · 원료 LOT 번호의 날짜가 돼요">
                  <DateInput id="gr-date" value={receivedDate} onChange={setReceivedDate} invalid={Boolean(fieldErrors.receivedDate)} disabled={!canReceive} />
                </Field>
                <Field label="야드" hint="원료의 기본 야드로 자동 지정돼요">
                  <span className="flex h-8 items-center text-sm font-medium">{line.defaultYardName ?? '-'}</span>
                </Field>
              </CardBody>
              <CardFoot>
                <span className="text-cap text-ink-3">확정하면 원료 LOT이 만들어지고 재고·MRP 잔량에 바로 반영돼요. 확정한 입고는 고칠 수 없어요.</span>
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
        <Card>
          <CardHead title="원료 LOT" meta="확정할 때 생성" />
          <CardBody>
            <span className="font-mono text-base font-semibold">{rawMaterialLotNoPattern(line.itemCode)}</span>
            <span className="text-cap leading-4 text-ink-3">번호는 입고를 확정할 때 매겨요 (YYMMDD = 입고일) · 입고 1건마다 LOT 1개 · 잔량 = 입고 톤</span>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHead
          title="입고 내역"
          actions={
            <Segmented<HistoryScope>
              ariaLabel="입고 내역 범위"
              items={[
                { key: 'line', label: '이 발주 품목' },
                { key: 'all', label: '전체' },
              ]}
              active={scope}
              onChange={setScope}
            />
          }
        />
        <CardBody flush>
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
                </tr>
              </thead>
              <tbody>
                {history.map((receipt) => (
                  <tr key={receipt.id} data-selected={done?.goodsReceiptId === receipt.id}>
                    <Td className="font-mono">{receipt.goodsReceiptNo}</Td>
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
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

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
