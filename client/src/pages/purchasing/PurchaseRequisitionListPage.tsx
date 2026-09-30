// 구매요청 목록 (REQ-PUR-001·002). v1 B안 14번: 왼쪽 목록 | 오른쪽 선택한 요청 미리보기.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PURCHASE_REQUISITION_STATUS_LABEL, REQUISITION_SOURCE_TYPE_LABEL, type PurchaseRequisitionStatus, type RequisitionSourceType } from '@fantasteel/shared';
import { actionDraftApi } from '@/api/actionDrafts';
import { purchaseRequisitionApi, type PurchaseRequisitionListItem } from '@/api/purchasing';
import { EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { fmtMD, fmtTon, relTime } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import { PrStatusBadge, SourceTag, itemsSummary, md, roomLabel } from '@/features/purchasing/common';
import { RequisitionFormModal } from '@/features/purchasing/RequisitionFormModal';
import { RequisitionPanel } from '@/features/purchasing/RequisitionPanel';

const STATUSES: PurchaseRequisitionStatus[] = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'ORDERED', 'REJECTED'];
const SOURCES: RequisitionSourceType[] = ['DIRECT', 'MRP', 'MESSAGE'];
const SRC_COLOR: Record<RequisitionSourceType, string> = { DIRECT: '#9DB6D1', MRP: '#23507F', MESSAGE: '#5B3FC4' };

export function PurchaseRequisitionListPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<PurchaseRequisitionStatus | ''>('');
  const [source, setSource] = useState<RequisitionSourceType | ''>('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const canCreate = canUse(me, 'PURCHASE_REQUISITION_CREATE');

  const list = useQuery({ queryKey: ['purchase-requisitions', 'list', { mine }], queryFn: () => purchaseRequisitionApi.list({ mine }) });
  /** 내가 확정해야 하는 Message → ERP 초안 */
  const drafts = useQuery({ queryKey: ['action-drafts', 'mine-waiting'], queryFn: () => actionDraftApi.list({ mine: true, status: 'WAITING_APPROVAL' }) });

  const all = list.data ?? [];
  const text = q.trim().toLowerCase();
  const hit = (x: PurchaseRequisitionListItem) =>
    !text || [x.purchaseRequisitionNo, x.requester.employeeName, ...x.items.flatMap((it) => [it.rawMaterial.itemName, it.rawMaterial.materialCode])].some((s) => s.toLowerCase().includes(text));
  const base = all.filter((x) => (!source || x.sourceType === source) && hit(x));
  const rows = base.filter((x) => !status || x.purchaseRequisitionStatus === status);
  const count = (s: PurchaseRequisitionStatus) => base.filter((x) => x.purchaseRequisitionStatus === s).length;
  const srcCount = (s: RequisitionSourceType) => all.filter((x) => x.sourceType === s).length;

  const selId = Number(params.get('pr')) || null;
  const sel = rows.find((x) => x.id === selId) ?? rows[0];
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('pr', String(id)); return n; }, { replace: true });
  const detail = useQuery({ queryKey: ['purchase-requisitions', 'detail', sel?.id], queryFn: () => purchaseRequisitionApi.get(sel!.id), enabled: !!sel });

  return (
    <>
      <section className="hl-master" aria-label="구매요청 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>구매요청</b>
            <span className="hl-tag">{rows.length === all.length ? all.length : `${rows.length} / ${all.length}`}</span>
            <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)} disabled={!canCreate} title={canCreate ? '원료·톤·희망 입고일을 입력해 등록해요' : '권한이 필요해요'}>
              <Icon name={canCreate ? 'plus' : 'lock'} />
              구매요청 등록
            </button>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="요청번호·원료·요청자 검색" aria-label="구매요청 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`hl-chip${status === '' ? ' is-on' : ''}`} onClick={() => setStatus('')}>전체 <b>{base.length}</b></button>
            {STATUSES.map((s) => (
              <button key={s} type="button" className={`hl-chip${status === s ? ' is-on' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>{PURCHASE_REQUISITION_STATUS_LABEL[s]} <b>{count(s)}</b></button>
            ))}
          </div>
          <label className="hl-row" style={{ gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            내 요청만 보기
          </label>
        </div>
        <div className="hl-master__list">
          {drafts.data?.length ? (
            <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--ai-bg)' }}>
              <div className="hl-nav-group" style={{ padding: '10px 16px 4px' }}>확인 대기 초안 · {drafts.data.length}</div>
              {drafts.data.map((d) => (
                <Link key={d.id} className="hl-mitem" style={{ padding: '8px 16px', gap: 2, borderBottom: 0 }} to={`/action-drafts/${d.id}`}>
                  <div className="hl-row" style={{ fontSize: 12.5 }}>
                    <Icon name="hash" size="sm" />
                    <b style={{ fontWeight: 600 }}>{d.actionTypeLabel} 초안</b>
                    <span className="hl-cap">{d.message ? roomLabel(d.message.chatRoom) : '원본 메시지 없음'}</span>
                    <span className="hl-cap" style={{ marginLeft: 'auto' }}>{relTime(d.createdAt)}</span>
                  </div>
                  {d.message ? <span className="hl-cap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{d.message.content}”</span> : null}
                  <span className="hl-wait-text" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {d.unresolvedFields.length ? `${d.unresolvedFields.map((f) => d.fieldLabels[f] ?? f).join('·')} 입력 필요` : '값을 확인하고 확정해 주세요'}
                  </span>
                </Link>
              ))}
              <div className="hl-cap" style={{ padding: '2px 16px 10px' }}>메신저 메시지에서 만든 초안이에요. 내가 확정해야 구매요청이 생겨요.</div>
            </div>
          ) : null}
          {list.isLoading && !list.data ? <StateView kind="loading" /> : null}
          {rows.map((x) => {
            const on = x.id === sel?.id;
            return (
              <div key={x.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => select(x.id)} onDoubleClick={() => navigate(`/purchase-requisitions/${x.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') select(x.id); }}>
                <div className="hl-row">
                  <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{x.purchaseRequisitionNo}</span>
                  <span style={{ marginLeft: 'auto' }}><PrStatusBadge status={x.purchaseRequisitionStatus} /></span>
                </div>
                <div className="hl-row" style={{ fontSize: 12.5 }}>
                  <b style={{ fontWeight: 600 }}>{itemsSummary(x.items)}</b>
                  <span className="tnum hl-muted" style={{ marginLeft: 'auto' }}>희망 {md(x.desiredReceiptDate)}</span>
                </div>
                <div className="hl-row" style={{ fontSize: 12 }}>
                  <span className="hl-avatar hl-avatar--sm">{x.requester.employeeName.slice(0, 1)}</span>
                  {x.requester.employeeName}
                  <span className="hl-muted">· 합계 {fmtTon(x.totalRequiredTon)}</span>
                  <SourceTag source={x.sourceType} style={{ marginLeft: 'auto' }} />
                </div>
                <div className="hl-row hl-cap">
                  {x.purchaseRequisitionStatus === 'DRAFT' ? '제출 전'
                    : x.purchaseRequisitionStatus === 'WAITING_APPROVAL' ? `승인권자 ${x.approver?.employeeName ?? '-'} · 승인 대기`
                    : x.purchaseRequisitionStatus === 'APPROVED' ? <><span>승인 {x.approver?.employeeName ?? '-'} {fmtMD(x.approvedAt)}</span><span className="hl-wait-text" style={{ fontWeight: 600 }}>· 발주 대기</span></>
                    : x.purchaseRequisitionStatus === 'REJECTED' ? <span className="hl-danger-text" style={{ fontWeight: 600 }}>반려 · {x.approver?.employeeName ?? '-'} · 수정 필요</span>
                    : `승인 ${x.approver?.employeeName ?? '-'} · 발주 완료`}
                </div>
              </div>
            );
          })}
          {list.data && !rows.length ? <EmptyNote>{all.length ? '조건에 맞는 구매요청이 없어요' : mine ? '내가 등록한 구매요청이 없어요' : '등록된 구매요청이 없어요'}</EmptyNote> : null}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="hl-row hl-cap" style={{ justifyContent: 'space-between' }}>
            <span>출처별</span>
            <span>{mine ? '내 요청' : '전체'} {all.length}건</span>
          </div>
          {SOURCES.map((s) => (
            <button key={s} type="button" className="hl-bar-row" style={{ gridTemplateColumns: '72px 1fr 28px', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', opacity: source === '' || source === s ? 1 : 0.5 }} onClick={() => setSource(source === s ? '' : s)} aria-label={`출처 ${REQUISITION_SOURCE_TYPE_LABEL[s]}만 보기`} aria-pressed={source === s}>
              <b style={{ fontFamily: 'inherit' }}>{REQUISITION_SOURCE_TYPE_LABEL[s]}</b>
              <div className="hl-bar-track" style={{ height: 10 }}>
                <span style={{ width: `${all.length ? Math.round((srcCount(s) / all.length) * 100) : 0}%`, background: SRC_COLOR[s] }} />
              </div>
              <span className="num">{srcCount(s)}</span>
            </button>
          ))}
        </div>
      </section>
      <main className="hl-main" style={{ gap: 14 }}>
        {list.error && !list.data ? (
          <QueryBoundary query={list}>{() => null}</QueryBoundary>
        ) : !sel ? (
          list.data ? (
            <StateView
              kind="empty"
              title={all.length ? '조건에 맞는 구매요청이 없어요' : '구매요청이 없어요'}
              text="MRP 결과의 순소요를 보고 등록하거나, 메신저 메시지에서 초안을 만들 수 있어요"
              actions={<Link className="hl-btn" to="/mrp"><Icon name="calc" />MRP 결과 보기</Link>}
            />
          ) : null
        ) : (
          <QueryBoundary query={detail}>
            {(pr) => (
              <RequisitionPanel
                key={pr.id}
                pr={pr}
                crumb={<><Link to="/purchase-requisitions">구매요청</Link><Icon name="chevron-right" size="sm" />{pr.purchaseRequisitionNo}</>}
                headerActions={<Link className="hl-btn hl-btn--primary" to={`/purchase-requisitions/${pr.id}`}>상세 열기 <Icon name="chevron-right" /></Link>}
              />
            )}
          </QueryBoundary>
        )}
      </main>
      {creating ? <RequisitionFormModal onClose={() => setCreating(false)} onSaved={(pr) => select(pr.id)} /> : null}
    </>
  );
}
