// 출하요청 품목 한 개의 배정 카드 (REQ-INV-006): FIFO 추천 → 후보에서 선택 → 배정 확정 / 확정 배정의 해제·변경.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { shipmentAllocationApi, type ShipmentAllocationLot } from '@/api/shipmentAllocations';
import type { ShipmentAllocationView, ShipmentRequestItemView } from '@/api/shipments';
import { ApiError } from '@/api/client';
import { EmptyNote, Icon, Spinner } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtDateTime, fmtMDHM, fmtTon } from '@/lib/format';
import { AllocationStatusBadge, LotLink, ReasonModal, SalesOrderLink, ShipmentItemStatusBadge, itemTypeLabel } from './shipmentUi';

const REASON_MAX = 500;
/** 배정 확정·해제 뒤 다시 불러올 조회 (서버도 같은 주제를 실시간으로 보낸다) */
const INVALIDATE = ['shipment-requests', 'allocations', 'lots', 'inventories'];

type Mode = { kind: 'idle' } | { kind: 'pick' } | { kind: 'swap'; allocation: ShipmentAllocationView };

export function AllocationItemCard({ item, editable, canAllocate }: {
  item: ShipmentRequestItemView;
  /** 출고 확정·취소 전이라 배정을 바꿀 수 있는지 */
  editable: boolean;
  /** SHIPMENT_REQUEST USE 권한 */
  canAllocate: boolean;
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  /** 직접 고른 LOT. null이면 추천대로 */
  const [manual, setManual] = useState<number[] | null>(null);
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState<ShipmentAllocationView | null>(null);

  const remaining = Math.max(0, item.requestQty - item.allocatedQty);
  const waiting = item.shipmentRequestItemStatus === 'WAITING_ALLOCATION';
  const open = mode.kind !== 'idle' && editable && canAllocate;

  // 추천은 아무것도 저장하지 않는다. 열려 있는 동안 'allocations' 주제가 바뀌면 다시 불러 후보가 최신으로 유지된다.
  const rec = useQuery({
    queryKey: ['allocations', 'recommend', 'SHIPMENT', item.id],
    queryFn: () => shipmentAllocationApi.recommend(item.id),
    enabled: open,
    staleTime: 0,
  });

  const close = () => { setMode({ kind: 'idle' }); setManual(null); setReason(''); };

  const confirm = useAction(shipmentAllocationApi.confirm, {
    success: (r) => (r.releasedAllocationIds.length
      ? `배정을 바꿨어요 (${r.allocations.map((a) => a.lotNo).join(', ')})`
      : `LOT ${r.allocations.length}건을 배정했어요${r.neededQty > 0 ? ` · 남은 ${r.neededQty}${item.qtyUnit}` : ''}`),
    invalidate: INVALIDATE,
    onSuccess: close,
  });
  const release = useAction(shipmentAllocationApi.release, {
    success: (r) => `${r.lotNo} 배정을 해제했어요`,
    invalidate: INVALIDATE,
    onSuccess: () => setReleasing(null),
  });

  const data = rec.data;
  const candidates: ShipmentAllocationLot[] = data?.candidateLots ?? [];
  const recommended = data?.recommendedLots ?? [];
  const recIds = recommended.map((l) => l.lotId);
  const limit = mode.kind === 'swap' ? 1 : data?.neededQty ?? remaining;
  // 변경(교체)은 추천을 미리 고르지 않는다 — 바꿀 LOT을 직접 고른다
  const defaultIds = mode.kind === 'swap' ? [] : recIds;
  // 고른 LOT 중 후보에서 사라진 것은 뺀다 (다른 요청이 먼저 가져갔을 수 있다)
  const candidateIds = new Set(candidates.map((l) => l.lotId));
  const selected = (manual ?? defaultIds).filter((id) => candidateIds.has(id));
  const selectedSet = new Set(selected);
  // 추천과 같은지: FIFO 앞에서부터 고른 개수만큼과 같은 LOT인지 (서버의 isRecommendationFollowed와 같은 기준)
  const fifoHead = candidates.slice(0, selected.length).map((l) => l.lotId);
  const followsFifo = selected.length > 0 && fifoHead.every((id) => selectedSet.has(id));
  const needsReason = selected.length > 0 && (!followsFifo || mode.kind === 'swap');
  const toggle = (lotId: number) => {
    const cur = selected;
    if (mode.kind === 'swap') { setManual([lotId]); return; }
    if (cur.includes(lotId)) setManual(cur.filter((id) => id !== lotId));
    else if (cur.length < limit) setManual([...cur, lotId]);
  };
  const submit = () => {
    if (!selected.length || reason.length > REASON_MAX) return;
    // FIFO 순서(후보 순서)대로 보낸다
    const lotIds = candidates.filter((l) => selectedSet.has(l.lotId)).map((l) => l.lotId);
    confirm.mutate({
      shipmentRequestItemId: item.id,
      lotIds,
      releaseAllocationIds: mode.kind === 'swap' ? [mode.allocation.id] : undefined,
      reason: needsReason ? reason : undefined,
    });
  };

  const lockTitle = !canAllocate ? '권한이 필요해요' : undefined;

  return (
    <section className="hl-card" style={{ flex: 'none' }}>
      <header className="hl-card__head">
        <span className="hl-tag">품목 {item.lineNo}</span>
        <h2>{itemTypeLabel(item.itemType)} <span className="mono">{item.specCode}</span></h2>
        <span className="hl-card__meta">
          <SalesOrderLink id={item.salesOrderId} no={item.salesOrderNo} lineNo={item.salesOrderLineNo} /> · 요청 {item.requestQty}{item.qtyUnit} · {fmtTon(item.requestTon)}
        </span>
        <div className="hl-card__actions">
          <ShipmentItemStatusBadge status={item.shipmentRequestItemStatus} />
          {editable && waiting && mode.kind === 'idle' ? (
            <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" disabled={!canAllocate} title={lockTitle} onClick={() => { setManual(null); setReason(''); setMode({ kind: 'pick' }); }}>
              <Icon name={canAllocate ? 'sort' : 'lock'} />FIFO 추천
            </button>
          ) : null}
          {open ? <button type="button" className="hl-btn hl-btn--sm" onClick={close} disabled={confirm.isPending}><Icon name="x" />닫기</button> : null}
        </div>
      </header>

      {/* 확정된 배정 */}
      <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
        <table className="hl-table hl-table--compact">
          <thead>
            <tr>
              <th className="ctr" style={{ width: 44 }}>No</th>
              <th>배정 LOT</th>
              <th>히트</th>
              <th>생산완료일</th>
              <th>배정 확정</th>
              <th>상태</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {item.allocations.map((a, i) => {
              const swapping = mode.kind === 'swap' && mode.allocation.id === a.id;
              const changeable = editable && a.status === 'CONFIRMED';
              return (
                <tr key={a.id} className={swapping ? 'is-selected' : undefined}>
                  <td className="ctr">{i + 1}</td>
                  <td><LotLink lotNo={a.lotNo} /></td>
                  <td className="mono">{a.heatNo ?? '—'}</td>
                  <td className="tnum">{fmtDateTime(a.producedAt)}</td>
                  <td className="tnum hl-muted">{fmtMDHM(a.confirmedAt)}</td>
                  <td><AllocationStatusBadge status={a.status} /></td>
                  <td>
                    {changeable ? (
                      <span className="hl-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="hl-btn hl-btn--sm" disabled={!canAllocate || confirm.isPending || release.isPending} title={lockTitle}
                          onClick={() => { setManual(null); setReason(''); setMode(swapping ? { kind: 'idle' } : { kind: 'swap', allocation: a }); }}>
                          <Icon name="edit" />{swapping ? '변경 취소' : '변경'}
                        </button>
                        <button type="button" className="hl-btn hl-btn--sm hl-btn--danger-outline" disabled={!canAllocate || confirm.isPending || release.isPending} title={lockTitle} onClick={() => setReleasing(a)}>
                          배정 해제
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!item.allocations.length ? (
              <tr><td colSpan={7}><EmptyNote style={{ padding: '12px 16px' }}>{editable ? '아직 배정된 LOT이 없어요. [FIFO 추천]으로 후보를 확인해 주세요' : '배정된 LOT이 없어요'}</EmptyNote></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* FIFO 추천·후보 */}
      {open ? (
        <div style={{ borderTop: '1px solid #DDE2E7' }}>
          <div className="hl-row" style={{ padding: '8px 16px', background: '#E6EEFC', gap: 8, flexWrap: 'wrap' }}>
            <Icon name="sort" size="sm" style={{ color: 'var(--run)' }} />
            <span style={{ fontSize: 12.5, color: '#17479B' }}>
              {mode.kind === 'swap'
                ? <><span className="mono">{mode.allocation.lotNo}</span> 대신 배정할 LOT을 1개 골라 주세요</>
                : <>FIFO 추천 · 생산완료일 오름차순, 같으면 LOT 번호 순{data ? <> · 필요 <b className="tnum">{data.neededQty}</b>{item.qtyUnit} (확정 {data.confirmedQty} / 전체 {data.requiredQty})</> : null}</>}
            </span>
            {manual !== null && data && mode.kind === 'pick' ? (
              <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setManual(null)}><Icon name="refresh" />추천대로</button>
            ) : null}
          </div>
          {rec.isLoading ? (
            <div style={{ padding: 16 }}><Spinner label="추천을 불러오는 중…" /></div>
          ) : rec.error ? (
            <div className="hl-banner hl-banner--danger" style={{ margin: 12 }}>
              <Icon name="alert" />
              <div style={{ flex: 1 }}>{rec.error instanceof Error ? rec.error.message : '추천을 불러오지 못했어요'}{rec.error instanceof ApiError ? <span className="mono"> ({rec.error.code})</span> : null}</div>
              <button type="button" className="hl-btn hl-btn--sm" onClick={() => void rec.refetch()}>다시 시도</button>
            </div>
          ) : data ? (
            <>
              {mode.kind === 'pick' && data.shortageQty > 0 ? (
                <div className="hl-banner hl-banner--wait" style={{ margin: '12px 12px 0' }}>
                  <Icon name="alert" />
                  <div>적격 LOT이 <b>{data.shortageQty}{item.qtyUnit}</b> 모자라요. 지금 있는 LOT만 먼저 확정하고, 나머지는 합격 재고가 생기면 이어서 배정할 수 있어요.</div>
                </div>
              ) : null}
              <div style={{ overflow: 'auto', maxHeight: 340 }}>
                <table className="hl-table hl-table--compact">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} />
                      <th className="ctr">FIFO 순위</th>
                      <th>LOT</th>
                      <th>히트</th>
                      <th>생산완료일</th>
                      <th>야드</th>
                      <th>추천</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((l, i) => {
                      const on = selectedSet.has(l.lotId);
                      const isRec = recIds.includes(l.lotId);
                      const full = mode.kind === 'pick' && !on && selected.length >= limit;
                      return (
                        <tr key={l.lotId} className={on ? 'is-selected' : 'is-muted'}>
                          <td>
                            <input type={mode.kind === 'swap' ? 'radio' : 'checkbox'} name={`alloc-${item.id}`} checked={on} disabled={full || confirm.isPending} onChange={() => toggle(l.lotId)} aria-label={`${l.lotNo} 배정`} />
                          </td>
                          <td className="ctr" style={on ? { fontWeight: 600 } : undefined}>{i + 1}</td>
                          <td><LotLink lotNo={l.lotNo} /></td>
                          <td className="mono">{l.heatNo ?? '—'}</td>
                          <td className="tnum">{fmtDateTime(l.producedAt)}</td>
                          <td>{l.yardName ?? '—'}</td>
                          <td>{isRec ? <span className="hl-badge hl-badge--run">추천</span> : <span className="hl-tag">대안</span>}</td>
                        </tr>
                      );
                    })}
                    {!candidates.length ? (
                      <tr><td colSpan={7}><EmptyNote>강종·규격이 같은 합격·미배정 LOT이 아직 없어요</EmptyNote></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {needsReason ? (
                <div className="hl-col" style={{ gap: 4, padding: '10px 16px', borderTop: '1px solid #DDE2E7' }}>
                  <label className="hl-label" htmlFor={`alloc-reason-${item.id}`}>{mode.kind === 'swap' ? '변경 사유 (선택)' : '추천과 다르게 고른 사유 (선택)'}</label>
                  <input id={`alloc-reason-${item.id}`} className={`hl-input${reason.length > REASON_MAX ? ' is-error' : ''}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 야드 작업 순서 · 작업 로그에 남아요" />
                  {reason.length > REASON_MAX ? <span className="hl-danger-text" style={{ fontSize: 11 }}>{REASON_MAX}자 이하로 입력해 주세요</span> : null}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="hl-card__foot">
            <span style={{ fontSize: 12.5 }}>
              선택 <b className="tnum">{selected.length}</b> / {mode.kind === 'swap' ? '1' : `필요 ${limit}`}{item.qtyUnit}
            </span>
            <span className="hl-cap">
              {selected.length === 0 ? '배정할 LOT을 골라 주세요' : mode.kind === 'swap' ? '확정하면 기존 배정을 해제하고 새 LOT을 배정해요 (변경 이력이 남아요)' : followsFifo ? 'FIFO 추천과 같아요' : '추천과 다르게 골랐어요 — 확정하면 변경 이력이 남아요'}
              {candidates.length > selected.length ? ` · 대안 ${candidates.length - selected.length}` : ''}
            </span>
            <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} disabled={!data || !selected.length || confirm.isPending || reason.length > REASON_MAX || (mode.kind === 'pick' && selected.length > limit)} onClick={submit}>
              <Icon name="check" />{mode.kind === 'swap' ? '배정 변경 확정' : '배정 확정'}
            </button>
          </div>
        </div>
      ) : (
        <div className="hl-card__foot">
          <span style={{ fontSize: 12.5 }}>배정 <b className="tnum">{item.allocatedQty}</b> / 필요 {item.requestQty}{item.qtyUnit}</span>
          {!canAllocate && editable ? (
            <span className="hl-lockhint" style={{ marginLeft: 'auto' }}><Icon name="lock" size="sm" />배정 확정·변경은 영업 담당만 할 수 있어요</span>
          ) : (
            <span className="hl-cap" style={{ marginLeft: 'auto' }}>
              {item.shipmentRequestItemStatus === 'ISSUED' ? '출고 완료 — 배정 LOT이 소진됐어요'
                : !editable ? '배정을 바꿀 수 없는 상태예요'
                : waiting ? `${remaining}${item.qtyUnit} 더 배정해야 해요`
                : '출고 확정 전까지 배정을 바꿀 수 있어요'}
            </span>
          )}
        </div>
      )}

      {releasing ? (
        <ReasonModal
          title="배정 해제"
          confirmLabel="배정 해제"
          danger
          pending={release.isPending}
          onClose={() => setReleasing(null)}
          onConfirm={(r) => release.mutate({ id: releasing.id, reason: r })}
        >
          <span className="mono">{releasing.lotNo}</span> 배정을 해제할까요? 품목은 배정 대기로 돌아가고, 다시 다 채워야 출고를 확정할 수 있어요.
        </ReasonModal>
      ) : null}
    </section>
  );
}
