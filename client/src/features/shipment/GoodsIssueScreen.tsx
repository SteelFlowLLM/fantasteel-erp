'use client';
// 출고 확정 (REQ-SHP-002·003, REQ-INV-005, REQ-SO-005, BP-SHP-01 14.1-8, 보고서 1 A-8).
// C 반영: 별도 출고 번호·'최근 출고' 목록 없음 → 출하요청(출고 완료)으로 보인다. 상태 문구는 공통 코드 그대로.
// 확정은 출하요청 단위. core가 품질·배정·재고를 다시 확인하고(SHP-002·INV-001·INV-004), 예약 CONVERTED·배정 CONSUMED·LOT 출고·밀시트를 한 번에 처리한다.
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/api/client';
import type { GoodsIssueQueueRow, GoodsIssueView } from '@/api/goodsIssues';
import { ERROR_MESSAGE, LOT_STATUS_LABEL, PERMISSION, PRODUCT_QTY_UNIT, SHIPMENT_REQUEST_STATUS_LABEL, type ShipmentRequestStatus } from '@/codes';
import { Banner } from '@/components/Banner';
import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { KvList } from '@/components/KvList';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { useShellTitle } from '@/features/shell/useShellTitle';
import {
  InspectionResultBadge,
  ItemTypeTag,
  MillSheetLink,
  PdfBadge,
  SalesOrderItemStatusBadge,
  SalesOrderLink,
  ShipmentRequestStatusBadge,
  TraceLink,
} from '@/features/shipment/components/ShipmentBadges';
import { useConfirmGoodsIssue, useGoodsIssueDetail, useGoodsIssueQueue } from '@/hooks/useGoodsIssues';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtMD, fmtMDHM, fmtTon, todayStr } from '@/lib/format';
import { sumTon } from '@/lib/weight';
import { permissionNeedText } from '@/lib/permissions';

type QueueFilter = Exclude<ShipmentRequestStatus, 'CANCELLED'>;
const QUEUE_FILTERS: QueueFilter[] = ['ALLOCATED', 'REQUESTED', 'ISSUED'];

export function GoodsIssueScreen() {
  const params = useSearchParams();
  const requestParam = Number(params.get('request')) || null;
  const queue = useGoodsIssueQueue();
  const rows = queue.data ?? [];
  const selectedId = requestParam ?? rows.find((r) => r.shipmentRequestStatus === 'ALLOCATED')?.shipmentRequestId ?? rows[0]?.shipmentRequestId ?? null;
  return (
    <>
      <QueuePane query={queue} selectedId={selectedId} initialFilter={rows.find((r) => r.shipmentRequestId === selectedId)?.shipmentRequestStatus} />
      <PageMain>
        {queue.data !== undefined && selectedId === null ? (
          <StateView kind="empty" icon="truck" title="출고할 출하요청이 없어요" text="영업이 배정을 확정하면 여기에 올라와요." />
        ) : selectedId !== null ? (
          <IssueDetail key={selectedId} shipmentRequestId={selectedId} />
        ) : null}
      </PageMain>
    </>
  );
}

function QueuePane({ query, selectedId, initialFilter }: { query: ReturnType<typeof useGoodsIssueQueue>; selectedId: number | null; initialFilter?: ShipmentRequestStatus }) {
  const [filter, setFilter] = useState<QueueFilter | null>(null);
  const [keyword, setKeyword] = useState('');
  const rows = query.data ?? [];
  const active: QueueFilter = filter ?? (initialFilter && initialFilter !== 'CANCELLED' ? initialFilter : 'ALLOCATED');
  const word = keyword.trim().toLowerCase();
  const visible = rows.filter((r) => r.shipmentRequestStatus === active && (!word || [r.shipmentRequestNo, r.customerName].some((t) => t.toLowerCase().includes(word))));
  const readyRows = rows.filter((r) => r.shipmentRequestStatus === 'ALLOCATED');
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">출고 확정</h2>
            <span className="text-xs text-ink-3">배정 확정된 출하요청만 출고해요</span>
          </div>
          <Input leadingIcon="search" placeholder="출하요청 번호·고객사 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="출하요청 검색" />
          <div className="flex gap-1.5">
            {QUEUE_FILTERS.map((f) => (
              <Chip key={f} on={active === f} onClick={() => setFilter(f)}>
                {SHIPMENT_REQUEST_STATUS_LABEL[f]} <b>{rows.filter((r) => r.shipmentRequestStatus === f).length}</b>
              </Chip>
            ))}
          </div>
        </>
      }
    >
      <QueryBoundary query={query}>
        {() =>
          visible.length === 0 ? (
            <EmptyNote>
              {word
                ? '조건에 맞는 출하요청이 없어요.'
                : active === 'ALLOCATED'
                  ? '출고할 출하요청이 없어요. 영업이 배정을 확정하면 여기에 올라와요.'
                  : active === 'REQUESTED'
                    ? '배정 대기 중인 출하요청이 없어요.'
                    : '아직 출고 확정된 출하요청이 없어요.'}
            </EmptyNote>
          ) : (
            <ul>
              {visible.map((r) => (
                <QueueItem key={r.shipmentRequestId} row={r} selected={r.shipmentRequestId === selectedId} />
              ))}
            </ul>
          )
        }
      </QueryBoundary>
      <div className="flex flex-col gap-1 border-t border-line px-4 py-3 text-cap text-ink-3">
        <span>
          오늘 ({fmtMD(todayStr())}) · 출고할 출하요청 {readyRows.length}건 · {fmtTon(sumTon(readyRows.map((r) => r.totalWeightTon)))}
        </span>
        <span>출고 확정은 출하요청 단위예요. 부분 출하는 출하요청을 나눠서 해요.</span>
      </div>
    </MasterPane>
  );
}

function QueueItem({ row, selected }: { row: GoodsIssueQueueRow; selected: boolean }) {
  return (
    <li>
      <Link
        href={`/goods-issues?request=${row.shipmentRequestId}`}
        aria-current={selected ? 'page' : undefined}
        className={cn('flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2', selected && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint')}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-mono font-semibold">{row.shipmentRequestNo}</span>
          <span className="ml-auto">
            <ShipmentRequestStatusBadge status={row.shipmentRequestStatus} />
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{row.customerName}</span>
          <span className="ml-auto text-xs text-ink-2">
            {row.totalRequestQty} · {fmtTon(row.totalWeightTon)}
          </span>
        </span>
        <span className="text-cap text-ink-3">
          {row.shipmentRequestStatus === 'ISSUED'
            ? `출고 ${fmtMDHM(row.issuedAt)} · ${row.issuedEmployeeName ?? '-'}`
            : `배정 ${row.totalAllocatedQty}/${row.totalRequestQty} · 출하 요청일 ${fmtMD(row.requestedShipDate)}`}
          {row.shipmentRequestStatus === 'ALLOCATED' && !row.ready ? <span className="ml-1 font-medium text-danger">· 출고 불가 {row.problems.length}건</span> : null}
        </span>
      </Link>
    </li>
  );
}

const ERROR_HINT: Partial<Record<string, string>> = {
  'SHP-002': '미검사·불합격 LOT이 있거나 예약·수주 잔량을 넘으면 출고 전체가 막혀요. 배정 화면에서 LOT을 바꿔 주세요.',
  'INV-004': '이미 투입·출고된 LOT이 배정돼 있어요. 배정 화면에서 다른 LOT으로 바꿔 주세요.',
  'INV-001': '배정 대기 매수가 남아 있어요. 영업이 배정을 모두 확정해야 출고할 수 있어요.',
  'COM-001': '다른 화면에서 이미 출고했거나 출하요청이 바뀌었어요. 목록을 다시 확인해 주세요.',
};

function IssueDetail({ shipmentRequestId }: { shipmentRequestId: number }) {
  const query = useGoodsIssueDetail(shipmentRequestId);
  return (
    <QueryBoundary query={query} loadingLabel="출고할 LOT을 불러오는 중…">
      {(view) => <IssueBody view={view} />}
    </QueryBoundary>
  );
}

function IssueBody({ view }: { view: GoodsIssueView }) {
  const canConfirm = useCanUse(PERMISSION.GOODS_ISSUE_CONFIRM);
  const [failure, setFailure] = useState<unknown>(null);
  const confirm = useConfirmGoodsIssue({ onSuccess: () => setFailure(null), onError: setFailure });
  useShellTitle(`출고 확정 · ${view.shipmentRequestNo}`, view.customerName);

  const issued = view.shipmentRequestStatus === 'ISSUED';
  const cancelled = view.shipmentRequestStatus === 'CANCELLED';
  const lots = view.lines.flatMap((l) => l.lots);
  const confirmedLots = lots.filter((l) => l.allocationStatus === 'CONFIRMED');
  const passedLots = confirmedLots.filter((l) => l.productInspectionResult === 'PASS' && l.heatInspectionResult === 'PASS');
  const inStockLots = confirmedLots.filter((l) => l.lotStatus === 'AVAILABLE');
  const blockedLots = confirmedLots.filter((l) => l.eligibility !== 'ELIGIBLE');
  const salesOrderCount = new Set(view.lines.map((l) => l.salesOrderId)).size;
  const blockText = cancelled
    ? '취소된 출하요청이에요.'
    : view.shipmentRequestStatus === 'REQUESTED'
      ? '배정 대기 — 출고 불가 · 영업의 배정 확정이 필요해요.'
      : !canConfirm
        ? permissionNeedText([PERMISSION.GOODS_ISSUE_CONFIRM])
        : !view.ready
          ? '출고 전 확인에서 문제가 있어 출고할 수 없어요.'
          : null;
  const failureCode = failure instanceof ApiError ? failure.code : null;

  return (
    <>
      <PageHead
        crumb={<>출고 확정 › {view.shipmentRequestNo}</>}
        title={
          <span className="flex items-center gap-2.5">
            <span className="font-mono">{view.shipmentRequestNo}</span>
            <ShipmentRequestStatusBadge status={view.shipmentRequestStatus} />
            <span className="text-base font-medium text-ink-2">{view.customerName}</span>
          </span>
        }
        actions={
          <>
            {canConfirm ? null : <ReadOnlyHint permissions={[PERMISSION.GOODS_ISSUE_CONFIRM]} />}
            <ButtonLink href={`/shipment-requests/${view.id}`} variant="ghost" icon="clipboard">
              출하요청·배정
            </ButtonLink>
            <ButtonLink href={`/lots/trace?shipmentRequestNo=${encodeURIComponent(view.shipmentRequestNo)}`} variant="ghost" icon="trace">
              LOT 추적
            </ButtonLink>
          </>
        }
      />
      <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-1">
        <KvList
          columns={3}
          items={[
            { label: '요청', value: `${view.requesterName ?? '-'} · ${fmtMDHM(view.createdAt)}` },
            { label: '출하 요청일', value: view.requestedShipDate },
            {
              label: '수주',
              value: (
                <span className="flex flex-wrap gap-1.5">
                  {[...new Map(view.lines.map((l) => [l.salesOrderId, l.salesOrderNo])).entries()].map(([id, no]) => (
                    <SalesOrderLink key={id} salesOrderId={id} salesOrderNo={no} />
                  ))}
                </span>
              ),
            },
            { label: '품목', value: `${view.lines.length}품목` },
            { label: '수량 · 이론중량', value: `${view.totalRequestQty} · ${fmtTon(view.totalWeightTon)}` },
            { label: '출고', value: issued ? `${view.issuedEmployeeName ?? '-'} · ${fmtDateTime(view.issuedAt)}` : '-' },
          ]}
        />
      </div>

      {failure ? (
        <Banner
          tone="danger"
          actions={
            <ButtonLink href={`/shipment-requests/${view.id}`} size="sm">
              배정 화면
            </ButtonLink>
          }
        >
          <b>출고를 확정하지 못했어요{failureCode ? ` (${failureCode})` : ''}</b>
          <div>
            {failure instanceof ApiError ? [failure.message, failure.detail].filter(Boolean).join(' · ') : failure instanceof Error ? failure.message : ''}
          </div>
          <div className="text-xs">{(failureCode && ERROR_HINT[failureCode]) ?? '내용을 확인한 뒤 다시 시도해 주세요.'} 아무것도 출고되지 않았어요.</div>
        </Banner>
      ) : null}
      {!issued && !cancelled && view.problems.length > 0 ? (
        <Banner tone="wait" icon="alert">
          <b>출고 전 확인에서 막혔어요</b>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {view.problems.map((p, i) => (
              <li key={i}>
                {p.lotNo ? <span className="font-mono">{p.lotNo} · </span> : null}
                {p.message} ({p.code} {ERROR_MESSAGE[p.code]})
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <Card>
        <CardHead
          title={issued ? '출고한 LOT' : '배정 LOT 출고 확인'}
          actions={issued ? <Badge>{lots.length} LOT</Badge> : blockedLots.length > 0 ? <Badge tone="danger">출고 불가 LOT {blockedLots.length}</Badge> : <Badge tone="ok">{confirmedLots.length} LOT</Badge>}
        />
        <div className="overflow-auto">
          <Table compact>
            <thead>
              <tr>
                <Th>품목</Th>
                <Th>수주</Th>
                <Th>LOT</Th>
                <Th>히트</Th>
                <Th>생산완료일</Th>
                <Th align="right">이론중량</Th>
                {issued ? null : (
                  <>
                    <Th>제품 검사</Th>
                    <Th>상위 히트</Th>
                    <Th>재고</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => {
                if (line.lots.length === 0) {
                  return (
                    <tr key={line.shipmentRequestItemId}>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <ItemTypeTag itemType={line.itemType} />
                          <span className="font-mono text-mono">{line.itemCode}</span>
                        </span>
                      </Td>
                      <Td>
                        <SalesOrderLink salesOrderId={line.salesOrderId} salesOrderNo={line.salesOrderNo} lineNo={line.salesOrderLineNo} />
                      </Td>
                      <Td colSpan={issued ? 4 : 7} className="text-ink-3">
                        {cancelled ? '취소된 요청이라 배정된 LOT이 없어요' : '배정 대기 — 아직 배정된 LOT이 없어요 (영업의 배정 확정 필요)'}
                      </Td>
                    </tr>
                  );
                }
                return line.lots.map((lot, index) => (
                  <tr key={lot.allocationId} data-risk={!issued && lot.eligibility !== 'ELIGIBLE'}>
                    {index === 0 ? (
                      <>
                        <Td rowSpan={line.lots.length} className="align-top">
                          <span className="flex items-center gap-1.5 pt-2">
                            <ItemTypeTag itemType={line.itemType} />
                            <span className="font-mono text-mono">{line.itemCode}</span>
                          </span>
                        </Td>
                        <Td rowSpan={line.lots.length} className="align-top">
                          <span className="block pt-2">
                            <SalesOrderLink salesOrderId={line.salesOrderId} salesOrderNo={line.salesOrderNo} lineNo={line.salesOrderLineNo} />
                          </span>
                        </Td>
                      </>
                    ) : null}
                    <Td>
                      <TraceLink no={lot.lotNo} />
                    </Td>
                    <Td className="font-mono text-mono">{lot.heatLotNo ?? '-'}</Td>
                    <Td>{lot.producedDate}</Td>
                    <Td align="right">{fmtTon(line.unitWeightTon)}</Td>
                    {issued ? null : (
                      <>
                        <Td>
                          <InspectionResultBadge result={lot.productInspectionResult} />
                        </Td>
                        <Td>
                          <InspectionResultBadge result={lot.heatInspectionResult} />
                        </Td>
                        <Td>
                          <Badge tone={lot.lotStatus === 'AVAILABLE' ? 'neutral' : 'danger'}>{LOT_STATUS_LABEL[lot.lotStatus]}</Badge>
                        </Td>
                      </>
                    )}
                  </tr>
                ));
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={2}>합계</Td>
                <Td colSpan={3}>{issued ? lots.length : confirmedLots.length} LOT</Td>
                <Td align="right">{fmtTon(view.totalWeightTon)}</Td>
                {issued ? null : <Td colSpan={3} />}
              </tr>
            </tfoot>
          </Table>
        </div>
      </Card>

      {!issued && !cancelled ? (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHead title="출고 전 확인" />
            <CardBody className="gap-2 text-sm">
              <CheckRow ok={confirmedLots.length === view.totalRequestQty} label="배정 확정" value={`${confirmedLots.length}/${view.totalRequestQty}`} />
              <CheckRow ok={passedLots.length === confirmedLots.length && confirmedLots.length > 0} label="검사 합격 (제품 + 상위 히트)" value={`${passedLots.length}/${confirmedLots.length}`} />
              <CheckRow ok={inStockLots.length === confirmedLots.length && confirmedLots.length > 0} label="미소진 (재고)" value={`${inStockLots.length}/${confirmedLots.length}`} />
              <p className="text-cap text-ink-3">확정할 때 품질·배정·재고를 다시 확인해요. 하나라도 맞지 않으면 아무것도 출고되지 않아요.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHead title="확정하면 바뀌는 것" />
            <CardBody className="gap-1.5 text-sm">
              <span>· 배정 {confirmedLots.length}건 → 소진, LOT → 출고</span>
              <span>· 예약 {confirmedLots.length} → 출고 전환 (CONVERTED). 일부만 출고하면 예약을 나눠 남은 매수는 예약중으로 둬요</span>
              <span>· 수주 품목 출고 매수 +{confirmedLots.length} → 품목 상태 갱신 (부분출하·출하완료)</span>
              <span>
                · 밀시트: 수주마다 1장 · {salesOrderCount}장 자동 발행 (히트 성분 + 슬래브·코일 검사값 스냅샷)
              </span>
              <span className="text-xs text-ink-3">작업 로그: 출고 확정 · 예약 전환 · 밀시트 발행</span>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {issued ? <IssueResult view={view} /> : null}

      <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-2.5">
        {issued ? (
          <span className="text-sm text-ink-2">
            출고 {fmtDateTime(view.issuedAt)} · 담당 {view.issuedEmployeeName ?? '-'}
          </span>
        ) : blockText ? (
          <span className="flex items-center gap-1.5 text-sm text-ink-2">{blockText}</span>
        ) : (
          <span className="text-sm text-ink-2">두 번 눌러도 한 번만 출고돼요.</span>
        )}
        {issued ? (
          view.millSheets[0] ? (
            <ButtonLink href={`/mill-sheets?id=${view.millSheets[0].id}`} variant="primary" icon="file" className="ml-auto">
              밀시트 보기
            </ButtonLink>
          ) : null
        ) : (
          <Button
            variant="primary"
            icon="truck"
            className="ml-auto"
            disabled={!canConfirm || cancelled || view.shipmentRequestStatus !== 'ALLOCATED' || !view.ready || confirm.isPending}
            title={canConfirm ? undefined : permissionNeedText([PERMISSION.GOODS_ISSUE_CONFIRM])}
            onClick={() => confirm.mutate({ shipmentRequestId: view.id, expectedUpdatedAt: view.updatedAt })}
          >
            {confirm.isPending ? '출고 확정 중…' : '출고 확정'}
          </Button>
        )}
      </div>
    </>
  );
}

function CheckRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn('inline-block size-2 rounded-full', ok ? 'bg-ok' : 'bg-danger')} aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <b className={cn('tabular-nums', ok ? 'text-ok' : 'text-danger')}>{value}</b>
    </span>
  );
}

function IssueResult({ view }: { view: GoodsIssueView }) {
  return (
    <Card>
      <CardHead title="출고 결과" meta={`예약 전환(CONVERTED) ${view.totalRequestQty} · ${fmtTon(view.totalWeightTon)}`} />
      <div className="overflow-auto">
        <Table compact>
          <thead>
            <tr>
              <Th>수주 품목</Th>
              <Th>규격</Th>
              <Th align="right">이번 출고</Th>
              <Th align="right">이론중량</Th>
              <Th align="right">출고 전환 누계</Th>
              <Th align="right">누적 출고 / 수주 매수</Th>
              <Th>수주 품목 상태</Th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((line) => {
              const unit = PRODUCT_QTY_UNIT[line.itemType];
              return (
                <tr key={line.shipmentRequestItemId}>
                  <Td>
                    <SalesOrderLink salesOrderId={line.salesOrderId} salesOrderNo={line.salesOrderNo} lineNo={line.salesOrderLineNo} />
                  </Td>
                  <Td className="font-mono text-mono">{line.itemCode}</Td>
                  <Td align="right">
                    {line.lots.length}
                    {unit}
                  </Td>
                  <Td align="right">{fmtTon(line.requestTon)}</Td>
                  <Td align="right">
                    {line.convertedQty}
                    {unit}
                  </Td>
                  <Td align="right">
                    {line.shippedQty} / {line.orderedQty}
                    {unit}
                  </Td>
                  <Td>
                    <SalesOrderItemStatusBadge status={line.salesOrderItemStatus} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <CardFoot>
        <span className="text-xs text-ink-2">발행된 밀시트</span>
        {view.millSheets.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5">
            <MillSheetLink id={m.id} no={m.millSheetNo} />
            <PdfBadge pdfPath={m.pdfPath} />
          </span>
        ))}
        <span className="ml-auto text-cap text-ink-3">밀시트는 발행 시점 값을 스냅샷으로 저장해요.</span>
      </CardFoot>
    </Card>
  );
}
