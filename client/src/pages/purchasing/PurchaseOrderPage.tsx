// 발주 (REQ-PUR-003). v1 B안 16번: 왼쪽 공급업체별 발주 대기·발주 내역 | 오른쪽 발주 작성 또는 발주 상세.
// 승인된 구매요청 품목만, 공급업체 1곳당 발주 1건에 여러 품목을 묶는다. 발주는 만들면 바로 확정이다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrderStatus } from '@fantasteel/shared';
import { purchaseOrderApi, type OrderableGroup, type PurchaseOrderDetail } from '@/api/purchasing';
import { DateInput } from '@/components/DateInput';
import { Badge, EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, fmtNum, fmtTon, todayStr } from '@/lib/format';
import { canUse, canView, useMe } from '@/stores/auth';
import { GrStatusBadge, PoStatusBadge, d10, isPositive, md, tonError, tonInput, usePurchasingLookups } from '@/features/purchasing/common';

const PO_STATUSES: PurchaseOrderStatus[] = ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'];
const groupKey = (g: OrderableGroup) => (g.supplier ? String(g.supplier.id) : 'none');
const pct = (part: string, whole: string) => (Number(whole) > 0 ? Math.min(100, Math.round((Number(part) / Number(whole)) * 100)) : 0);

export function PurchaseOrderPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const canOrder = canUse(me, 'PO_CONFIRM');
  const canSeeOrderable = canView(me, 'PO_CONFIRM');

  const orderable = useQuery({ queryKey: ['purchase-orders', 'orderable'], queryFn: purchaseOrderApi.orderable, enabled: canSeeOrderable });
  const orders = useQuery({ queryKey: ['purchase-orders', 'list'], queryFn: () => purchaseOrderApi.list() });

  const groups = orderable.data ?? [];
  const all = orders.data ?? [];
  const rows = all.filter((o) => !status || o.purchaseOrderStatus === status);

  const poParam = Number(params.get('po')) || null;
  const supParam = params.get('supplier');
  const prParam = Number(params.get('pr')) || null;
  const prGroup = prParam ? groups.find((g) => g.items.some((it) => it.purchaseRequisitionId === prParam)) : undefined;
  const selGroup = poParam ? undefined : (supParam ? groups.find((g) => groupKey(g) === supParam) : undefined) ?? prGroup ?? (supParam || prParam ? undefined : groups[0]);
  const selPoId = poParam ?? (selGroup ? null : supParam || prParam ? null : all[0]?.id ?? null);
  const go = (next: { po?: number; supplier?: string }) => setParams(() => {
    const n = new URLSearchParams();
    if (next.po) n.set('po', String(next.po));
    if (next.supplier) n.set('supplier', next.supplier);
    return n;
  }, { replace: true });

  const detail = useQuery({ queryKey: ['purchase-orders', 'detail', selPoId], queryFn: () => purchaseOrderApi.get(selPoId!), enabled: !!selPoId });

  return (
    <>
      <section className="hl-master" aria-label="발주 대기와 발주 내역">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>발주</b>
            <span className="hl-tag">{all.length}</span>
            <Link className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} to="/goods-receipts"><Icon name="box" />입고</Link>
          </div>
          <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`hl-chip${status === '' ? ' is-on' : ''}`} onClick={() => setStatus('')}>전체 <b>{all.length}</b></button>
            {PO_STATUSES.map((s) => (
              <button key={s} type="button" className={`hl-chip${status === s ? ' is-on' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>{PURCHASE_ORDER_STATUS_LABEL[s]} <b>{all.filter((o) => o.purchaseOrderStatus === s).length}</b></button>
            ))}
          </div>
        </div>
        <div className="hl-master__list">
          <div className="hl-nav-group hl-row" style={{ padding: '10px 16px 4px' }}>발주할 구매요청 (승인됨) <span className="hl-tag" style={{ marginLeft: 'auto' }}>{groups.reduce((n, g) => n + g.items.length, 0)}</span></div>
          {!canSeeOrderable ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>발주 권한이 있어야 발주할 구매요청을 볼 수 있어요</div> : null}
          {orderable.isLoading ? <StateView kind="loading" /> : null}
          {orderable.error && !orderable.data ? <div className="hl-cap hl-danger-text" style={{ padding: '6px 16px 10px' }}>발주할 구매요청을 불러오지 못했어요</div> : null}
          {groups.map((g) => (
            <div key={groupKey(g)} className={`hl-mitem${selGroup === g ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => go({ supplier: groupKey(g) })} onKeyDown={(e) => { if (e.key === 'Enter') go({ supplier: groupKey(g) }); }}>
              <div className="hl-row">
                <b style={{ fontSize: 13.5 }}>{g.supplier?.supplierName ?? '기본 공급업체 없음'}</b>
                <span style={{ marginLeft: 'auto' }}><Badge tone="wait">발주 대기 {g.items.length}</Badge></span>
              </div>
              <div className="hl-row hl-cap" style={{ fontSize: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[...new Set(g.items.map((it) => it.rawMaterial.itemName))].join(' · ')}</span>
                <span className="tnum" style={{ marginLeft: 'auto', flex: 'none' }}>{fmtTon(g.totalUnorderedTon)}</span>
              </div>
            </div>
          ))}
          {orderable.data && !groups.length ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>발주를 기다리는 승인 요청이 없어요</div> : null}

          <div className="hl-nav-group" style={{ padding: '14px 16px 4px' }}>발주 내역</div>
          {orders.isLoading ? <StateView kind="loading" /> : null}
          {rows.map((o) => (
            <div key={o.id} className={`hl-mitem${o.id === selPoId ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => go({ po: o.id })} onKeyDown={(e) => { if (e.key === 'Enter') go({ po: o.id }); }}>
              <div className="hl-row">
                <span className="hl-link-id" style={o.id === selPoId ? { fontWeight: 600 } : undefined}>{o.purchaseOrderNo}</span>
                <span style={{ marginLeft: 'auto' }}><PoStatusBadge status={o.purchaseOrderStatus} /></span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <b>{o.supplier.supplierName}</b>
                <span className="hl-muted">· {o.items.length === 1 ? o.items[0].rawMaterial.itemName : `원료 ${o.items.length}종`}</span>
                <span className="tnum" style={{ marginLeft: 'auto' }}>납기 {md(o.dueDate)}</span>
              </div>
              <div className="hl-progress-cell">
                <span className="hl-cap" style={{ width: 52 }}>입고</span>
                <div className={`hl-progress${o.purchaseOrderStatus === 'RECEIVED' ? ' hl-progress--ok' : ''}`}><span style={{ width: `${pct(o.totalReceivedTon, o.totalOrderedTon)}%` }} /></div>
                <b className="tnum" style={{ minWidth: 96 }}>{fmtNum(o.totalReceivedTon, 3)} / {fmtNum(o.totalOrderedTon, 3)} t</b>
              </div>
            </div>
          ))}
          {orders.data && !rows.length ? <EmptyNote>{all.length ? '조건에 맞는 발주가 없어요' : '아직 발주가 없어요'}</EmptyNote> : null}
        </div>
        <div className="hl-row hl-cap" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', alignItems: 'flex-start' }}>
          <Icon name="info" size="sm" />
          <span>승인된 구매요청만 발주할 수 있어요. 공급업체 1곳당 발주 1건에 여러 품목을 묶어요.</span>
        </div>
      </section>
      <main className="hl-main" style={{ gap: 14 }}>
        {orders.error && !orders.data ? (
          <QueryBoundary query={orders}>{() => null}</QueryBoundary>
        ) : selGroup ? (
          <OrderForm key={groupKey(selGroup)} group={selGroup} canOrder={canOrder} focusPrId={prParam} onCreated={(po) => go({ po: po.id })} />
        ) : selPoId ? (
          <QueryBoundary query={detail}>{(po) => <OrderDetail po={po} />}</QueryBoundary>
        ) : orders.data && (!canSeeOrderable || orderable.data) ? (
          <StateView
            kind="empty"
            title={prParam || supParam ? '발주할 품목이 남아 있지 않아요' : '발주할 구매요청도, 발주 내역도 없어요'}
            text="승인된 구매요청만 발주할 수 있어요. 구매요청이 부서장 승인을 받으면 여기에 올라와요"
            actions={<Link className="hl-btn" to="/purchase-requisitions"><Icon name="cart" />구매요청 목록</Link>}
          />
        ) : (
          <StateView kind="loading" />
        )}
      </main>
    </>
  );
}

interface Line { checked: boolean; ton: string }

function OrderForm({ group, canOrder, focusPrId, onCreated }: { group: OrderableGroup; canOrder: boolean; focusPrId: number | null; onCreated: (po: PurchaseOrderDetail) => void }) {
  const lookups = usePurchasingLookups();
  const today = todayStr();
  const hasFocus = !!focusPrId && group.items.some((it) => it.purchaseRequisitionId === focusPrId);
  const [lines, setLines] = useState<Record<number, Line>>(() =>
    Object.fromEntries(group.items.map((it) => [it.purchaseRequisitionItemId, { checked: hasFocus ? it.purchaseRequisitionId === focusPrId : true, ton: tonInput(it.unorderedTon) }])),
  );
  const earliest = group.items.map((it) => d10(it.desiredReceiptDate)).filter(Boolean).sort()[0] ?? '';
  const [due, setDue] = useState(earliest && earliest >= today ? earliest : '');
  const [supplierId, setSupplierId] = useState<number | ''>(group.supplier?.id ?? '');
  const [touched, setTouched] = useState(false);

  const create = useAction(purchaseOrderApi.create, {
    success: (po) => `${po.purchaseOrderNo} 발주를 확정했어요. 입고예정에 반영돼요`,
    invalidate: ['purchase-orders', 'purchase-requisitions', 'mrp-runs'],
    onSuccess: onCreated,
  });

  // 목록이 새로 와서 품목이 늘었으면 기본값(선택 안 함)으로 본다
  const lineOf = (id: number, unordered: string): Line => lines[id] ?? { checked: false, ton: tonInput(unordered) };
  const setLine = (id: number, unordered: string, patch: Partial<Line>) => setLines((ls) => ({ ...ls, [id]: { ...lineOf(id, unordered), ...patch } }));
  const picked = group.items.filter((it) => lineOf(it.purchaseRequisitionItemId, it.unorderedTon).checked);
  const errOf = (id: number, unordered: string) => tonError(lineOf(id, unordered).ton, unordered);
  const dueError = !due ? '납기를 입력해 주세요' : due < today ? '오늘 이후 날짜로 입력해 주세요' : null;
  const valid = picked.length > 0 && picked.every((it) => !errOf(it.purchaseRequisitionItemId, it.unorderedTon)) && !dueError && supplierId !== '';
  const allChecked = picked.length === group.items.length;

  const confirm = () => {
    setTouched(true);
    if (!valid) return;
    create.mutate({
      supplierId,
      dueDate: due,
      items: picked.map((it) => ({ purchaseRequisitionItemId: it.purchaseRequisitionItemId, orderedTon: lineOf(it.purchaseRequisitionItemId, it.unorderedTon).ton.trim() })),
    });
  };

  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
        <span className="hl-avatar hl-avatar--lg" style={{ borderRadius: 6 }}><Icon name="building" /></span>
        <div className="hl-col">
          <div className="hl-row">
            <b style={{ fontSize: 18, lineHeight: '24px' }}>{group.supplier?.supplierName ?? '기본 공급업체 없음'}</b>
            <Badge tone="wait">발주 대기</Badge>
          </div>
          <span className="hl-cap">{group.supplier ? `${group.supplier.supplierCode} · ` : ''}승인된 구매요청 품목 {group.items.length}건 · 미발주 {fmtTon(group.totalUnorderedTon)}</span>
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto' }}>
          <Link className="hl-btn" to="/purchase-requisitions"><Icon name="cart" />구매요청</Link>
        </div>
      </div>
      <div className="hl-banner hl-banner--run" style={{ flex: 'none' }}>
        <Icon name="inbox" />
        <div>
          <b>승인된 구매요청만 발주할 수 있어요.</b> 아래에서 고른 품목이 {group.supplier?.supplierName ?? '고른 공급업체'} 앞 <b>발주 1건</b>으로 묶여요. 발주는 만들면 바로 확정되고 입고예정에 반영돼요.
        </div>
      </div>
      <section className="hl-card" style={{ flex: 'none', borderColor: '#9FB6CD' }}>
        <header className="hl-card__head" style={{ background: '#F6F9FC' }}>
          <Icon name="edit" style={{ color: '#173A5E' }} />
          <h3>신규 발주 · {group.supplier?.supplierName ?? '공급업체 선택'}</h3>
          <span className="hl-card__meta">{picked.length} / {group.items.length}개 품목 선택</span>
        </header>
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" aria-label="전체 선택" checked={allChecked} disabled={!canOrder || create.isPending} onChange={(e) => setLines(Object.fromEntries(group.items.map((it) => [it.purchaseRequisitionItemId, { ...lineOf(it.purchaseRequisitionItemId, it.unorderedTon), checked: e.target.checked }])))} />
                </th>
                <th>구매요청</th>
                <th>원료</th>
                <th>희망 입고일</th>
                <th className="num">요청</th>
                <th className="num">발주 누계</th>
                <th className="num">남은 수량</th>
                <th style={{ width: 170 }}>발주 톤</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((it) => {
                const l = lineOf(it.purchaseRequisitionItemId, it.unorderedTon);
                const err = l.checked ? errOf(it.purchaseRequisitionItemId, it.unorderedTon) : null;
                return (
                  <tr key={it.purchaseRequisitionItemId} className={l.checked ? undefined : 'is-muted'}>
                    <td><input type="checkbox" aria-label={`${it.purchaseRequisitionNo} ${it.rawMaterial.itemName} 선택`} checked={l.checked} disabled={!canOrder || create.isPending} onChange={(e) => setLine(it.purchaseRequisitionItemId, it.unorderedTon, { checked: e.target.checked })} /></td>
                    <td><Link className="hl-link-id" to={`/purchase-requisitions/${it.purchaseRequisitionId}`}>{it.purchaseRequisitionNo}</Link> <span className="hl-cap">#{it.lineNo}</span></td>
                    <td>{it.rawMaterial.itemName} <span className="mono hl-muted">{it.rawMaterial.materialCode}</span></td>
                    <td className="tnum">{d10(it.desiredReceiptDate) || '-'}</td>
                    <td className="num">{fmtTon(it.requiredTon)}</td>
                    <td className={`num${isPositive(it.orderedTon) ? '' : ' hl-muted'}`}>{fmtTon(it.orderedTon)}</td>
                    <td className="num">{fmtTon(it.unorderedTon)}</td>
                    <td>
                      <span className="hl-inputwrap">
                        <input className={`hl-input num${err ? ' is-error' : ''}`} style={{ paddingRight: 24 }} inputMode="decimal" aria-label={`${it.purchaseRequisitionNo} ${it.rawMaterial.itemName} 발주 톤`} value={l.ton} disabled={!canOrder || !l.checked || create.isPending} onChange={(e) => setLine(it.purchaseRequisitionItemId, it.unorderedTon, { ton: e.target.value })} />
                        <span className="hl-suffix">t</span>
                      </span>
                      {err ? <span className="hl-field__hint hl-danger-text" style={{ display: 'block' }}>{err}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="hl-card__body" style={{ gap: 10, padding: '12px 16px' }}>
          <div className="hl-row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="hl-field">
              <span className="hl-field__label">공급업체<span className="hl-danger-text">*</span></span>
              {group.supplier ? (
                <input className="hl-input" style={{ width: 220 }} readOnly aria-label="공급업체" value={group.supplier.supplierName} />
              ) : (
                <span className="hl-selectwrap" style={{ width: 220 }}>
                  <select className={`hl-input${touched && supplierId === '' ? ' is-error' : ''}`} aria-label="공급업체" value={supplierId} disabled={!canOrder || create.isPending} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">공급업체를 골라 주세요</option>
                    {(lookups.data?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.supplierName} · {s.supplierCode}</option>)}
                  </select>
                  <Icon name="chevron-down" size="sm" />
                </span>
              )}
              <span className="hl-field__hint">{group.supplier ? '원료의 기본 공급업체예요' : '이 원료들은 기본 공급업체가 지정되지 않았어요'}</span>
            </div>
            <div className="hl-field">
              <span className="hl-field__label">납기<span className="hl-danger-text">*</span></span>
              <DateInput value={due} onChange={setDue} min={today} ariaLabel="납기" disabled={!canOrder || create.isPending} invalid={touched && !!dueError} />
              {touched && dueError ? <span className="hl-field__hint hl-danger-text">{dueError}</span> : <span className="hl-field__hint">{earliest ? `가장 이른 희망 입고일 ${earliest}` : '오늘 이후 날짜'}</span>}
            </div>
          </div>
        </div>
        <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
          {canOrder ? (
            <span className="hl-cap">{touched && !picked.length ? <span className="hl-danger-text">발주할 품목을 하나 이상 골라 주세요</span> : '발주 톤은 남은 수량 이하로 나눠 발주할 수 있어요. 남은 수량은 다음 발주로 넘어가요'}</span>
          ) : (
            <span className="hl-lockhint"><Icon name="lock" size="sm" />발주 확정 권한이 필요해요</span>
          )}
          <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={confirm} disabled={!canOrder || create.isPending} title={canOrder ? undefined : '권한이 필요해요'}>
            <Icon name={canOrder ? 'check' : 'lock'} />
            발주 확정
          </button>
        </div>
      </section>
    </>
  );
}

function OrderDetail({ po }: { po: PurchaseOrderDetail }) {
  const me = useMe();
  const canReceive = canView(me, 'RECEIPT_CONFIRM', 'PO_CONFIRM');
  const open = po.purchaseOrderStatus !== 'RECEIVED';
  const p = pct(po.totalReceivedTon, po.totalOrderedTon);
  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
        <span className="hl-avatar hl-avatar--lg" style={{ borderRadius: 6 }}><Icon name="building" /></span>
        <div className="hl-col">
          <div className="hl-row" style={{ flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{po.purchaseOrderNo}</span>
            <b style={{ fontSize: 16 }}>{po.supplier.supplierName}</b>
            <PoStatusBadge status={po.purchaseOrderStatus} />
          </div>
          <span className="hl-cap">{po.supplier.supplierCode} · 발주 확정 {fmtMDHM(po.confirmedAt)} · 납기 {d10(po.dueDate) || '-'} · 품목 {po.items.length}개</span>
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto' }}>
          {canReceive ? (
            <Link className={`hl-btn${open ? ' hl-btn--primary' : ''}`} to={`/goods-receipts?po=${po.id}`}><Icon name="box" />{open ? '입고 처리' : '입고 내역'}</Link>
          ) : null}
        </div>
      </div>
      <div className="hl-statbar" style={{ flex: 'none' }}>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">발주</span>
          <span className="hl-figure"><b>{fmtNum(po.totalOrderedTon, 3)}<small>t</small></b></span>
        </div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">입고 누계</span>
          <span className="hl-figure"><b>{fmtNum(po.totalReceivedTon, 3)}<small>t · {p}%</small></b></span>
        </div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">미입고 (입고예정)</span>
          <span className="hl-figure"><b className={open ? 'hl-run-text' : 'hl-muted'}>{fmtNum(po.totalOutstandingTon, 3)}<small>t</small></b></span>
        </div>
      </div>
      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h2>발주 품목</h2>
          <span className="hl-tag">{po.items.length}</span>
        </header>
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr><th style={{ width: 36 }}>#</th><th>원료</th><th className="num">발주</th><th className="num">입고</th><th className="num">미입고</th><th style={{ width: 160 }}>진행</th><th>연결 구매요청</th><th /></tr>
            </thead>
            <tbody>
              {po.items.map((it) => (
                <tr key={it.id}>
                  <td className="hl-muted">{it.lineNo}</td>
                  <td>{it.rawMaterial.itemName} <span className="mono hl-muted">{it.rawMaterial.materialCode}</span></td>
                  <td className="num">{fmtTon(it.orderedTon)}</td>
                  <td className="num">{fmtTon(it.receivedTon)}</td>
                  <td className={`num${isPositive(it.outstandingTon) ? '' : ' hl-muted'}`}>{fmtTon(it.outstandingTon)}</td>
                  <td>
                    <div className="hl-progress-cell">
                      <div className={`hl-progress${isPositive(it.outstandingTon) ? '' : ' hl-progress--ok'}`}><span style={{ width: `${pct(it.receivedTon, it.orderedTon)}%` }} /></div>
                      <b>{pct(it.receivedTon, it.orderedTon)}%</b>
                    </div>
                  </td>
                  <td>{it.purchaseRequisition ? <Link className="hl-link-id" to={`/purchase-requisitions/${it.purchaseRequisition.id}`}>{it.purchaseRequisition.purchaseRequisitionNo}</Link> : <span className="hl-muted">—</span>}</td>
                  <td className="num">
                    {isPositive(it.outstandingTon)
                      ? canReceive ? <Link className="hl-btn hl-btn--sm" to={`/goods-receipts?po=${po.id}&item=${it.id}`}><Icon name="box" />입고 등록</Link> : null
                      : <span className="hl-cap">입고 완료</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td /><td>합계</td><td className="num">{fmtTon(po.totalOrderedTon)}</td><td className="num">{fmtTon(po.totalReceivedTon)}</td><td className="num">{fmtTon(po.totalOutstandingTon)}</td><td colSpan={3} /></tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h3>입고 내역</h3>
          <span className="hl-card__meta">입고를 확정하면 원료 LOT이 만들어져요</span>
          {canReceive ? (
            <div className="hl-card__actions">
              <Link className="hl-btn hl-btn--sm hl-btn--ghost" to={`/goods-receipts?po=${po.id}`}>입고 화면 <Icon name="chevron-right" /></Link>
            </div>
          ) : null}
        </header>
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table hl-table--compact">
            <thead>
              <tr><th>입고번호</th><th>원료</th><th>입고일</th><th className="num">수량</th><th>야드</th><th>원료 LOT</th><th>상태</th></tr>
            </thead>
            <tbody>
              {po.items.flatMap((it) => it.goodsReceipts.map((r) => (
                <tr key={r.id} className={r.goodsReceiptStatus === 'DRAFT' ? 'is-muted' : undefined}>
                  <td className="mono">{r.goodsReceiptNo}</td>
                  <td>{it.rawMaterial.itemName}</td>
                  <td className="tnum">{d10(r.receiptDate)}</td>
                  <td className="num">{fmtTon(r.receivedTon)}</td>
                  <td>{r.yard?.yardName ?? <span className="hl-muted">-</span>}</td>
                  <td>{r.lot ? <Link className="hl-link-id" to={`/lots/trace?lot=${encodeURIComponent(r.lot.lotNo)}`}>{r.lot.lotNo}</Link> : <span className="hl-cap">확정하면 만들어져요</span>}</td>
                  <td><GrStatusBadge status={r.goodsReceiptStatus} /></td>
                </tr>
              )))}
              {!po.items.some((it) => it.goodsReceipts.length) ? <tr><td colSpan={7}><EmptyNote>아직 입고가 없어요</EmptyNote></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
