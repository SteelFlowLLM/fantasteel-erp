'use client';
// 밀시트 (REQ-SHP-003·004, BP-SHP-01 문서 보존, 보고서 1 A-9). 목록 | 종이 화면. 선택은 URL ?id=.
// 'PDF 생성' = 브라우저 인쇄(종이만 찍히는 인쇄 CSS) → 끝나면 pdf_path를 남겨 'PDF 생성됨'으로 보인다.
// 인쇄를 시작하지 못하면 SHP-001(스냅샷은 있음)로 알리고 같은 스냅샷으로 다시 시도한다 — 출고는 다시 하지 않는다.
// C 반영: PDF 상태 코드 없음(pdf_path 유무), 출고번호 대신 출하요청, 칩 문구는 공통 코드 ITEM_TYPE 표시명.
import { millSheetPdfFileName } from '@fantasteel/shared';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ERROR_MESSAGE, ITEM_TYPE_LABEL, PERMISSION, type ProductItemType } from '@/codes';
import type { MillSheetDetailView, MillSheetListRow } from '@/api/millSheets';
import { Banner } from '@/components/Banner';
import { Button, ButtonLink } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { MasterPane, PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { MillSheetPaper } from '@/features/millSheets/components/MillSheetPaper';
import { MillSheetPrintPortal } from '@/features/millSheets/components/MillSheetPrintPortal';
import { useShellTitle } from '@/features/shell/useShellTitle';
import { PdfBadge, SalesOrderLink, ShipmentRequestLink } from '@/features/shipment/components/ShipmentBadges';
import { useMarkMillSheetPdf, useMillSheetDetail, useMillSheetList } from '@/hooks/useMillSheets';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtMDHM, fmtTon } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

type TypeFilter = 'ALL' | ProductItemType;
const TYPE_FILTERS: TypeFilter[] = ['ALL', 'SLAB', 'COIL'];

export function MillSheetScreen() {
  const params = useSearchParams();
  const list = useMillSheetList();
  const idParam = Number(params.get('id')) || null;
  const selectedId = idParam ?? list.data?.[0]?.id ?? null;
  return (
    <>
      <ListPane query={list} selectedId={selectedId} />
      <PageMain>
        {list.data !== undefined && selectedId === null ? (
          <>
            <PageHead crumb="출하 › 밀시트" title="밀시트" />
            <StateView kind="empty" icon="file" title="아직 발행된 밀시트가 없어요" text="출고를 확정하면 출하요청 × 수주마다 자동으로 생겨요." />
          </>
        ) : selectedId !== null ? (
          <DetailPane key={selectedId} id={selectedId} />
        ) : null}
      </PageMain>
    </>
  );
}

function ListPane({ query, selectedId }: { query: ReturnType<typeof useMillSheetList>; selectedId: number | null }) {
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const rows = query.data ?? [];
  const word = keyword.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (filter === 'ALL' || r.itemTypes.includes(filter)) &&
      (!word || [r.millSheetNo, r.salesOrderNo, r.customerName, r.shipmentRequestNo, ...r.itemCodes, ...r.heatNos].some((t) => t.toLowerCase().includes(word))),
  );
  const groups = [...new Set(visible.map((r) => r.shipmentRequestId))].map((id) => visible.filter((r) => r.shipmentRequestId === id));
  return (
    <MasterPane
      head={
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">밀시트</h2>
            <span className="text-xs text-ink-3">{rows.length}장 · 출고 확정 때 자동 발행</span>
          </div>
          <Input leadingIcon="search" placeholder="밀시트·수주·고객사·규격·히트 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="밀시트 검색" />
          <div className="flex gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? '전체' : ITEM_TYPE_LABEL[f]}
                <b>{f === 'ALL' ? rows.length : rows.filter((r) => r.itemTypes.includes(f)).length}</b>
              </Chip>
            ))}
          </div>
        </>
      }
    >
      <QueryBoundary query={query}>
        {() =>
          rows.length === 0 ? (
            <EmptyNote>아직 발행된 밀시트가 없어요. 출고를 확정하면 자동으로 생겨요.</EmptyNote>
          ) : visible.length === 0 ? (
            <EmptyNote>조건에 맞는 밀시트가 없어요.</EmptyNote>
          ) : (
            <ul>
              {groups.map((group) => (
                <li key={group[0].shipmentRequestId}>
                  <div className="bg-surface-2 px-4 py-1.5 text-cap text-ink-3">
                    {fmtMDHM(group[0].issuedAt)} 출고 · <span className="font-mono">{group[0].shipmentRequestNo}</span>
                  </div>
                  <ul>
                    {group.map((row) => (
                      <ListItem key={row.id} row={row} selected={row.id === selectedId} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )
        }
      </QueryBoundary>
      <p className="border-t border-line px-4 py-3 text-cap text-ink-3">밀시트는 발행 시점의 고객사·수주·규격·LOT·히트·검사값을 스냅샷으로 저장해요. 나중에 검사값이 바뀌어도 그대로예요.</p>
    </MasterPane>
  );
}

function ListItem({ row, selected }: { row: MillSheetListRow; selected: boolean }) {
  return (
    <li>
      <Link
        href={`/mill-sheets?id=${row.id}`}
        aria-current={selected ? 'page' : undefined}
        className={cn('flex flex-col gap-1 border-b border-line px-4 py-2.5 hover:bg-surface-2', selected && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint-hover')}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-mono font-semibold">{row.millSheetNo}</span>
          <span className="ml-auto">
            <PdfBadge pdfPath={row.pdfPath} />
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{row.customerName}</span>
          <span className="font-mono text-cap text-ink-3">{row.salesOrderNo}</span>
        </span>
        <span className="text-xs text-ink-2">
          {row.itemTypes.map((t) => ITEM_TYPE_LABEL[t]).join('·')} {row.itemCodes[0]}
          {row.itemCodes.length > 1 ? ` 외 ${row.itemCodes.length - 1}` : ''} · {row.totalQty} · {fmtTon(row.totalWeightTon)}
        </span>
        <span className="text-cap text-ink-3">발행 {fmtDate(row.issuedAt)}</span>
      </Link>
    </li>
  );
}

function DetailPane({ id }: { id: number }) {
  const query = useMillSheetDetail(id);
  return (
    <QueryBoundary query={query} loadingLabel="밀시트를 불러오는 중…">
      {(detail) => <DetailBody detail={detail} />}
    </QueryBoundary>
  );
}

function DetailBody({ detail }: { detail: MillSheetDetailView }) {
  const canPrint = useCanUse(PERMISSION.MILL_SHEET_READ);
  const mark = useMarkMillSheetPdf();
  const [printFailed, setPrintFailed] = useState(false);
  const s = detail.snapshot;
  useShellTitle(detail.millSheetNo, s.customer.customerName);

  /**
   * 브라우저 인쇄 창을 연다. 인쇄 창에서 'PDF로 저장'을 고르면 PDF가 된다.
   * 브라우저는 문서 제목을 저장 파일 이름으로 쓰므로, 인쇄하는 동안만 제목을 저장 이름 양식(확장자 제외)으로 바꾼다.
   */
  const generatePdf = () => {
    const previousTitle = document.title;
    try {
      if (typeof window.print !== 'function') throw new Error('print unavailable');
      document.title = millSheetPdfFileName(s).replace(/.pdf$/, '');
      window.print();
    } catch {
      setPrintFailed(true);
      return;
    } finally {
      document.title = previousTitle;
    }
    setPrintFailed(false);
    if (!detail.pdfPath) mark.mutate({ millSheetId: detail.id });
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <PageHead
          crumb="출하 › 밀시트"
          title={
            <span className="flex items-center gap-2.5">
              <span className="font-mono">{detail.millSheetNo}</span>
              <PdfBadge pdfPath={detail.pdfPath} />
            </span>
          }
          actions={
            <>
              {canPrint ? null : <ReadOnlyHint permissions={[PERMISSION.MILL_SHEET_READ]} />}
              <ButtonLink href={`/business-events?salesOrderId=${detail.salesOrderId}`} variant="ghost" icon="history">
                작업 로그
              </ButtonLink>
              <ButtonLink href={`/lots/trace?shipmentRequestNo=${encodeURIComponent(s.shipmentRequest.shipmentRequestNo)}`} variant="ghost" icon="trace">
                LOT 추적
              </ButtonLink>
              <Button variant="primary" icon="print" disabled={!canPrint || mark.isPending} title={canPrint ? undefined : permissionNeedText([PERMISSION.MILL_SHEET_READ])} onClick={generatePdf}>
                {mark.isPending ? 'PDF 만드는 중…' : detail.pdfPath ? 'PDF 다시 출력' : 'PDF 생성'}
              </Button>
            </>
          }
        />
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span className="font-medium text-ink">{s.customer.customerName}</span>
          <SalesOrderLink salesOrderId={s.salesOrder.salesOrderId} salesOrderNo={s.salesOrder.salesOrderNo} />
          <ShipmentRequestLink id={s.shipmentRequest.shipmentRequestId} no={s.shipmentRequest.shipmentRequestNo} />
          <span className="text-ink-3">· 발행 {fmtDateTime(detail.issuedAt)}</span>
          {detail.pdfPath ? <span className="font-mono text-cap text-ink-3">· {detail.pdfPath}</span> : null}
        </div>
        {printFailed ? (
          <Banner
            tone="danger"
            actions={
              <Button size="sm" onClick={generatePdf} disabled={!canPrint}>
                다시 시도
              </Button>
            }
          >
            <b>
              PDF를 만들지 못했어요 (SHP-001 {ERROR_MESSAGE['SHP-001']})
            </b>
            <div className="text-xs">스냅샷은 그대로 저장돼 있어요. 같은 스냅샷으로 다시 만들고, 출고는 다시 실행하지 않아요.</div>
          </Banner>
        ) : null}
        <Banner tone="neutral" icon="info">
          발행 시점 값을 스냅샷으로 저장해요. 화면과 PDF 모두 이 스냅샷만 써요. 인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 PDF 파일이 돼요.
        </Banner>
      </div>
      <MillSheetPaper snapshot={s} />
      <MillSheetPrintPortal>
        <MillSheetPaper snapshot={s} />
      </MillSheetPrintPortal>
    </>
  );
}
