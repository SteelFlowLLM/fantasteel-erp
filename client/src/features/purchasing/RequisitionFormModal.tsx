// 구매요청 등록·수정 폼 (REQ-PUR-001). MRP 화면에서는 원료·톤·희망 입고일이 채워진 채로 열린다.
import { useState } from 'react';
import { ApiError } from '@/api/client';
import { purchaseRequisitionApi, type PurchaseRequisitionDetail, type RequisitionItemInput } from '@/api/purchasing';
import { DateInput } from '@/components/DateInput';
import { Field, Icon, Modal, Spinner } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { todayStr } from '@/lib/format';
import { d10, tonError, tonInput, usePurchasingLookups } from '@/features/purchasing/common';

export interface RequisitionFormInitial {
  items?: { rawMaterialId: number; requiredTon: string }[];
  desiredReceiptDate?: string;
  requestReason?: string;
}

interface Row { key: number; rawMaterialId: number | ''; ton: string }
const REASON_MAX = 500;
const INVALIDATE = ['purchase-requisitions', 'mrp-runs'];

export function RequisitionFormModal({ target, initial, sourceType = 'DIRECT', onClose, onSaved }: {
  /** 있으면 수정 (작성 중·반려 상태의 내 요청) */
  target?: PurchaseRequisitionDetail;
  initial?: RequisitionFormInitial;
  sourceType?: 'DIRECT' | 'MRP';
  onClose: () => void;
  onSaved?: (pr: PurchaseRequisitionDetail) => void;
}) {
  const lookups = usePurchasingLookups();
  const seed = target
    ? target.items.map((it) => ({ rawMaterialId: it.rawMaterial.id, requiredTon: tonInput(it.requiredTon) }))
    : initial?.items ?? [];
  const [rows, setRows] = useState<Row[]>(() => (seed.length ? seed.map((s, i) => ({ key: i, rawMaterialId: s.rawMaterialId, ton: s.requiredTon })) : [{ key: 0, rawMaterialId: '', ton: '' }]));
  const [date, setDate] = useState(target ? d10(target.desiredReceiptDate) : initial?.desiredReceiptDate ?? '');
  const [reason, setReason] = useState(target?.requestReason ?? initial?.requestReason ?? '');
  const [touched, setTouched] = useState(false);
  /** 서버가 거부한 사유 (특히 PUR-001: 승인권자 없음) */
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const today = todayStr();

  const onError = (e: unknown) => setServerError(e instanceof ApiError ? { code: e.code, message: e.message } : { code: '', message: '저장하지 못했어요' });
  const create = useAction(purchaseRequisitionApi.create, {
    success: (pr) => (pr.purchaseRequisitionStatus === 'WAITING_APPROVAL' ? `${pr.purchaseRequisitionNo} 을(를) 제출했어요. ${pr.approver?.employeeName ?? '부서장'} 승인을 기다려요` : `${pr.purchaseRequisitionNo} 을(를) 작성 중으로 저장했어요`),
    invalidate: INVALIDATE,
    onSuccess: (pr) => { onSaved?.(pr); onClose(); },
    onError,
  });
  const update = useAction(purchaseRequisitionApi.update, { invalidate: INVALIDATE, onError });
  const submit = useAction(purchaseRequisitionApi.submit, { invalidate: INVALIDATE, onError });
  const pending = create.isPending || update.isPending || submit.isPending;

  const materials = lookups.data?.rawMaterials ?? [];
  const supplierName = (id: number | null) => (id ? lookups.data?.suppliers.find((s) => s.id === id)?.supplierName : undefined);
  const picked = rows.map((r) => r.rawMaterialId).filter((v): v is number => v !== '');
  const rowError = (r: Row): string | null => {
    if (r.rawMaterialId === '') return '원료를 골라 주세요';
    if (picked.filter((id) => id === r.rawMaterialId).length > 1) return '같은 원료가 두 번 들어 있어요';
    return tonError(r.ton);
  };
  const dateError = !date ? '희망 입고일을 입력해 주세요' : date < today ? '오늘 이후 날짜로 입력해 주세요' : null;
  const valid = rows.every((r) => !rowError(r)) && !dateError && reason.length <= REASON_MAX;

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: Math.max(...rs.map((r) => r.key)) + 1, rawMaterialId: '', ton: '' }]);
  const removeRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const save = async (andSubmit: boolean) => {
    setTouched(true);
    setServerError(null);
    if (!valid) return;
    const items: RequisitionItemInput[] = rows.map((r) => ({ rawMaterialId: r.rawMaterialId as number, requiredTon: r.ton.trim() }));
    const requestReason = reason.trim();
    if (!target) {
      create.mutate({ items, desiredReceiptDate: date, ...(requestReason ? { requestReason } : {}), sourceType, submit: andSubmit });
      return;
    }
    try {
      let pr = await update.mutateAsync({ id: target.id, items, desiredReceiptDate: date, requestReason });
      if (andSubmit) pr = await submit.mutateAsync(target.id);
      onSaved?.(pr);
      onClose();
    } catch {
      // 실패 안내는 useAction(토스트)과 onError(폼 위 안내)가 한다. 수정은 저장됐는데 제출만 실패했을 수 있어 폼은 열어 둔다.
    }
  };

  return (
    <Modal
      title={target ? `구매요청 수정 · ${target.purchaseRequisitionNo}` : '구매요청 등록'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <span className="hl-cap" style={{ marginRight: 'auto' }}>제출하면 소속 부서의 부서장에게 승인 요청이 가요</span>
          <button type="button" className="hl-btn hl-btn--ghost" onClick={onClose} disabled={pending}>취소</button>
          <button type="button" className="hl-btn" onClick={() => void save(false)} disabled={pending}>{target ? '저장' : '작성 중으로 저장'}</button>
          <button type="button" className="hl-btn hl-btn--primary" onClick={() => void save(true)} disabled={pending}>
            <Icon name="send" />
            {target ? '저장하고 제출' : '제출'}
          </button>
        </>
      }
    >
      <div className="hl-col" style={{ gap: 14 }}>
        {serverError ? (
          <div className="hl-banner hl-banner--danger" role="alert">
            <Icon name="alert" />
            <div>
              <b>{serverError.code === 'PUR-001' ? '승인권자가 없어 제출하지 못했어요' : '저장하지 못했어요'}</b>
              <div>{serverError.message}</div>
            </div>
          </div>
        ) : null}
        {sourceType === 'MRP' && !target ? (
          <div className="hl-origin">
            <Icon name="calc" size="sm" />
            <span>MRP 결과의 순소요로 채웠어요. 수량과 희망 입고일을 확인한 뒤 저장해 주세요. 출처는 MRP로 기록돼요.</span>
          </div>
        ) : null}
        {lookups.isLoading ? <Spinner label="원료 목록을 불러오는 중…" /> : null}
        {lookups.error ? <span className="hl-danger-text" style={{ fontSize: 12.5 }}>원료 목록을 불러오지 못했어요. {lookups.error instanceof Error ? lookups.error.message : ''}</span> : null}
        <div className="hl-col" style={{ gap: 8 }}>
          <div className="hl-row">
            <span className="hl-field__label">원료 품목 · 수량(톤)<span className="hl-danger-text">*</span></span>
            <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={addRow} disabled={pending || (materials.length > 0 && rows.length >= materials.length)}>
              <Icon name="plus" />
              품목 추가
            </button>
          </div>
          {rows.map((r, i) => {
            const err = touched ? rowError(r) : null;
            const mat = materials.find((m) => m.id === r.rawMaterialId);
            const sup = mat ? supplierName(mat.defaultSupplierId) : undefined;
            return (
              <div key={r.key} className="hl-col" style={{ gap: 4 }}>
                <div className="hl-row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span className="hl-tag" style={{ marginTop: 6, flex: 'none' }}>{i + 1}</span>
                  <span className="hl-selectwrap" style={{ flex: 1, minWidth: 0 }}>
                    <select className={`hl-input${err && r.rawMaterialId === '' ? ' is-error' : ''}`} aria-label={`품목 ${i + 1} 원료`} value={r.rawMaterialId} onChange={(e) => setRow(r.key, { rawMaterialId: e.target.value ? Number(e.target.value) : '' })} disabled={pending}>
                      <option value="">원료를 골라 주세요</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.materialCode}</option>)}
                      {r.rawMaterialId !== '' && !mat && target ? <option value={r.rawMaterialId}>{target.items.find((it) => it.rawMaterial.id === r.rawMaterialId)?.rawMaterial.itemName ?? `원료 #${r.rawMaterialId}`}</option> : null}
                    </select>
                    <Icon name="chevron-down" size="sm" />
                  </span>
                  <span className="hl-inputwrap" style={{ width: 150, flex: 'none' }}>
                    <input className={`hl-input num${err && r.rawMaterialId !== '' ? ' is-error' : ''}`} style={{ paddingRight: 28 }} inputMode="decimal" placeholder="0.000" aria-label={`품목 ${i + 1} 수량(톤)`} value={r.ton} onChange={(e) => setRow(r.key, { ton: e.target.value })} disabled={pending} />
                    <span className="hl-suffix">t</span>
                  </span>
                  <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ marginTop: 3 }} aria-label={`품목 ${i + 1} 빼기`} onClick={() => removeRow(r.key)} disabled={pending || rows.length === 1}><Icon name="x" /></button>
                </div>
                {err ? <span className="hl-field__hint hl-danger-text" style={{ paddingLeft: 30 }}>{err}</span> : mat ? <span className="hl-cap" style={{ paddingLeft: 30 }}>{sup ? `기본 공급업체 ${sup}` : '기본 공급업체가 지정되지 않았어요'}</span> : null}
              </div>
            );
          })}
        </div>
        <div className="hl-field">
          <span className="hl-field__label">희망 입고일<span className="hl-danger-text">*</span></span>
          <DateInput value={date} onChange={setDate} min={today} ariaLabel="희망 입고일" disabled={pending} invalid={touched && !!dateError} />
          {touched && dateError ? <span className="hl-field__hint hl-danger-text">{dateError}</span> : <span className="hl-field__hint">오늘 이후 날짜만 받아요</span>}
        </div>
        <Field label="요청 사유" hint={`${reason.length} / ${REASON_MAX}자`} error={reason.length > REASON_MAX ? `${REASON_MAX}자까지 쓸 수 있어요` : null}>
          <textarea className="hl-input" rows={3} placeholder="어디에 쓰는지, 왜 필요한지 적어 주세요 (선택)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} />
        </Field>
      </div>
    </Modal>
  );
}
