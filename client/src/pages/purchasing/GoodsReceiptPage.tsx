// 입고 (REQ-PUR-004). v1 B안 17번: 왼쪽 입고 예정(미입고가 남은 발주 품목) | 오른쪽 입고 등록·확정·이력.
// 입고는 초안을 만들고 확정하는 두 단계다. 확정할 때 원료 LOT이 만들어진다. 부분 입고 허용, 입고 검사는 없다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { goodsReceiptApi, purchaseOrderApi, type GoodsReceiptView, type PurchaseOrderItemView, type PurchaseOrderListItem } from '@/api/purchasing';
import { DateInput } from '@/components/DateInput';
import { EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMDHM, fmtNum, fmtTon, todayStr } from '@/lib/format';
import { canUse, canView, useMe } from '@/stores/auth';
import { GrStatusBadge, PoStatusBadge, d10, isPositive, md, tonError, tonInput, usePurchasingLookups } from '@/features/purchasing/common';

type Tab = 'PLAN' | 'ALL';
interface Target { po: PurchaseOrderListItem; item: PurchaseOrderItemView }
const NOTE_MAX = 500;
const INVALIDATE = ['goods-receipts', 'purchase-orders', 'mrp-runs', 'lots', 'inventories'];
const pct = (part: string, whole: string) => (Number(whole) > 0 ? Math.min(100, Math.round((Number(part) / Number(whole)) * 100)) : 0);
const lotLink = (lotNo: string) => `/lots/trace?lot=${encodeURIComponent(lotNo)}`;

export function GoodsReceiptPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('PLAN');
  const [q, setQ] = useState('');
  const canReceive = canUse(me, 'RECEIPT_CONFIRM');

  const orders = useQuery({ queryKey: ['purchase-orders', 'list'], queryFn: () => purchaseOrderApi.list() });
  const receipts = useQuery({ queryKey: ['goods-receipts', 'list'], queryFn: () => goodsReceiptApi.list() });

  const text = q.trim().toLowerCase();
  const targets: Target[] = (orders.data ?? []).flatMap((po) => po.items.map((item) => ({ po, item })));
  const openTargets = targets.filter((t) => isPositive(t.item.outstandingTon));
  const list = (tab === 'PLAN' ? openTargets : targets)
    .filter((t) => !text || [t.po.purchaseOrderNo, t.po.supplier.supplierName, t.item.rawMaterial.itemName, t.item.rawMaterial.materialCode].some((s) => s.toLowerCase().includes(text)))
    .sort((a, b) => (a.po.dueDate ?? '9').localeCompare(b.po.dueDate ?? '9') || a.po.id - b.po.id || a.item.lineNo - b.item.lineNo);

  const poParam = Number(params.get('po')) || null;
  const itemParam = Number(params.get('item')) || null;
  const sel =
    (itemParam ? targets.find((t) => t.item.id === itemParam) : undefined) ??
    (poParam ? openTargets.find((t) => t.po.id === poParam) ?? targets.find((t) => t.po.id === poParam) : undefined) ??
    list[0];
  const select = (t: Target) => setParams(() => { const n = new URLSearchParams(); n.set('po', String(t.po.id)); n.set('item', String(t.item.id)); return n; }, { replace: true });
  const draftCount = (itemId: number) => (receipts.data ?? []).filter((r) => r.purchaseOrderItemId === itemId && r.goodsReceiptStatus === 'DRAFT').length;
  const recent = (receipts.data ?? []).filter((r) => r.goodsReceiptStatus === 'CONFIRMED').slice(0, 5);

  return (
    <>
      <section className="hl-master" aria-label="입고 예정 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>입고 예정</b>
            <span className="hl-tag">{openTargets.length}</span>
            <Link className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} to="/purchase-orders"><Icon name="building" />발주</Link>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="발주번호·원료·공급업체 검색" aria-label="입고 예정 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: 6 }}>
            <button type="button" className={`hl-chip${tab === 'PLAN' ? ' is-on' : ''}`} onClick={() => setTab('PLAN')}>예정 <b>{openTargets.length}</b></button>
            <button type="button" className={`hl-chip${tab === 'ALL' ? ' is-on' : ''}`} onClick={() => setTab('ALL')}>전체 <b>{targets.length}</b></button>
          </div>
        </div>
        <div className="hl-master__list">
          {orders.isLoading ? <StateView kind="loading" /> : null}
          {list.map((t) => {
            const on = t.item.id === sel?.item.id;
            const open = isPositive(t.item.outstandingTon);
            const drafts = draftCount(t.item.id);
            return (
              <div key={t.item.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => select(t)} onKeyDown={(e) => { if (e.key === 'Enter') select(t); }}>
                <div className="hl-row">
                  <span className="hl-link-id" style={on ? { fontWeight: 600 } : undefined}>{t.po.purchaseOrderNo}</span>
                  <span className="hl-cap">#{t.item.lineNo}</span>
                  <span style={{ marginLeft: 'auto' }}><PoStatusBadge status={open ? t.po.purchaseOrderStatus : 'RECEIVED'} /></span>
                </div>
                <div className="hl-row" style={{ fontSize: 12 }}>
                  <b>{t.item.rawMaterial.itemName}</b>
                  <span className="hl-muted">· {t.po.supplier.supplierName}</span>
                  <span className={`tnum${open && t.po.dueDate && d10(t.po.dueDate) < todayStr() ? ' hl-danger-text' : ''}`} style={{ marginLeft: 'auto' }}>납기 {md(t.po.dueDate)}</span>
                </div>
                <div className="hl-progress-cell">
                  <span className="hl-cap" style={{ flex: 'none' }}>미입고 {fmtNum(t.item.outstandingTon, 3)} t</span>
                  <div className={`hl-progress${open ? '' : ' hl-progress--ok'}`}><span style={{ width: `${pct(t.item.receivedTon, t.item.orderedTon)}%` }} /></div>
                  <b className="tnum">{pct(t.item.receivedTon, t.item.orderedTon)}%</b>
                </div>
                {drafts ? <span className="hl-cap" style={{ color: 'var(--run)' }}>입고 초안 {drafts}건 · 확정 대기</span> : null}
              </div>
            );
          })}
          {orders.data && !list.length ? <EmptyNote>{tab === 'PLAN' ? '입고 예정인 발주가 없어요' : '발주가 없어요'}</EmptyNote> : null}
          <div className="hl-nav-group" style={{ padding: '14px 16px 6px' }}>최근 입고 확정</div>
          {recent.map((r) => (
            <div key={r.id} className="hl-mitem" style={{ opacity: 0.9, cursor: 'default' }}>
              <div className="hl-row">
                <span className="mono">{r.goodsReceiptNo}</span>
                <span style={{ marginLeft: 'auto' }}><GrStatusBadge status={r.goodsReceiptStatus} /></span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <b>{r.rawMaterial.itemName}</b>
                <span className="hl-muted">· {r.purchaseOrder.supplier.supplierName}</span>
                <span className="tnum" style={{ marginLeft: 'auto' }}>{md(r.receiptDate)}</span>
              </div>
              <div className="hl-row" style={{ fontSize: 12 }}>
                <Icon name="box" size="sm" />
                {r.lot ? <Link className="hl-link-id" to={lotLink(r.lot.lotNo)}>{r.lot.lotNo}</Link> : <span className="hl-muted">-</span>}
                <span className="hl-cap" style={{ marginLeft: 'auto' }}>{fmtTon(r.receivedTon)}</span>
              </div>
            </div>
          ))}
          {receipts.data && !recent.length ? <div className="hl-cap" style={{ padding: '6px 16px 10px' }}>확정된 입고가 없어요</div> : null}
        </div>
        <div className="hl-row hl-cap" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', alignItems: 'flex-start' }}>
          <Icon name="info" size="sm" />
          <span>입고 확정 = 원료 LOT 생성. 입고 검사는 하지 않아요 (범위 제외).</span>
        </div>
      </section>
      <main className="hl-main" style={{ gap: 14 }}>
        {orders.error && !orders.data ? (
          <QueryBoundary query={orders}>{() => null}</QueryBoundary>
        ) : sel ? (
          <ReceiptWork key={sel.item.id} target={sel} receipts={receipts.data} receiptsError={!!receipts.error && !receipts.data} canReceive={canReceive} />
        ) : orders.data ? (
          <>
            <StateView
              kind="empty"
              title="입고할 발주가 없어요"
              text="발주를 확정하면 미입고량이 여기에 올라와요"
              actions={canView(me, 'PO_CONFIRM') ? <Link className="hl-btn" to="/purchase-orders"><Icon name="building" />발주 화면</Link> : undefined}
            />
          </>
        ) : null}
      </main>
    </>
  );
}

function ReceiptWork({ target, receipts, receiptsError, canReceive }: { target: Target; receipts: GoodsReceiptView[] | undefined; receiptsError: boolean; canReceive: boolean }) {
  const { po, item } = target;
  const lookups = usePurchasingLookups();
  const today = todayStr();
  const open = isPositive(item.outstandingTon);
  const [ton, setTon] = useState(open ? tonInput(item.outstandingTon) : '');
  const [date, setDate] = useState(today);
  const [yardId, setYardId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [scope, setScope] = useState<'ITEM' | 'ALL'>('ITEM');
  const [lastConfirmed, setLastConfirmed] = useState<GoodsReceiptView | null>(null);
  /** 서버가 거부한 사유 (PUR-003: 미입고량 초과 등). 서버 메시지를 그대로 보여 준다 */
  const [serverError, setServerError] = useState<{ at: 'create' | 'confirm'; message: string } | null>(null);
  const onError = (at: 'create' | 'confirm') => (e: unknown) => setServerError(e instanceof ApiError ? { at, message: e.message } : null);

  const create = useAction(goodsReceiptApi.create, {
    success: (r) => `${r.goodsReceiptNo} 입고 초안을 만들었어요. 입고 확정을 눌러야 재고에 반영돼요`,
    invalidate: INVALIDATE,
    onSuccess: () => { setNote(''); setTouched(false); setServerError(null); },
    onError: onError('create'),
  });
  const confirm = useAction(goodsReceiptApi.confirm, {
    success: (r) => (r.lot ? `입고를 확정했어요. 원료 LOT ${r.lot.lotNo} 이(가) 만들어졌어요` : '입고를 확정했어요'),
    invalidate: INVALIDATE,
    onSuccess: (r) => { setLastConfirmed(r); setServerError(null); },
    onError: onError('confirm'),
  });
  const pending = create.isPending || confirm.isPending;

  const rawYards = (lookups.data?.yards ?? []).filter((y) => y.yardType === 'RAW_MATERIAL');
  const defaultYardId = lookups.data?.rawMaterials.find((m) => m.id === item.rawMaterial.id)?.yardId ?? null;
  const defaultYard = rawYards.find((y) => y.id === defaultYardId);

  // 미입고량 초과는 서버가 판단한다 (PUR-003). 화면은 형식만 본다
  const tonErr = tonError(ton);
  const createError = serverError?.at === 'create' ? serverError.message : null;
  const dateErr = !date ? '입고일을 입력해 주세요' : date > today ? '오늘 이전 날짜로 입력해 주세요' : null;
  const noteErr = note.length > NOTE_MAX ? `${NOTE_MAX}자까지 쓸 수 있어요` : null;
  const valid = !tonErr && !dateErr && !noteErr;
  const disabled = !open || !canReceive || pending;

  const mine = (receipts ?? []).filter((r) => r.purchaseOrderItemId === item.id);
  const shown = scope === 'ITEM' ? mine : receipts ?? [];
  const draftTon = mine.filter((r) => r.goodsReceiptStatus === 'DRAFT');

  const register = () => {
    setTouched(true);
    setServerError(null);
    if (!valid) return;
    create.mutate({ purchaseOrderItemId: item.id, receivedTon: ton.trim(), receiptDate: date, ...(yardId !== '' ? { yardId } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
        <Link className="hl-btn hl-btn--ghost hl-btn--sm" to={`/purchase-orders?po=${po.id}`} aria-label="발주로 돌아가기">
          <Icon name="chevron-left" />
          발주
        </Link>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{po.purchaseOrderNo}</span>
        <b style={{ fontSize: 16 }}>{item.rawMaterial.itemName} · {po.supplier.supplierName}</b>
        <span className="hl-badge hl-badge--outline">납기 {md(po.dueDate)}</span>
        <PoStatusBadge status={po.purchaseOrderStatus} />
        <div className="hl-row" style={{ marginLeft: 'auto' }}>
          <Link className="hl-btn" to="/lots/trace"><Icon name="trace" />LOT 추적</Link>
        </div>
      </div>

      <div className="hl-statbar" style={{ flex: 'none', flexWrap: 'wrap' }}>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">발주</span>
          <span className="hl-figure"><b>{fmtNum(item.orderedTon, 3)}<small>t</small></b></span>
        </div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">입고 누계 (확정)</span>
          <span className="hl-figure"><b>{fmtNum(item.receivedTon, 3)}<small>t</small></b></span>
        </div>
        <div className="hl-kpi" style={{ padding: '10px 16px', background: '#F6F9FC' }}>
          <span className="hl-kpi__label"><label htmlFor="gr-ton">이번 입고</label></span>
          <span className="hl-inputwrap" style={{ width: 170 }}>
            <input id="gr-ton" className="hl-input num" style={{ height: 34, fontSize: 16, fontWeight: 600, paddingRight: 24, borderColor: (touched && tonErr && open) || createError ? 'var(--danger)' : 'var(--run)' }} inputMode="decimal" value={ton} onChange={(e) => setTon(e.target.value)} disabled={disabled} />
            <span className="hl-suffix" style={{ top: 8 }}>t</span>
          </span>
          {touched && tonErr && open ? <span className="hl-cap hl-danger-text">{tonErr}</span> : createError ? <span className="hl-cap hl-danger-text" role="alert">{createError}</span> : <span className="hl-cap">미입고량 이하 · 나눠서 입고할 수 있어요</span>}
        </div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">미입고</span>
          <span className="hl-row">
            <span className="hl-figure"><b className={open ? 'hl-run-text' : 'hl-muted'}>{fmtNum(item.outstandingTon, 3)}<small>t</small></b></span>
            {open ? null : <span className="hl-badge hl-badge--ok">입고 완료</span>}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, flex: 'none' }}>
        <section className="hl-card" style={{ minWidth: 0 }}>
          <header className="hl-card__head">
            <h3>입고 등록</h3>
            <span className="hl-card__meta">초안으로 저장돼요</span>
          </header>
          <div className="hl-card__body" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="hl-field">
                <span className="hl-field__label">입고일<span className="hl-danger-text">*</span></span>
                <DateInput value={date} onChange={setDate} ariaLabel="입고일" disabled={disabled} invalid={touched && !!dateErr} width={160} />
                {touched && dateErr ? <span className="hl-field__hint hl-danger-text">{dateErr}</span> : <span className="hl-field__hint">오늘 또는 지난 날짜</span>}
              </div>
              <div className="hl-field">
                <label htmlFor="gr-yard">원료 야드</label>
                <span className="hl-selectwrap">
                  <select id="gr-yard" className="hl-input" value={yardId} onChange={(e) => setYardId(e.target.value ? Number(e.target.value) : '')} disabled={disabled}>
                    <option value="">{defaultYard ? `기본 야드 (${defaultYard.yardName})` : '원료의 기본 야드'}</option>
                    {rawYards.map((y) => <option key={y.id} value={y.id}>{y.yardName} · {y.yardCode}</option>)}
                  </select>
                  <Icon name="chevron-down" size="sm" />
                </span>
                <span className="hl-field__hint">고르지 않으면 원료의 기본 야드로 들어가요</span>
              </div>
              <div className="hl-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="gr-note">비고</label>
                <input id="gr-note" className={`hl-input${noteErr ? ' is-error' : ''}`} placeholder="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} disabled={disabled} />
                {noteErr ? <span className="hl-field__hint hl-danger-text">{noteErr}</span> : null}
              </div>
            </div>
          </div>
          <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
            {canReceive ? (
              <span className="hl-cap">{open ? '입고 등록 → 입고 확정 순서예요. 재고·LOT은 확정할 때만 바뀌어요' : '이 품목은 모두 입고됐어요'}</span>
            ) : (
              <span className="hl-lockhint"><Icon name="lock" size="sm" />입고 확정 권한이 필요해요</span>
            )}
            <button type="button" className="hl-btn hl-btn--primary" style={{ marginLeft: 'auto' }} onClick={register} disabled={disabled} title={canReceive ? undefined : '권한이 필요해요'}>
              <Icon name={canReceive ? 'plus' : 'lock'} />
              입고 등록
            </button>
          </div>
        </section>

        {lastConfirmed?.lot ? (
          <section className="hl-card" style={{ borderColor: '#B9DEC8', minWidth: 0 }}>
            <header className="hl-card__head" style={{ background: 'var(--ok-bg)', borderBottomColor: '#B9DEC8' }}>
              <Icon name="check-circle" style={{ color: 'var(--ok)' }} />
              <h3 style={{ color: '#115C38' }}>입고 확정 완료</h3>
              <span className="hl-card__meta" style={{ marginLeft: 'auto' }}>{fmtMDHM(lastConfirmed.confirmedAt)}</span>
            </header>
            <div className="hl-card__body" style={{ gap: 12, flex: 1 }}>
              <div className="hl-row" style={{ fontSize: 13 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{lastConfirmed.goodsReceiptNo}</span>
                <span>{lastConfirmed.rawMaterial.itemName} · {lastConfirmed.purchaseOrder.supplier.supplierName}</span>
              </div>
              <div className="hl-node" style={{ borderColor: '#9FD0B3', background: '#F4FAF6' }}>
                <span className="hl-node__type" style={{ color: 'var(--ok)' }}><Icon name="check" size="sm" />원료 LOT 생성됨</span>
                <span className="hl-node__id" style={{ fontSize: 13.5 }}>{lastConfirmed.lot.lotNo}</span>
                <span className="hl-node__meta">{lastConfirmed.rawMaterial.itemName} {fmtTon(lastConfirmed.lot.initialTon)} · {lastConfirmed.yard?.yardName ?? '야드 미지정'} · 잔량 {fmtTon(lastConfirmed.lot.remainingTon)}</span>
              </div>
              <span className="hl-cap">발주 품목 입고 누계 {fmtTon(lastConfirmed.purchaseOrderItem.receivedTon)} · 미입고 {fmtTon(lastConfirmed.purchaseOrderItem.outstandingTon)}</span>
              <Link className="hl-btn hl-btn--primary" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} to={lotLink(lastConfirmed.lot.lotNo)}>
                <Icon name="trace" />
                LOT 추적에서 보기
              </Link>
            </div>
          </section>
        ) : (
          <section className="hl-card" style={{ borderColor: '#9FB6CD', minWidth: 0 }}>
            <header className="hl-card__head" style={{ background: '#F6F9FC' }}>
              <Icon name="box" style={{ color: '#173A5E' }} />
              <h3>원료 LOT</h3>
              <span className="hl-tag" style={{ marginLeft: 'auto' }}>확정 시 생성</span>
            </header>
            <div className="hl-card__body" style={{ gap: 10 }}>
              <div className="hl-node is-focus">
                <span className="hl-node__type"><Icon name="box" size="sm" />원료 LOT</span>
                <span className="hl-node__id" style={{ fontSize: 14 }}>RM-{item.rawMaterial.materialCode}-YYMMDD-NNN</span>
                <span className="hl-node__meta">번호는 입고를 확정할 때 서버가 매겨요 · 입고 1건마다 LOT 1개</span>
              </div>
              <div className="hl-row hl-cap" style={{ gap: 6, alignItems: 'flex-start' }}>
                <Icon name="info" size="sm" style={{ color: 'var(--run)' }} />
                <span>입고를 확정하면 원료 LOT이 만들어지고 원료 재고와 발주 입고 누계가 늘어요. 입고 검사는 하지 않아요 (범위 제외).</span>
              </div>
              {draftTon.length ? <span className="hl-cap" style={{ color: 'var(--run)' }}>확정을 기다리는 초안 {draftTon.length}건이 아래 입고 내역에 있어요</span> : null}
            </div>
          </section>
        )}
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <Icon name="history" />
          <h3>입고 내역</h3>
          <span className="hl-tag">{shown.length}</span>
          <div className="hl-card__actions">
            <div className="hl-seg">
              <button type="button" className={scope === 'ITEM' ? 'is-on' : undefined} onClick={() => setScope('ITEM')}>이 발주 품목</button>
              <button type="button" className={scope === 'ALL' ? 'is-on' : undefined} onClick={() => setScope('ALL')}>전체</button>
            </div>
          </div>
        </header>
        {serverError?.at === 'confirm' ? (
          <div className="hl-banner hl-banner--danger" role="alert" style={{ margin: '12px 16px 0' }}>
            <Icon name="alert" />
            <div><b>입고를 확정하지 못했어요</b><div>{serverError.message}</div></div>
          </div>
        ) : null}
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr><th>입고번호</th><th>발주번호</th><th>원료</th><th>입고일</th><th className="num">수량</th><th>야드</th><th>원료 LOT</th><th>상태</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.id === lastConfirmed?.id ? 'is-selected' : undefined}>
                  <td className="mono">{r.goodsReceiptNo}</td>
                  <td><Link className="hl-link-id" to={`/purchase-orders?po=${r.purchaseOrder.id}`}>{r.purchaseOrder.purchaseOrderNo}</Link></td>
                  <td>{r.rawMaterial.itemName}{r.note ? <span className="hl-cap" title={r.note}> · {r.note.length > 18 ? `${r.note.slice(0, 18)}…` : r.note}</span> : null}</td>
                  <td className="tnum">{d10(r.receiptDate)}</td>
                  <td className="num">{fmtTon(r.receivedTon)}</td>
                  <td>{r.yard?.yardName ?? <span className="hl-muted">-</span>}</td>
                  <td>{r.lot ? <Link className="hl-link-id" to={lotLink(r.lot.lotNo)}>{r.lot.lotNo}</Link> : <span className="hl-cap">확정하면 만들어져요</span>}</td>
                  <td><GrStatusBadge status={r.goodsReceiptStatus} /></td>
                  <td className="num">
                    {r.goodsReceiptStatus === 'DRAFT' ? (
                      <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" onClick={() => { setServerError(null); confirm.mutate(r.id); }} disabled={!canReceive || pending} title={canReceive ? '확정하면 원료 LOT이 만들어져요' : '권한이 필요해요'}>
                        <Icon name={canReceive ? 'check' : 'lock'} />
                        입고 확정
                      </button>
                    ) : (
                      <span className="hl-cap">{fmtMDHM(r.confirmedAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {receiptsError ? <tr><td colSpan={9}><EmptyNote>입고 내역을 불러오지 못했어요</EmptyNote></td></tr> : null}
              {receipts && !shown.length ? <tr><td colSpan={9}><EmptyNote>{scope === 'ITEM' ? '이 발주 품목의 입고가 아직 없어요' : '입고 내역이 없어요'}</EmptyNote></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="hl-card__foot">
          <span className="hl-cap">초안을 여러 개 만들어 합계가 미입고량을 넘으면, 넘는 초안은 확정할 때 거부돼요. 입고 검사는 하지 않아요 (범위 제외).</span>
        </div>
      </section>
    </>
  );
}
