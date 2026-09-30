// 승인함 (REQ-AUTH-004). v1 B안 35번: 왼쪽 승인 대기 목록 | 오른쪽 요청 내용 + 승인·반려.
// 승인권자는 조직관리에서 지정한 부서장이다. Agent 대응 후보 승인은 P2라 자리만 남긴다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { approvalApi, purchaseRequisitionApi, type PurchaseRequisitionListItem } from '@/api/purchasing';
import { ComingSoon, Icon, QueryBoundary, StateView } from '@/components/ui';
import { fmtMD, fmtMDHM } from '@/lib/format';
import { canView, isDepartmentHead, useMe } from '@/stores/auth';
import { PrStatusBadge, SourceTag, itemsSummary, md } from '@/features/purchasing/common';
import { RequisitionPanel } from '@/features/purchasing/RequisitionPanel';

type Filter = 'WAITING' | 'DONE';
const HISTORY_LIMIT = 30;

export function ApprovalPage() {
  const me = useMe();
  const head = isDepartmentHead(me);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('WAITING');
  /** 처리 내역은 구매요청 목록에서 "승인권자 = 나"인 것을 골라 보여 준다 (목록 조회 권한이 있을 때만) */
  const canHistory = canView(me, 'PURCHASE_REQUISITION_CREATE', 'PO_CONFIRM');

  const approvals = useQuery({ queryKey: ['purchase-requisitions', 'approvals'], queryFn: approvalApi.mine });
  const history = useQuery({
    queryKey: ['purchase-requisitions', 'list', { mine: false }],
    queryFn: () => purchaseRequisitionApi.list({ mine: false }),
    enabled: canHistory && filter === 'DONE',
  });

  const waiting = approvals.data?.purchaseRequisitions ?? [];
  const done = (history.data ?? [])
    .filter((x) => x.approverId === me.employeeId && (x.purchaseRequisitionStatus === 'APPROVED' || x.purchaseRequisitionStatus === 'ORDERED' || x.purchaseRequisitionStatus === 'REJECTED'))
    .sort((a, b) => (b.approvedAt ?? b.rejectedAt ?? '').localeCompare(a.approvedAt ?? a.rejectedAt ?? ''))
    .slice(0, HISTORY_LIMIT);
  const rows = filter === 'WAITING' ? waiting : done;

  const selId = Number(params.get('pr')) || null;
  const sel = rows.find((x) => x.id === selId) ?? rows[0];
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('pr', String(id)); return n; }, { replace: true });
  const detail = useQuery({ queryKey: ['purchase-requisitions', 'detail', sel?.id], queryFn: () => purchaseRequisitionApi.get(sel!.id), enabled: !!sel });
  const next = filter === 'WAITING' && sel && waiting.length > 1 ? waiting[(waiting.findIndex((x) => x.id === sel.id) + 1) % waiting.length] : undefined;

  const item = (x: PurchaseRequisitionListItem) => (
    <div key={x.id} className={`hl-mitem${x.id === sel?.id ? ' is-active' : ''}`} style={filter === 'DONE' ? { opacity: 0.9 } : undefined} role="button" tabIndex={0} onClick={() => select(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(x.id); }}>
      <div className="hl-row">
        <span className="hl-link-id">{x.purchaseRequisitionNo}</span>
        <span style={{ marginLeft: 'auto' }}><PrStatusBadge status={x.purchaseRequisitionStatus} /></span>
      </div>
      <div className="hl-row" style={{ fontSize: 12 }}>
        <b>{itemsSummary(x.items)}</b>
        <span className="hl-muted">· {x.requester.employeeName}</span>
        <SourceTag source={x.sourceType} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="hl-row hl-cap">
        {filter === 'WAITING'
          ? <>{x.department.departmentName} · 제출 {fmtMDHM(x.submittedAt)}<span style={{ marginLeft: 'auto' }}>희망 {md(x.desiredReceiptDate)}</span></>
          : x.purchaseRequisitionStatus === 'REJECTED' ? `반려 ${fmtMD(x.rejectedAt)}` : `승인 ${fmtMD(x.approvedAt)}`}
      </div>
    </div>
  );

  return (
    <>
      <section className="hl-master" aria-label="승인 대기 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>승인 대기</b>
            <span className="hl-tag">{approvals.data?.counts.total ?? 0}</span>
          </div>
          <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`hl-chip${filter === 'WAITING' ? ' is-on' : ''}`} onClick={() => setFilter('WAITING')}>구매요청 <b>{approvals.data?.counts.purchaseRequisition ?? 0}</b></button>
            <button type="button" className="hl-chip" disabled title="준비 중 (P2)">Agent 대응 후보 <ComingSoon grade="P2" /></button>
            <button type="button" className={`hl-chip${filter === 'DONE' ? ' is-on' : ''}`} onClick={() => setFilter('DONE')} disabled={!head}>처리 완료</button>
          </div>
        </div>
        <div className="hl-master__list">
          <div className="hl-nav-group" style={{ padding: '10px 16px 4px' }}>{filter === 'WAITING' ? '구매요청' : `처리 완료 (최근 ${HISTORY_LIMIT}건)`}</div>
          {filter === 'WAITING' && approvals.isLoading ? <StateView kind="loading" /> : null}
          {filter === 'DONE' && history.isLoading ? <StateView kind="loading" /> : null}
          {rows.map(item)}
          {filter === 'WAITING' && approvals.data && !waiting.length ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>승인 대기 구매요청이 없어요</div> : null}
          {filter === 'DONE' ? (
            !canHistory ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>처리 내역은 구매요청 조회 권한이 있어야 볼 수 있어요</div>
            : history.error ? <div className="hl-cap hl-danger-text" style={{ padding: '6px 16px 10px' }}>처리 내역을 불러오지 못했어요</div>
            : history.data && !done.length ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>내가 승인·반려한 구매요청이 없어요</div>
            : null
          ) : null}
          {filter === 'WAITING' ? (
            <>
              <div className="hl-nav-group hl-row" style={{ padding: '14px 16px 4px', gap: 6 }}>Agent 대응 후보 <ComingSoon grade="P2" /></div>
              <div className="hl-cap" style={{ padding: '2px 16px 12px', lineHeight: '16px' }}>AI Factory Agent가 만든 대응 후보(구매요청 초안·재생산 계획 등)를 부서장이 승인하는 기능은 준비 중이에요.</div>
            </>
          ) : null}
        </div>
        <div className="hl-row hl-cap" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', alignItems: 'flex-start' }}>
          <Icon name="info" size="sm" />
          <span>승인 요청은 요청자 소속 부서의 부서장에게 가요. 요청자가 부서장이면 상위 부서의 부서장에게 가요.</span>
        </div>
      </section>
      <main className="hl-main" style={{ gap: 14 }}>
        {approvals.error && !approvals.data ? (
          <QueryBoundary query={approvals}>{() => null}</QueryBoundary>
        ) : !head && !waiting.length ? (
          <StateView
            kind="empty"
            title="승인할 항목이 없어요"
            text={<>구매요청 승인은 조직관리에서 지정한 <b>부서장</b>에게 가요. {me.employeeName}님은 부서장으로 지정돼 있지 않아요.</>}
            actions={canHistory ? <Link className="hl-btn" to="/purchase-requisitions"><Icon name="cart" />구매요청 목록</Link> : undefined}
          />
        ) : !sel ? (
          approvals.data ? (
            <StateView
              kind="empty"
              title={filter === 'WAITING' ? '승인할 항목이 없어요' : '처리 내역이 없어요'}
              text={filter === 'WAITING' ? `${me.departmentName} 부서장으로 지정돼 있어요. 부서원이 구매요청을 제출하면 여기에 올라와요` : undefined}
            />
          ) : null
        ) : (
          <QueryBoundary query={detail}>
            {(pr) => (
              <RequisitionPanel
                key={pr.id}
                pr={pr}
                crumb={<><Link to="/approvals">승인함</Link><Icon name="chevron-right" size="sm" />{pr.purchaseRequisitionNo}</>}
                headerActions={
                  <>
                    {next ? <button type="button" className="hl-btn hl-btn--ghost" onClick={() => select(next.id)}>다음 {next.purchaseRequisitionNo}</button> : null}
                    <Link className="hl-btn" to={`/purchase-requisitions/${pr.id}`}><Icon name="cart" />요청서 보기</Link>
                  </>
                }
              />
            )}
          </QueryBoundary>
        )}
      </main>
    </>
  );
}
