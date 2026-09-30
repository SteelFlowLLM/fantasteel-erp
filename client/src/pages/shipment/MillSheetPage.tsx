// 밀시트 조회·PDF (REQ-SHP-003·004). v1 B안 26번: 왼쪽 밀시트 목록 | 오른쪽 종이 모양 문서 (저장된 스냅샷만 표시).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fileUrl } from '@/api/client';
import { millSheetApi, type MillSheetListItem, type MillSheetView } from '@/api/shipments';
import { EmptyNote, Icon, QueryBoundary, Spinner, StateView } from '@/components/ui';
import { MillSheetPaper } from '@/features/shipment/MillSheetPaper';
import { PdfStatusBadge, itemTypeLabel } from '@/features/shipment/shipmentUi';
import { useAction } from '@/hooks/useApi';
import { fmtDate, fmtDateTime, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';
import './MillSheetPage.css';

type Chip = 'all' | 'SLAB' | 'COIL';

export function MillSheetPage() {
  const me = useMe();
  const canPdf = canUse(me, 'MILLSHEET_READ');
  const [params, setParams] = useSearchParams();
  const [chip, setChip] = useState<Chip>('all');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['mill-sheets', 'list', {}], queryFn: () => millSheetApi.list() });

  const all = list.data ?? [];
  const text = q.trim().toLowerCase();
  const rows = all.filter((m) => (chip === 'all' || m.itemType === chip)
    && (!text || [m.millSheetNo, m.customerName, m.salesOrderNo, m.goodsIssueNo, m.specCode, ...m.heatNos].some((s) => s.toLowerCase().includes(text))));
  // 출고(goodsIssue)별로 묶기 (목록 순서 유지)
  const groups: { goodsIssueId: number; goodsIssueNo: string; issuedAt: string; items: MillSheetListItem[] }[] = [];
  for (const m of rows) {
    const g = groups.find((x) => x.goodsIssueId === m.goodsIssueId);
    if (g) g.items.push(m);
    else groups.push({ goodsIssueId: m.goodsIssueId, goodsIssueNo: m.goodsIssueNo, issuedAt: m.issuedAt, items: [m] });
  }
  const paramId = Number(params.get('id')) || null;
  const selId = paramId ?? all[0]?.id ?? null;
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('id', String(id)); return n; });
  const count = (t: 'SLAB' | 'COIL') => all.filter((m) => m.itemType === t).length;
  const chipBtn = (key: Chip, label: string, n: number) => (
    <button type="button" className={`hl-chip${chip === key ? ' is-on' : ''}`} onClick={() => setChip(key)}>{label} <b>{n}</b></button>
  );

  return (
    <>
      <section className="hl-master" aria-label="밀시트 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>밀시트</b>
            <span className="hl-tag">{all.length}</span>
            <span className="hl-cap" style={{ marginLeft: 'auto' }}>출고 확정 시 자동 생성</span>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="밀시트·수주·고객사·규격·히트 검색" aria-label="밀시트 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: 6 }}>
            {chipBtn('all', '전체', all.length)}
            {chipBtn('SLAB', '슬래브', count('SLAB'))}
            {chipBtn('COIL', '코일', count('COIL'))}
          </div>
        </div>
        <div className="hl-master__list">
          {list.isLoading ? <div style={{ padding: 16 }}><Spinner /></div> : null}
          {list.error && !list.data ? <EmptyNote>{list.error instanceof Error ? list.error.message : '목록을 불러오지 못했어요'}</EmptyNote> : null}
          {groups.map((g) => (
            <div key={g.goodsIssueId}>
              <div style={{ padding: '6px 16px', background: '#F7F8FA', borderBottom: '1px solid #DDE2E7' }} className="hl-row hl-cap">
                {fmtMDHM(g.issuedAt)} 출고
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{g.goodsIssueNo}</span>
              </div>
              {g.items.map((m) => {
                const on = m.id === selId;
                return (
                  <div key={m.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} aria-current={on} onClick={() => select(m.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(m.id); }}>
                    <div className="hl-row">
                      <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{m.millSheetNo}</span>
                      <span style={{ marginLeft: 'auto' }}><PdfStatusBadge status={m.pdfStatus} /></span>
                    </div>
                    <div className="hl-row" style={{ fontSize: 12 }}>
                      <span>{m.customerName}</span>
                      <span className="hl-muted mono" style={{ marginLeft: 'auto' }}>{m.salesOrderNo} #{m.lineNo}</span>
                    </div>
                    <div className="hl-row hl-cap">
                      <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemTypeLabel(m.itemType)} {m.specCode}</span>
                      <span className="tnum" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{m.qty}{m.qtyUnit} · {fmtTon(m.weightTon)}</span>
                    </div>
                    <div className="hl-cap">발행 {fmtDate(m.issuedAt)}</div>
                  </div>
                );
              })}
            </div>
          ))}
          {list.data && !groups.length ? <EmptyNote>{all.length ? '조건에 맞는 밀시트가 없어요' : '아직 발행된 밀시트가 없어요. 출고를 확정하면 자동으로 생겨요'}</EmptyNote> : null}
        </div>
        <div style={{ borderTop: '1px solid #DDE2E7', padding: '12px 16px', background: '#F7F8FA', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="hl-label">스냅샷</span>
          <span className="hl-cap" style={{ lineHeight: '17px' }}>발행 시점 값을 스냅샷으로 저장해요 — 이후 원본이 바뀌어도 밀시트 값은 유지돼요.</span>
        </div>
      </section>
      <main className="hl-main ms-page" style={{ gap: 14 }}>
        {selId ? <MillSheetDetail key={selId} id={selId} canPdf={canPdf} /> : (
          list.isLoading ? <StateView kind="loading" /> : (
            <>
              <div className="hl-page-head">
                <div>
                  <div className="hl-crumb">출하<Icon name="chevron-right" size="sm" />밀시트</div>
                  <div className="hl-row" style={{ gap: 10 }}>
                    <h1 className="hl-title">밀시트</h1>
                    <span className="hl-badge">발행 없음</span>
                  </div>
                </div>
              </div>
              <article className="hl-paper" aria-label="밀시트" style={{ padding: '22px 28px', minHeight: 240, justifyContent: 'center' }}>
                <EmptyNote>출고 확정된 출하요청이 없어서 밀시트가 아직 없어요</EmptyNote>
              </article>
            </>
          )
        )}
      </main>
    </>
  );
}

function MillSheetDetail({ id, canPdf }: { id: number; canPdf: boolean }) {
  const detail = useQuery({ queryKey: ['mill-sheets', 'detail', id], queryFn: () => millSheetApi.get(id) });
  useShellTitle(detail.data?.millSheetNo ?? '밀시트', detail.data?.snapshot.customer.customerName);
  return <QueryBoundary query={detail}>{(m) => <MillSheetBody m={m} canPdf={canPdf} />}</QueryBoundary>;
}

function MillSheetBody({ m, canPdf }: { m: MillSheetView; canPdf: boolean }) {
  const s = m.snapshot;
  const [failure, setFailure] = useState<{ code: string | null; message: string } | null>(null);
  const pdfHref = () => fileUrl(millSheetApi.pdfPath(m.id));

  const generate = useAction(millSheetApi.generatePdf, {
    success: 'PDF를 만들었어요',
    invalidate: ['mill-sheets'],
    onSuccess: (r) => {
      setFailure(null);
      // 새 탭으로 연다. 브라우저가 팝업을 막으면 [PDF 열기] 버튼으로 열 수 있다.
      if (r.pdfStatus === 'READY') window.open(fileUrl(millSheetApi.pdfPath(r.id)), '_blank', 'noopener');
    },
    onError: (e) => setFailure({ code: e instanceof ApiError ? e.code : null, message: e instanceof Error ? e.message : 'PDF를 만들지 못했어요' }),
  });
  // 생성 직후에는 응답의 상태를, 그 밖에는 조회한 상태를 쓴다
  const pdfStatus = generate.data?.id === m.id && !failure ? generate.data.pdfStatus : m.pdfStatus;
  const ready = pdfStatus === 'READY';
  const failed = !!failure || pdfStatus === 'FAILED';
  const lockTitle = canPdf ? undefined : '권한이 필요해요';

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to="/goods-issues">출고 확정</Link>
            <Icon name="chevron-right" size="sm" />
            밀시트
          </div>
          <div className="hl-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h1 className="hl-title mono" style={{ fontSize: 19 }}>{m.millSheetNo}</h1>
            <span className="hl-badge hl-badge--ok">발행 완료</span>
            <PdfStatusBadge status={pdfStatus} />
            <span className="hl-cap">
              {s.customer.customerName} · <Link className="hl-link-id" to={`/sales-orders/${s.salesOrder.salesOrderId}`}>{s.salesOrder.salesOrderNo}</Link> #{s.salesOrder.lineNo} · 발행 {fmtDateTime(m.issuedAt)}
            </span>
          </div>
        </div>
        <div className="hl-page-head__actions">
          <Link className="hl-btn" to={`/business-events?salesOrderId=${s.salesOrder.salesOrderId}`}><Icon name="history" />작업 로그</Link>
          {s.lots[0] ? <Link className="hl-btn" to={`/lots/trace?lot=${encodeURIComponent(s.lots[0].lotNo)}`}><Icon name="trace" />LOT 추적</Link> : null}
          {ready ? (
            <a className="hl-btn hl-btn--primary" href={pdfHref()} target="_blank" rel="noopener noreferrer"><Icon name="download" />PDF 열기</a>
          ) : (
            <button type="button" className="hl-btn hl-btn--primary" disabled={!canPdf || generate.isPending} title={lockTitle} onClick={() => generate.mutate(m.id)}>
              <Icon name={canPdf ? (failed ? 'refresh' : 'file') : 'lock'} />
              {generate.isPending ? 'PDF 만드는 중…' : failed ? 'PDF 다시 생성' : 'PDF 생성'}
            </button>
          )}
        </div>
      </div>

      {failed ? (
        <div className="hl-banner hl-banner--danger" role="alert" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div style={{ flex: 1 }}>
            <b>PDF를 만들지 못했어요{failure?.code ? <> <span className="mono">({failure.code})</span></> : null}</b>
            <div>{failure?.message ?? '지난번 PDF 생성이 실패했어요.'}</div>
            <div className="hl-cap" style={{ color: 'inherit', marginTop: 2 }}>스냅샷은 그대로 저장돼 있어요. 다시 시도하면 같은 내용으로 다시 만들고, 출고는 다시 실행하지 않아요.</div>
          </div>
          <button type="button" className="hl-btn hl-btn--sm" disabled={!canPdf || generate.isPending} title={lockTitle} onClick={() => generate.mutate(m.id)}>
            <Icon name="refresh" />다시 시도
          </button>
        </div>
      ) : null}

      <div className="hl-banner hl-banner--run" style={{ flex: 'none' }}>
        <Icon name="info" />
        <div>발행 시점 값을 스냅샷으로 저장해요 — 이후 원본이 바뀌어도 밀시트 값은 유지돼요. 화면과 PDF 모두 이 스냅샷만 써요.</div>
      </div>

      <MillSheetPaper snapshot={s} style={{ gap: 12, padding: '22px 28px' }} />
    </>
  );
}
