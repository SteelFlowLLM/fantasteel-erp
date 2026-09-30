// Message → ERP 구매요청 초안 (REQ-ACT-001~003, SPEC 9장 #2). v1 B안 15번의 초안 확인 화면.
// AI 자동 추출은 없다: 값은 비어 있는 채로 만들어지고 요청자(메시지 작성자)가 직접 입력·확정한다.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { actionDraftApi, isExecutionFailure, type ActionDraftPayloadPatch, type ActionDraftView } from '@/api/actionDrafts';
import { ApiError } from '@/api/client';
import { DateInput } from '@/components/DateInput';
import { ComingSoon, Icon, QueryBoundary, StateView } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, todayStr } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';
import { DraftFlow, DraftStatusBadge, OriginMessage, PrStatusBadge, personLabel, tonError, tonInput, usePurchasingLookups } from '@/features/purchasing/common';

const REASON_MAX = 500;
const INVALIDATE = ['action-drafts', 'purchase-requisitions'];

export function ActionDraftPage() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const draft = useQuery({ queryKey: ['action-drafts', 'detail', id], queryFn: () => actionDraftApi.get(id), enabled: valid });
  useShellTitle(draft.data ? `${draft.data.actionTypeLabel} 초안` : '구매요청 초안', draft.data?.requester.employeeName);

  if (!valid) {
    return (
      <main className="hl-main">
        <StateView kind="empty" title="초안을 찾을 수 없어요" actions={<Link className="hl-btn" to="/purchase-requisitions">구매요청 목록</Link>} />
      </main>
    );
  }
  return (
    <main className="hl-main" style={{ gap: 14 }}>
      <QueryBoundary query={draft}>{(d) => <DraftBody key={d.id} draft={d} />}</QueryBoundary>
    </main>
  );
}

interface Form { rawMaterialId: number | ''; ton: string; date: string; reason: string }
const toForm = (d: ActionDraftView): Form => ({
  rawMaterialId: d.payload.rawMaterialId ?? '',
  ton: tonInput(d.payload.requiredTon),
  date: d.payload.desiredReceiptDate ?? '',
  reason: d.payload.requestReason ?? '',
});
const sameForm = (a: Form, b: Form) => a.rawMaterialId === b.rawMaterialId && a.ton.trim() === b.ton.trim() && a.date === b.date && a.reason.trim() === b.reason.trim();

function DraftBody({ draft }: { draft: ActionDraftView }) {
  const me = useMe();
  const lookups = usePurchasingLookups();
  const [form, setForm] = useState<Form>(() => toForm(draft));
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  /** 확정을 눌렀는데 필수값이 비어 서버가 거부했을 때(ACT-001) 등의 안내 */
  const [confirmError, setConfirmError] = useState<{ code: string; message: string } | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const today = todayStr();

  const saved = toForm(draft);
  const dirty = !sameForm(form, saved);
  // 다른 창에서 저장된 값이 오면 (내가 고치는 중이 아닐 때) 폼을 맞춘다
  const lastSaved = useRef(saved);
  useEffect(() => {
    const next = toForm(draft);
    setForm((f) => (sameForm(f, lastSaved.current) ? next : f));
    lastSaved.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.updatedAt]);

  const status = draft.draftStatus;
  const isRequester = draft.requesterId === me.employeeId;
  const canCreate = canUse(me, 'PURCHASE_REQUISITION_CREATE');
  const editable = isRequester && status === 'WAITING_APPROVAL';
  const failure = isExecutionFailure(draft.executionResult) ? draft.executionResult : null;
  /** 확정은 됐지만 구매요청 생성이 실패해 멈춘 초안 (예: 부서장 미지정) */
  const stuck = status === 'APPROVED' && !!failure;
  const ro = !editable;

  const update = useAction(actionDraftApi.update, { invalidate: INVALIDATE });
  const confirm = useAction(actionDraftApi.confirm, {
    success: (d) => (d.purchaseRequisition ? `구매요청 ${d.purchaseRequisition.purchaseRequisitionNo} 을(를) 만들었어요. 부서장 승인을 기다려요` : '확정했어요'),
    invalidate: INVALIDATE,
    onSuccess: () => { setConfirmError(null); setShowUnresolved(false); },
    onError: (e) => {
      if (e instanceof ApiError) {
        setConfirmError({ code: e.code, message: e.message });
        if (e.code === 'ACT-001') setShowUnresolved(true);
      }
    },
  });
  const reject = useAction(actionDraftApi.reject, { success: '초안을 반려했어요', invalidate: INVALIDATE, onSuccess: () => setRejecting(false) });
  const pending = update.isPending || confirm.isPending || reject.isPending;

  const materials = lookups.data?.rawMaterials ?? [];
  const mat = materials.find((m) => m.id === form.rawMaterialId);
  const supplier = mat?.defaultSupplierId ? lookups.data?.suppliers.find((s) => s.id === mat.defaultSupplierId)?.supplierName : undefined;
  const tonErr = form.ton.trim() ? tonError(form.ton) : null;
  const dateErr = form.date && form.date < today ? '오늘 이후 날짜로 입력해 주세요' : null;
  const reasonErr = form.reason.length > REASON_MAX ? `${REASON_MAX}자까지 쓸 수 있어요` : null;
  const inputValid = !tonErr && !dateErr && !reasonErr;

  // 서버가 알려 준 미확정 필드 중 아직 폼에서도 비어 있는 것
  const emptyNow: Record<string, boolean> = { rawMaterialId: form.rawMaterialId === '', requiredTon: !form.ton.trim(), desiredReceiptDate: !form.date };
  const unresolved = (field: string) => showUnresolved && draft.unresolvedFields.includes(field) && (emptyNow[field] ?? true);
  const label = (field: string, fallback: string) => draft.fieldLabels[field] ?? fallback;

  const patchOf = (): ActionDraftPayloadPatch => ({
    rawMaterialId: form.rawMaterialId === '' ? null : form.rawMaterialId,
    requiredTon: form.ton.trim() || null,
    desiredReceiptDate: form.date || null,
    requestReason: form.reason.trim() || null,
  });
  const save = () => update.mutate({ id: draft.id, payload: patchOf() });
  const doConfirm = async () => {
    setConfirmError(null);
    try {
      if (dirty) await update.mutateAsync({ id: draft.id, payload: patchOf() });
      await confirm.mutateAsync(draft.id);
    } catch {
      // 실패 안내는 useAction(토스트)과 위 onError(폼 위 안내·필드 강조)가 한다
    }
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const rowStyle = (field: string) => (unresolved(field) ? { background: '#FFFBF5' } : undefined);
  const materialName = mat?.name ?? (draft.payload.rawMaterialId ? `원료 #${draft.payload.rawMaterialId}` : '');
  const reasonOk = rejectReason.trim().length >= 1 && rejectReason.length <= REASON_MAX;
  const pr = draft.purchaseRequisition;

  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="hl-col" style={{ gap: 2 }}>
          <div className="hl-crumb">
            {draft.message ? <Link to={`/messenger?room=${draft.message.chatRoom.id}`}>메신저</Link> : <Link to="/purchase-requisitions">구매요청</Link>}
            <Icon name="chevron-right" size="sm" />
            {draft.actionTypeLabel} 초안
          </div>
          <div className="hl-row" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 18, lineHeight: '26px' }}>{draft.actionTypeLabel} 초안</b>
            <span className="hl-cap">Message → ERP · {fmtMDHM(draft.createdAt)} 생성</span>
            <DraftStatusBadge status={status} />
          </div>
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto' }}>
          <Link className="hl-btn" to="/purchase-requisitions"><Icon name="cart" />구매요청 목록</Link>
          {draft.message ? <Link className="hl-btn" to={`/messenger?room=${draft.message.chatRoom.id}`}><Icon name="chat" />원본 메시지로 이동</Link> : null}
        </div>
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <div className="hl-card__body" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: '12px 16px', flexWrap: 'wrap' }}>
          <DraftFlow status={status} />
          <span className="hl-sep" />
          <div className="hl-row" style={{ gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
            <span className="hl-cap">{status === 'WAITING_APPROVAL' ? '다음' : '경로'}</span>
            <span className="hl-avatar hl-avatar--sm">{draft.requester.employeeName.slice(0, 1)}</span>
            {draft.requester.employeeName} 확정
            <Icon name="chevron-right" size="sm" />
            구매요청 생성
            <Icon name="chevron-right" size="sm" />
            <span className="hl-avatar hl-avatar--sm">부</span>
            부서장 승인
            <Icon name="chevron-right" size="sm" />
            <span className="hl-avatar hl-avatar--sm">구</span>
            구매 발주
          </div>
        </div>
      </section>

      {status === 'EXECUTED' && pr ? (
        <div className="hl-banner hl-banner--ok" style={{ flex: 'none', alignItems: 'center' }}>
          <Icon name="check-circle" />
          <div>
            <b>구매요청 <Link className="hl-link-id" to={`/purchase-requisitions/${pr.id}`}>{pr.purchaseRequisitionNo}</Link> 을(를) 만들었어요</b>{' '}
            <PrStatusBadge status={pr.purchaseRequisitionStatus} />
            <div>{pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' ? '이제 부서장 승인을 기다려요. 초안 확정과 구매요청 승인은 따로예요.' : '초안 확정은 끝났어요. 구매요청의 진행 상태는 구매요청 화면에서 볼 수 있어요.'}</div>
          </div>
          <div className="hl-banner__actions">
            <Link className="hl-btn hl-btn--sm" to={`/purchase-requisitions/${pr.id}`}>구매요청 보기 <Icon name="chevron-right" /></Link>
          </div>
        </div>
      ) : null}
      {status === 'REJECTED' ? (
        <div className="hl-banner hl-banner--danger" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div>
            <b>반려된 초안이에요</b> · {draft.rejectReason ?? '사유가 기록되지 않았어요'}
            <div className="hl-cap">{draft.requester.employeeName} · {fmtMDHM(draft.rejectedAt)} · 구매요청은 만들어지지 않았어요</div>
          </div>
        </div>
      ) : null}
      {stuck && failure ? (
        <div className="hl-banner hl-banner--danger" role="alert" style={{ flex: 'none', alignItems: 'center' }}>
          <Icon name="alert" />
          <div>
            <b>{failure.errorCode === 'PUR-001' ? '승인권자가 없어 구매요청을 만들지 못했어요' : '확정했지만 구매요청을 만들지 못했어요'}</b>
            <div>{failure.errorMessage}</div>
            <div className="hl-cap">시도 {failure.attemptCount}회 · 마지막 {fmtMDHM(failure.lastAttemptAt)} · 원인을 고친 뒤 다시 실행할 수 있어요</div>
          </div>
        </div>
      ) : null}
      {confirmError && !stuck ? (
        <div className="hl-banner hl-banner--danger" role="alert" style={{ flex: 'none' }}>
          <Icon name="alert" />
          <div>
            <b>{confirmError.code === 'ACT-001' ? '아직 확정할 수 없어요' : confirmError.code === 'PUR-001' ? '승인권자가 없어 구매요청을 만들지 못했어요' : '확정하지 못했어요'}</b>
            <div>{confirmError.message}</div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 14, flex: 'none', alignItems: 'start' }}>
        <div className={`hl-draft${status === 'EXECUTED' ? ' is-executed' : status === 'APPROVED' ? ' is-approved' : ''}`} style={{ minWidth: 0 }}>
          <div className="hl-draft__head" style={{ flexWrap: 'wrap' }}>
            <b>{editable ? '값을 입력하고 확정해 주세요' : '초안 내용'}</b>
            <ComingSoon grade="AI" />
            <span className="hl-cap">AI 자동 추출은 준비 중이에요. 값을 직접 입력해 주세요.</span>
            <span style={{ marginLeft: 'auto' }}><DraftStatusBadge status={status} /></span>
          </div>
          <div className="hl-draft__body" style={{ padding: '14px 16px', gap: 0, overflowX: 'auto' }}>
            <table className="hl-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>항목</th>
                  <th>값</th>
                  <th style={{ width: 200 }}>기준</th>
                </tr>
              </thead>
              <tbody>
                <tr style={rowStyle('rawMaterialId')}>
                  <td className="hl-ink2" style={{ height: 56 }}>원료 품목<span className="hl-danger-text">*</span></td>
                  <td>
                    {ro ? (
                      <input className="hl-input" readOnly aria-label="원료 품목" value={materialName} placeholder="입력되지 않았어요" />
                    ) : (
                      <span className="hl-selectwrap">
                        <select className={`hl-input${unresolved('rawMaterialId') ? ' is-error' : ''}`} aria-label="원료 품목" value={form.rawMaterialId} onChange={(e) => set('rawMaterialId', e.target.value ? Number(e.target.value) : '')} disabled={pending}>
                          <option value="">원료를 골라 주세요</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.materialCode}</option>)}
                          {form.rawMaterialId !== '' && !mat ? <option value={form.rawMaterialId}>원료 #{form.rawMaterialId} (사용 중지)</option> : null}
                        </select>
                        <Icon name="chevron-down" size="sm" />
                      </span>
                    )}
                    {unresolved('rawMaterialId') ? <span className="hl-field__hint hl-danger-text">{label('rawMaterialId', '원료')}을(를) 골라 주세요</span> : null}
                  </td>
                  <td className="hl-cap">{mat ? (supplier ? `기본 공급업체 ${supplier}` : '기본 공급업체 미지정') : '기준정보에 등록된 원료'}</td>
                </tr>
                <tr style={rowStyle('requiredTon')}>
                  <td className="hl-ink2" style={{ height: 56 }}>{label('requiredTon', '수량(톤)')}<span className="hl-danger-text">*</span></td>
                  <td>
                    <span className="hl-inputwrap" style={{ width: 170, display: 'inline-block' }}>
                      <input className={`hl-input num${(tonErr && !ro) || unresolved('requiredTon') ? ' is-error' : ''}`} style={{ paddingRight: 28 }} inputMode="decimal" placeholder={ro ? '' : '0.000'} aria-label="수량(톤)" value={form.ton} readOnly={ro} disabled={!ro && pending} onChange={(e) => set('ton', e.target.value)} />
                      <span className="hl-suffix">t</span>
                    </span>
                    {tonErr && !ro ? <span className="hl-field__hint hl-danger-text" style={{ display: 'block' }}>{tonErr}</span> : unresolved('requiredTon') ? <span className="hl-field__hint hl-danger-text" style={{ display: 'block' }}>{label('requiredTon', '수량(톤)')}을(를) 입력해 주세요</span> : null}
                  </td>
                  <td className="hl-cap">0보다 큰 톤 · 소수 3자리까지</td>
                </tr>
                <tr style={rowStyle('desiredReceiptDate')}>
                  <td className="hl-ink2" style={{ height: 56 }}>{label('desiredReceiptDate', '희망 입고일')}<span className="hl-danger-text">*</span></td>
                  <td>
                    {ro ? (
                      <input className="hl-input tnum" style={{ width: 170 }} readOnly aria-label="희망 입고일" value={form.date} placeholder="입력되지 않았어요" />
                    ) : (
                      <DateInput value={form.date} onChange={(v) => set('date', v)} min={today} ariaLabel="희망 입고일" disabled={pending} width={170} invalid={!!dateErr || unresolved('desiredReceiptDate')} />
                    )}
                    {dateErr && !ro ? <span className="hl-field__hint hl-danger-text" style={{ display: 'block' }}>{dateErr}</span> : unresolved('desiredReceiptDate') ? <span className="hl-field__hint hl-danger-text" style={{ display: 'block' }}>{label('desiredReceiptDate', '희망 입고일')}을(를) 입력해 주세요</span> : null}
                  </td>
                  <td className="hl-cap">오늘 이후 날짜</td>
                </tr>
                <tr>
                  <td className="hl-ink2" style={{ height: 56 }}>{label('requesterId', '요청자')}</td>
                  <td>
                    <input className="hl-input" style={{ maxWidth: 280 }} readOnly aria-label="요청자" value={`${personLabel(draft.requester)} · ${draft.requester.department.departmentName}`} />
                  </td>
                  <td className="hl-cap">메시지 작성자 · 바꿀 수 없어요</td>
                </tr>
                <tr>
                  <td className="hl-ink2" style={{ height: 80, borderBottom: 0 }}>{label('requestReason', '요청 사유')}</td>
                  <td style={{ borderBottom: 0 }}>
                    <textarea className={`hl-input${reasonErr && !ro ? ' is-error' : ''}`} rows={2} aria-label="요청 사유" placeholder={ro ? '' : '어디에 쓰는지, 왜 필요한지 (선택)'} value={form.reason} readOnly={ro} disabled={!ro && pending} onChange={(e) => set('reason', e.target.value)} />
                    {reasonErr && !ro ? <span className="hl-field__hint hl-danger-text">{reasonErr}</span> : null}
                  </td>
                  <td className="hl-cap" style={{ borderBottom: 0 }}>{REASON_MAX}자 이하 · 선택</td>
                </tr>
              </tbody>
            </table>
            {lookups.error ? <span className="hl-danger-text" style={{ fontSize: 12.5, marginTop: 8 }}>원료 목록을 불러오지 못했어요</span> : null}
          </div>
          <div className="hl-draft__actions" style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', alignItems: 'center' }}>
            {editable ? (
              rejecting ? (
                <>
                  <input className="hl-input" style={{ flex: 1, minWidth: 220 }} value={rejectReason} maxLength={REASON_MAX} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유 (필수)" aria-label="반려 사유" autoFocus />
                  <button type="button" className="hl-btn hl-btn--ghost" onClick={() => setRejecting(false)} disabled={pending}>취소</button>
                  <button type="button" className="hl-btn hl-btn--danger-outline" onClick={() => reject.mutate({ id: draft.id, rejectReason: rejectReason.trim() })} disabled={!reasonOk || pending}>반려 확정</button>
                </>
              ) : (
                <>
                  <button type="button" className="hl-btn hl-btn--ghost" onClick={() => setRejecting(true)} disabled={pending}><Icon name="x-circle" />반려</button>
                  <span className="hl-cap">{dirty ? '저장하지 않은 수정이 있어요' : `마지막 저장 ${fmtMDHM(draft.updatedAt)}`}</span>
                  <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={save} disabled={!dirty || !inputValid || pending}><Icon name="check" />저장</button>
                  <button type="button" className="hl-btn hl-btn--primary" onClick={() => void doConfirm()} disabled={!inputValid || !canCreate || pending} title={canCreate ? undefined : '권한이 필요해요'}>
                    <Icon name={canCreate ? 'send' : 'lock'} />
                    확정하고 구매요청 만들기
                  </button>
                </>
              )
            ) : stuck && isRequester ? (
              rejecting ? (
                <>
                  <input className="hl-input" style={{ flex: 1, minWidth: 220 }} value={rejectReason} maxLength={REASON_MAX} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유 (필수)" aria-label="반려 사유" autoFocus />
                  <button type="button" className="hl-btn hl-btn--ghost" onClick={() => setRejecting(false)} disabled={pending}>취소</button>
                  <button type="button" className="hl-btn hl-btn--danger-outline" onClick={() => reject.mutate({ id: draft.id, rejectReason: rejectReason.trim() })} disabled={!reasonOk || pending}>반려 확정</button>
                </>
              ) : (
                <>
                  <button type="button" className="hl-btn hl-btn--ghost" onClick={() => setRejecting(true)} disabled={pending}><Icon name="x-circle" />반려</button>
                  <span className="hl-cap">확정된 값은 바꿀 수 없어요</span>
                  <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={() => confirm.mutate(draft.id)} disabled={!canCreate || pending} title={canCreate ? undefined : '권한이 필요해요'}><Icon name="refresh" />구매요청 만들기 다시 실행</button>
                </>
              )
            ) : (
              <span className="hl-lockhint" style={{ fontSize: 12 }}>
                <Icon name="lock" size="sm" />
                {status === 'WAITING_APPROVAL' || status === 'AI_GENERATED'
                  ? `수정·확정·반려는 요청자(${draft.requester.employeeName})만 할 수 있어요. ${draft.requester.employeeName}님이 확정해야 구매요청이 만들어져요`
                  : status === 'APPROVED'
                    ? `요청자(${draft.requester.employeeName})가 확정했어요 · 구매요청 생성 대기`
                    : status === 'EXECUTED'
                      ? `확정 ${fmtMDHM(draft.confirmedAt)} · ERP 반영 ${fmtMDHM(draft.executedAt)} · 더 고칠 수 없어요`
                      : '반려된 초안이라 더 고칠 수 없어요'}
              </span>
            )}
          </div>
        </div>

        <div className="hl-col" style={{ gap: 14, minWidth: 0 }}>
          <section className="hl-card">
            <header className="hl-card__head"><h3>원본 메시지</h3></header>
            <div className="hl-card__body" style={{ padding: '12px 14px', gap: 8 }}>
              {draft.message ? (
                <OriginMessage message={draft.message} />
              ) : (
                <div className="hl-origin">
                  <Icon name="info" size="sm" />
                  <span>원본 메시지를 불러올 수 없어요</span>
                </div>
              )}
              <span className="hl-cap">메시지를 보면서 왼쪽 값을 직접 입력해 주세요.</span>
            </div>
          </section>
          <section className="hl-card">
            <header className="hl-card__head"><h3>확정하면</h3></header>
            <div className="hl-card__body" style={{ padding: '12px 14px', gap: 10, fontSize: 12.5 }}>
              <div className="hl-row" style={{ alignItems: 'flex-start' }}>
                <span className="hl-code-badge hl-code-badge--run" style={{ fontFamily: 'inherit' }}>확정</span>
                <span>입력한 값으로 구매요청이 만들어져요 (출처: 메신저)</span>
              </div>
              <div className="hl-row" style={{ alignItems: 'flex-start' }}>
                <span className="hl-code-badge hl-code-badge--ok" style={{ fontFamily: 'inherit' }}>ERP 반영</span>
                <span>{pr ? <>구매요청 <Link className="hl-link-id" to={`/purchase-requisitions/${pr.id}`}>{pr.purchaseRequisitionNo}</Link></> : '구매요청 번호가 생겨요'}</span>
              </div>
              <div className="hl-row" style={{ alignItems: 'flex-start' }}>
                <span className="hl-code-badge hl-code-badge--wait" style={{ fontFamily: 'inherit' }}>승인 대기</span>
                <span>요청자 소속 부서의 부서장이 승인해야 발주할 수 있어요</span>
              </div>
              <span className="hl-cap">확정 뒤에는 초안을 고칠 수 없어요. 구매요청이 반려되면 구매요청 화면에서 고쳐 다시 제출해요.</span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
