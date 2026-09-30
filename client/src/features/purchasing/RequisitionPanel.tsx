// 구매요청 1건의 내용·진행 단계·출처·연결 발주·동작. 구매요청 목록(미리보기)·상세·승인함이 같이 쓴다.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { REQUISITION_SOURCE_TYPE_LABEL } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { purchaseRequisitionApi, type PurchaseRequisitionDetail } from '@/api/purchasing';
import { EmptyNote, Icon } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, fmtTon } from '@/lib/format';
import { canUse, canView, useMe } from '@/stores/auth';
import { DraftStatusBadge, OriginMessage, PoStatusBadge, PrStatusBadge, RequisitionFlow, d10, isPositive, md, personLabel } from '@/features/purchasing/common';
import { RequisitionFormModal } from '@/features/purchasing/RequisitionFormModal';

const INVALIDATE = ['purchase-requisitions', 'purchase-orders', 'mrp-runs'];
const REASON_MAX = 500;

export function RequisitionPanel({ pr, crumb, headerActions }: { pr: PurchaseRequisitionDetail; crumb?: ReactNode; headerActions?: ReactNode }) {
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);

  const status = pr.purchaseRequisitionStatus;
  const isRequester = pr.requesterId === me.employeeId;
  const isApprover = pr.approverId !== null && pr.approverId === me.employeeId;
  const canCreate = canUse(me, 'PURCHASE_REQUISITION_CREATE');
  const editable = isRequester && (status === 'DRAFT' || status === 'REJECTED');
  const canDecide = isApprover && status === 'WAITING_APPROVAL';
  const canOrder = canUse(me, 'PO_CONFIRM');
  const canSeeOrders = canView(me, 'PO_CONFIRM', 'RECEIPT_CONFIRM', 'PURCHASE_REQUISITION_CREATE');

  const submit = useAction(purchaseRequisitionApi.submit, {
    success: (r) => `제출했어요. ${r.approver?.employeeName ?? '부서장'} 승인을 기다려요`,
    invalidate: INVALIDATE,
    onSuccess: () => setSubmitError(null),
    onError: (e) => setSubmitError(e instanceof ApiError ? { code: e.code, message: e.message } : null),
  });
  const approve = useAction(purchaseRequisitionApi.approve, { success: '승인했어요. 구매 담당이 발주할 수 있어요', invalidate: INVALIDATE });
  const reject = useAction(purchaseRequisitionApi.reject, { success: '반려했어요. 요청자에게 사유가 전달돼요', invalidate: INVALIDATE, onSuccess: () => { setRejecting(false); setReason(''); } });
  const pending = submit.isPending || approve.isPending || reject.isPending;

  const approverName = pr.approver ? personLabel(pr.approver) : null;
  const message = pr.sourceDraft?.message ?? null;
  const poItems = pr.items.flatMap((it) => it.purchaseOrderItems.map((po) => ({ ...po, rawMaterial: it.rawMaterial })));
  const hasUnordered = pr.items.some((it) => isPositive(it.unorderedTon));
  const reasonOk = reason.trim().length >= 1 && reason.length <= REASON_MAX;

  const stepText =
    status === 'DRAFT' ? <>요청자 <b>{pr.requester.employeeName}</b> 작성 중 · 제출하면 부서장 승인으로 넘어가요</>
    : status === 'WAITING_APPROVAL' ? <><b>{approverName ?? '부서장'}</b> 승인 대기 · 승인되면 구매 담당이 발주해요</>
    : status === 'APPROVED' ? <><b>{approverName ?? '부서장'}</b> 승인 {fmtMDHM(pr.approvedAt)} · 발주 대기</>
    : status === 'ORDERED' ? <>발주 완료 · {poItems.length ? <b className="mono">{[...new Set(poItems.map((p) => p.purchaseOrderNo))].join(', ')}</b> : null}</>
    : <><b>{approverName ?? '부서장'}</b> 반려 {fmtMDHM(pr.rejectedAt)} · 요청자가 고친 뒤 다시 제출할 수 있어요</>;

  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="hl-col" style={{ gap: 2, minWidth: 0 }}>
          {crumb ? <div className="hl-crumb">{crumb}</div> : null}
          <div className="hl-row" style={{ flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 0 }}>{pr.purchaseRequisitionNo}</span>
            <b style={{ fontSize: 16 }}>{pr.items.length === 1 ? pr.items[0].rawMaterial.itemName : `원료 ${pr.items.length}종`} {fmtTon(pr.totalRequiredTon)}</b>
            <PrStatusBadge status={status} />
          </div>
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto' }}>
          {message ? <Link className="hl-btn" to={`/messenger?room=${message.chatRoom.id}`}><Icon name="chat" />원본 메시지</Link> : null}
          {status === 'APPROVED' && hasUnordered ? (
            canOrder ? (
              <Link className="hl-btn" to={`/purchase-orders?pr=${pr.id}`}><Icon name="building" />발주 만들기</Link>
            ) : (
              <button type="button" className="hl-btn" disabled title="권한이 필요해요"><Icon name="lock" />발주 만들기</button>
            )
          ) : null}
          {headerActions}
        </div>
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <div className="hl-card__body" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '12px 16px', flexWrap: 'wrap' }}>
          <span className="hl-cap">진행 단계</span>
          <RequisitionFlow status={status} />
          <span className="hl-sep" />
          <span style={{ fontSize: 12.5 }}>{stepText}</span>
        </div>
      </section>

      {submitError ? (
        <div className="hl-banner hl-banner--danger" role="alert" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div>
            <b>{submitError.code === 'PUR-001' ? '승인권자가 없어 제출하지 못했어요' : '제출하지 못했어요'}</b>
            <div>{submitError.message}</div>
          </div>
        </div>
      ) : null}
      {status === 'REJECTED' ? (
        <div className="hl-banner hl-banner--danger" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div>
            <b>반려 사유</b> · {pr.rejectReason ?? '사유가 기록되지 않았어요'}
            <div className="hl-cap">{approverName ?? '부서장'} · {fmtMDHM(pr.rejectedAt)}</div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, flex: 'none' }}>
        <section className="hl-card" style={{ minWidth: 0 }}>
          <header className="hl-card__head">
            <h3>요청 내용</h3>
            <span className="hl-card__meta">{REQUISITION_SOURCE_TYPE_LABEL[pr.sourceType]} · {fmtMDHM(pr.createdAt)} 등록</span>
          </header>
          <div style={{ overflowX: 'auto' }}>
            <table className="hl-table hl-table--compact">
              <thead>
                <tr><th style={{ width: 36 }}>#</th><th>원료</th><th className="num">요청</th><th className="num">발주 누계</th><th className="num">미발주</th></tr>
              </thead>
              <tbody>
                {pr.items.map((it) => (
                  <tr key={it.id}>
                    <td className="hl-muted">{it.lineNo}</td>
                    <td>{it.rawMaterial.itemName} <span className="mono hl-muted">{it.rawMaterial.materialCode}</span></td>
                    <td className="num">{fmtTon(it.requiredTon)}</td>
                    <td className={`num${isPositive(it.orderedTon) ? '' : ' hl-muted'}`}>{fmtTon(it.orderedTon)}</td>
                    <td className={`num${isPositive(it.unorderedTon) ? '' : ' hl-muted'}`}>{fmtTon(it.unorderedTon)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td /><td>합계</td><td className="num">{fmtTon(pr.totalRequiredTon)}</td><td /><td /></tr>
              </tfoot>
            </table>
          </div>
          <div className="hl-card__body" style={{ padding: '12px 16px', gap: 10 }}>
            <dl className="hl-kv" style={{ rowGap: 7 }}>
              <dt>희망 입고일</dt>
              <dd className="tnum">{d10(pr.desiredReceiptDate) || '-'}</dd>
              <dt>요청자</dt>
              <dd>{personLabel(pr.requester)} · {pr.department.departmentName}</dd>
              <dt>승인권자</dt>
              <dd>{pr.approver ? <>{personLabel(pr.approver)} · {pr.approver.department.departmentName} <span className="hl-cap">부서장</span></> : <span className="hl-muted">제출하면 소속 부서의 부서장으로 정해져요</span>}</dd>
              <dt>요청 사유</dt>
              <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pr.requestReason ?? <span className="hl-muted">-</span>}</dd>
              <dt>승인 경로</dt>
              <dd>
                <span className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="hl-avatar hl-avatar--sm">{pr.requester.employeeName.slice(0, 1)}</span>
                  {pr.requester.employeeName} 제출
                  <Icon name="chevron-right" size="sm" />
                  <span className="hl-avatar hl-avatar--sm">{pr.approver ? pr.approver.employeeName.slice(0, 1) : '부'}</span>
                  {pr.approver ? pr.approver.employeeName : '부서장'} 승인
                  <Icon name="chevron-right" size="sm" />
                  <span className="hl-avatar hl-avatar--sm">구</span>
                  구매 발주
                </span>
              </dd>
            </dl>
          </div>
        </section>

        <div className="hl-col" style={{ gap: 14, minWidth: 0 }}>
          <section className="hl-card">
            <header className="hl-card__head">
              <h3>{pr.sourceType === 'MESSAGE' ? '원본 메시지' : '출처'}</h3>
              <span className="hl-tag" style={{ marginLeft: 'auto' }}>{REQUISITION_SOURCE_TYPE_LABEL[pr.sourceType]}</span>
            </header>
            <div className="hl-card__body" style={{ padding: '12px 14px', gap: 8 }}>
              {pr.sourceType === 'MESSAGE' ? (
                <>
                  {message ? (
                    <OriginMessage message={message}>
                      {pr.sourceDraft ? <Link to={`/action-drafts/${pr.sourceDraft.id}`} style={{ fontWeight: 600 }}>초안 보기 <Icon name="chevron-right" size="sm" /></Link> : null}
                    </OriginMessage>
                  ) : (
                    <div className="hl-origin">
                      <Icon name="chat" size="sm" />
                      <span>메신저 메시지에서 만든 요청이에요. 원본 메시지를 불러올 수 없어요. {pr.sourceDraftId ? <Link to={`/action-drafts/${pr.sourceDraftId}`}>초안 보기</Link> : null}</span>
                    </div>
                  )}
                  {pr.sourceDraft ? (
                    <div className="hl-row hl-cap" style={{ gap: 6 }}>
                      Message → ERP 초안 <DraftStatusBadge status={pr.sourceDraft.draftStatus} />
                      {pr.sourceDraft.confirmedAt ? <span>요청자 확정 {fmtMDHM(pr.sourceDraft.confirmedAt)}</span> : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="hl-origin">
                  <Icon name={pr.sourceType === 'MRP' ? 'calc' : 'info'} size="sm" />
                  <span>
                    {pr.sourceType === 'MRP' ? <>MRP 결과의 순소요를 보고 등록한 요청이에요 · <Link to="/mrp">MRP 결과</Link></> : '요청자가 직접 등록한 요청이에요'}
                    {' · '}{fmtMDHM(pr.createdAt)}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="hl-card">
            <header className="hl-card__head">
              <h3>연결 발주</h3>
              <span className="hl-tag">{poItems.length}</span>
              {canSeeOrders ? (
                <div className="hl-card__actions">
                  <Link className="hl-btn hl-btn--sm hl-btn--ghost" to="/purchase-orders">발주 화면 <Icon name="chevron-right" /></Link>
                </div>
              ) : null}
            </header>
            {poItems.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="hl-table hl-table--compact">
                  <thead>
                    <tr><th>발주번호</th><th>원료</th><th>공급업체</th><th className="num">발주</th><th className="num">입고</th><th>납기</th><th>상태</th></tr>
                  </thead>
                  <tbody>
                    {poItems.map((po) => (
                      <tr key={po.id}>
                        <td>{canSeeOrders ? <Link className="hl-link-id" to={`/purchase-orders?po=${po.purchaseOrderId}`}>{po.purchaseOrderNo}</Link> : <span className="mono">{po.purchaseOrderNo}</span>}</td>
                        <td>{po.rawMaterial.itemName}</td>
                        <td>{po.supplier.supplierName}</td>
                        <td className="num">{fmtTon(po.orderedTon)}</td>
                        <td className={`num${isPositive(po.receivedTon) ? '' : ' hl-muted'}`}>{fmtTon(po.receivedTon)}</td>
                        <td className="tnum">{md(po.dueDate)}</td>
                        <td><PoStatusBadge status={po.purchaseOrderStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyNote>{status === 'APPROVED' ? '아직 발주하지 않았어요. 구매 담당이 발주 화면에서 발주해요' : '승인된 뒤에 발주할 수 있어요'}</EmptyNote>
            )}
          </section>
        </div>
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <div className="hl-row" style={{ padding: '12px 16px', gap: 8, flexWrap: 'wrap' }}>
          {editable ? (
            <>
              <span className="hl-cap">{status === 'REJECTED' ? '반려된 요청이에요. 고친 뒤 다시 제출할 수 있어요' : '작성 중이에요. 제출해야 부서장 승인으로 넘어가요'}</span>
              <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)} disabled={!canCreate || pending} title={canCreate ? undefined : '권한이 필요해요'}>
                <Icon name="edit" />
                수정
              </button>
              <button type="button" className="hl-btn hl-btn--primary" onClick={() => submit.mutate(pr.id)} disabled={!canCreate || pending} title={canCreate ? undefined : '권한이 필요해요'}>
                <Icon name="send" />
                {status === 'REJECTED' ? '다시 제출' : '제출 → 부서장 승인 요청'}
              </button>
            </>
          ) : canDecide ? (
            rejecting ? (
              <>
                <div className="hl-col" style={{ flex: 1, minWidth: 240, gap: 3 }}>
                  <input className="hl-input" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder="반려 사유 (요청자에게 전달돼요)" aria-label="반려 사유" autoFocus />
                  {!reason.trim() ? <span className="hl-field__hint">반려하려면 사유를 입력해 주세요</span> : null}
                </div>
                <button type="button" className="hl-btn hl-btn--ghost" onClick={() => { setRejecting(false); setReason(''); }} disabled={pending}>취소</button>
                <button type="button" className="hl-btn hl-btn--danger-outline" onClick={() => reject.mutate({ id: pr.id, rejectReason: reason.trim() })} disabled={!reasonOk || pending}>반려 확정</button>
              </>
            ) : (
              <>
                <span className="hl-lockhint" style={{ fontSize: 12 }}>
                  <Icon name="shield" size="sm" />
                  승인권자(부서장)로 지정돼 있어요 · 요청자 {pr.requester.employeeName} 제출 {fmtMDHM(pr.submittedAt)}
                </span>
                <button type="button" className="hl-btn hl-btn--danger-outline" style={{ marginLeft: 'auto' }} onClick={() => setRejecting(true)} disabled={pending}>반려</button>
                <button type="button" className="hl-btn hl-btn--primary" onClick={() => approve.mutate(pr.id)} disabled={pending}><Icon name="check" />승인</button>
              </>
            )
          ) : (
            <span className="hl-lockhint" style={{ fontSize: 12 }}>
              <Icon name="lock" size="sm" />
              {status === 'DRAFT' || status === 'REJECTED'
                ? `수정·제출은 요청자(${pr.requester.employeeName})만 할 수 있어요`
                : status === 'WAITING_APPROVAL'
                  ? `승인·반려는 승인권자(${approverName ?? '부서장'})만 할 수 있어요`
                  : status === 'APPROVED'
                    ? '승인된 구매요청만 발주할 수 있어요 · 구매 담당 발주 대기'
                    : '발주까지 끝난 요청이에요'}
            </span>
          )}
        </div>
      </section>

      {editing ? <RequisitionFormModal target={pr} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
