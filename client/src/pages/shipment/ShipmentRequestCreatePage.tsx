// 출하요청 등록 (REQ-SHP-001). v1 B안 23번: 왼쪽 출하 가능 수주 품목 | 오른쪽 선택한 품목·요청 정보.
// 고객사를 고르고 → 그 고객사의 수주 품목을 체크하고 → 출하 매수·요청일을 넣어 등록하면 배정 화면으로 간다.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { calcWeightTon } from '@fantasteel/shared';
import { shipmentRequestApi, type ShippableItemView } from '@/api/shipments';
import { DateInput } from '@/components/DateInput';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { SalesOrderLink, itemTypeLabel, shipDateLabel, unitOf } from '@/features/shipment/shipmentUi';
import { useAction } from '@/hooks/useApi';
import { fmtInt, fmtMD, fmtTon, todayStr } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';

const MEMO_MAX = 500;

/** 출하 매수 입력 검사: 1 이상의 정수, 출하 가능 매수 이하. 맞으면 null */
function qtyError(text: string, row: ShippableItemView): string | null {
  const s = text.trim();
  if (!s) return '매수를 입력해 주세요';
  if (!/^\d+$/.test(s)) return '1 이상의 정수로 입력해 주세요';
  const n = Number(s);
  if (n < 1) return '1 이상의 정수로 입력해 주세요';
  if (n > row.shippableQty) return `출하 가능 ${row.shippableQty}${row.qtyUnit}까지 요청할 수 있어요`;
  return null;
}

export function ShipmentRequestCreatePage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetOrderId = Number(params.get('salesOrderId')) || null;
  const canRequest = canUse(me, 'SHIPMENT_REQUEST');

  const shippable = useQuery({ queryKey: ['shipment-requests', 'shippable'], queryFn: () => shipmentRequestApi.shippable() });
  const all = shippable.data;

  const [customerId, setCustomerId] = useState<number | null>(null);
  /** 고른 품목: salesOrderItemId → 입력한 매수(문자열) */
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [shipDate, setShipDate] = useState('');
  const [memo, setMemo] = useState('');
  const [q, setQ] = useState('');
  const today = todayStr();

  // 처음 한 번: ?salesOrderId= 가 있으면 그 수주의 고객사와 품목을 미리 고른다. 고객사가 하나뿐이면 그 고객사를 고른다.
  const initialized = useRef(false);
  useEffect(() => {
    if (!all || initialized.current) return;
    initialized.current = true;
    const preset = presetOrderId ? all.filter((r) => r.salesOrderId === presetOrderId) : [];
    if (preset.length) {
      setCustomerId(preset[0].customer.id);
      setPicks(Object.fromEntries(preset.map((r) => [r.salesOrderItemId, String(r.shippableQty)])));
      return;
    }
    const ids = [...new Set(all.map((r) => r.customer.id))];
    if (ids.length === 1) setCustomerId(ids[0]);
  }, [all, presetOrderId]);

  const create = useAction(shipmentRequestApi.create, {
    success: (r) => `출하요청 ${r.shipmentRequestNo}을(를) 등록했어요`,
    invalidate: ['shipment-requests', 'sales-orders'],
    onSuccess: (r) => navigate(`/shipment-requests/${r.id}`),
  });

  return (
    <QueryBoundary query={shippable}>
      {(rowsAll) => {
        const customers = [...new Map(rowsAll.map((r) => [r.customer.id, r.customer])).values()].sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko'));
        const ofCustomer = customerId === null ? [] : rowsAll.filter((r) => r.customer.id === customerId);
        const text = q.trim().toLowerCase();
        const visible = ofCustomer.filter((r) => !text || [r.salesOrderNo, r.specCode, r.steelGradeCode].some((s) => s.toLowerCase().includes(text)));
        // 수주별로 묶기 (목록 순서 유지)
        const groups: { orderId: number; orderNo: string; dueDate: string; rows: ShippableItemView[] }[] = [];
        for (const r of visible) {
          const g = groups.find((x) => x.orderId === r.salesOrderId);
          if (g) g.rows.push(r);
          else groups.push({ orderId: r.salesOrderId, orderNo: r.salesOrderNo, dueDate: r.dueDate, rows: [r] });
        }
        // 고른 품목 (목록에서 사라진 품목은 뺀다 — 다른 사람이 먼저 요청했을 수 있다)
        const picked = ofCustomer.filter((r) => picks[r.salesOrderItemId] !== undefined).map((r) => {
          const qtyText = picks[r.salesOrderItemId];
          const error = qtyError(qtyText, r);
          return { row: r, qtyText, error, qty: error ? 0 : Number(qtyText) };
        });
        const valid = picked.filter((x) => !x.error);
        const orderNos = [...new Set(picked.map((x) => x.row.salesOrderNo))];
        const totalQty = valid.reduce((a, x) => a + x.qty, 0);
        // 입력 중 미리보기 톤 (계산값). 저장되는 톤은 서버가 계산한다.
        const previewTon = valid.reduce((a, x) => a + Number(calcWeightTon(x.qty, x.row.theoreticalWeightTon)), 0);
        const earliestDue = picked.length ? picked.map((x) => x.row.dueDate).sort()[0] : null;
        const dateError = !shipDate ? null : shipDate < today ? '오늘 이후 날짜로 입력해 주세요' : null;
        const ready = canRequest && customerId !== null && picked.length > 0 && valid.length === picked.length && !!shipDate && !dateError && memo.length <= MEMO_MAX;

        const changeCustomer = (id: number | null) => { setCustomerId(id); setPicks({}); setQ(''); };
        const toggle = (r: ShippableItemView) => setPicks((p) => {
          const n = { ...p };
          if (n[r.salesOrderItemId] !== undefined) delete n[r.salesOrderItemId];
          else n[r.salesOrderItemId] = String(r.shippableQty);
          return n;
        });
        const setQty = (r: ShippableItemView, v: string) => setPicks((p) => ({ ...p, [r.salesOrderItemId]: v.replace(/[^\d]/g, '') }));
        const submit = () => {
          if (!ready || customerId === null) return;
          create.mutate({
            customerId,
            requestedShipDate: shipDate,
            memo: memo.trim() || undefined,
            items: valid.map((x) => ({ salesOrderItemId: x.row.salesOrderItemId, requestQty: x.qty })),
          });
        };
        const customerName = customers.find((c) => c.id === customerId)?.customerName;

        return (
          <>
            <section className="hl-master" aria-label="출하 가능 수주 품목">
              <div className="hl-master__head">
                <div className="hl-row">
                  <b style={{ fontSize: 14 }}>출하 가능 수주</b>
                  <span className="hl-tag">{ofCustomer.length}</span>
                  <span className="hl-cap" style={{ marginLeft: 'auto' }}>선택 {picked.length} 품목</span>
                </div>
                <label className="hl-field">
                  <span className="hl-field__label">고객사<span className="req">*</span></span>
                  <span className="hl-selectwrap">
                    <select className="hl-input" value={customerId ?? ''} onChange={(e) => changeCustomer(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">고객사를 골라 주세요</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName} ({rowsAll.filter((r) => r.customer.id === c.id).length}품목)</option>)}
                    </select>
                    <Icon name="chevron-down" size="sm" />
                  </span>
                </label>
                <label className="hl-inputwrap">
                  <Icon name="search" size="sm" />
                  <input className="hl-input" type="search" placeholder="수주번호·규격 검색" aria-label="수주 품목 검색" value={q} onChange={(e) => setQ(e.target.value)} disabled={customerId === null} />
                </label>
              </div>
              <div className="hl-master__list">
                {groups.map((g) => (
                  <div key={g.orderId}>
                    <div style={{ padding: '8px 16px 6px', background: '#F7F8FA', borderBottom: '1px solid #DDE2E7' }} className="hl-row">
                      <Link className="hl-link-id" to={`/sales-orders/${g.orderId}`}>{g.orderNo}</Link>
                      <span className="hl-cap" style={{ marginLeft: 'auto' }}>납기 {fmtMD(`${g.dueDate.slice(0, 10)}T00:00:00+09:00`)}</span>
                    </div>
                    {g.rows.map((r) => {
                      const on = picks[r.salesOrderItemId] !== undefined;
                      const pick = picked.find((x) => x.row.salesOrderItemId === r.salesOrderItemId);
                      return (
                        <label key={r.salesOrderItemId} className={`hl-mitem${on ? ' is-active' : ''}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(r)} aria-label={`${r.salesOrderNo} 품목 ${r.lineNo} 선택`} style={{ marginTop: 2 }} />
                          <span className="hl-col" style={{ gap: 3, flex: 1 }}>
                            <span className="hl-row" style={{ gap: 6 }}>
                              <span className="hl-tag">{itemTypeLabel(r.itemType)}</span>
                              <span className="mono" style={{ fontSize: 12 }}>{r.specCode}</span>
                            </span>
                            <span className="hl-row" style={{ fontSize: 12 }}>
                              <span className="hl-muted">품목 {r.lineNo} · 출하 가능</span>
                              <span className="hl-sheets">{fmtInt(r.shippableQty)}<small>{r.qtyUnit}</small></span>
                              {on && pick && !pick.error ? (
                                <span className="tnum" style={{ marginLeft: 'auto', fontWeight: 600 }}>{pick.qty}{r.qtyUnit} 요청</span>
                              ) : (
                                <span className="hl-cap" style={{ marginLeft: 'auto' }}>예약 {r.reservedQty}{r.requestedQty ? ` · 요청됨 ${r.requestedQty}` : ''}</span>
                              )}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
                {customerId === null ? (
                  <EmptyNote>{rowsAll.length ? '고객사를 먼저 골라 주세요. 같은 고객사의 수주 품목만 묶을 수 있어요' : '출하요청할 수 있는 수주 품목이 없어요. 합격 재고가 예약된 품목만 나와요'}</EmptyNote>
                ) : !groups.length ? (
                  <EmptyNote>{ofCustomer.length ? '조건에 맞는 품목이 없어요' : '이 고객사는 출하요청할 수 있는 품목이 없어요'}</EmptyNote>
                ) : null}
              </div>
              <div style={{ borderTop: '1px solid #DDE2E7', padding: '12px 16px', background: '#F7F8FA', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="hl-label">출하 가능 매수</span>
                <span className="hl-cap" style={{ lineHeight: '17px' }}>예약 매수(ACTIVE) − 다른 미출고 출하요청 매수예요. 출하 가능 매수가 있는 품목만 나와요.</span>
              </div>
            </section>

            <main className="hl-main">
              <div className="hl-page-head">
                <div>
                  <div className="hl-crumb">
                    <Link to="/shipment-requests">출하요청</Link>
                    <Icon name="chevron-right" size="sm" />
                    새 출하요청
                  </div>
                  <div className="hl-row" style={{ gap: 10 }}>
                    <h1 className="hl-title">새 출하요청</h1>
                    <span className="hl-badge">작성 중</span>
                    <span className="hl-cap">{customerName ? `${customerName} · ` : ''}수주 {orderNos.length}건 · 품목 {picked.length}개 묶음</span>
                  </div>
                </div>
                <div className="hl-page-head__actions">
                  <Link className="hl-btn" to="/shipment-requests">목록</Link>
                  <button type="button" className="hl-btn hl-btn--primary" disabled={!ready || create.isPending} onClick={submit} title={canRequest ? undefined : '권한이 필요해요'}>
                    출하요청 등록 · 배정 추천
                    <Icon name="arrow-right" />
                  </button>
                </div>
              </div>

              <div className="hl-statbar" style={{ flex: 'none' }}>
                <div className="hl-kpi">
                  <span className="hl-kpi__label"><Icon name="order" size="sm" />묶은 품목</span>
                  <span className="hl-kpi__value">{picked.length}<small>품목</small></span>
                  <span className="hl-kpi__sub">{orderNos.length ? orderNos.join(' · ') : '선택한 수주 없음'}</span>
                </div>
                <div className="hl-kpi">
                  <span className="hl-kpi__label"><Icon name="slab" size="sm" />출하 매수</span>
                  <span className="hl-kpi__value">{fmtInt(totalQty)}<small>{unitOf(picked.map((x) => x.row))}</small></span>
                  <span className="hl-kpi__sub">{valid.length ? valid.map((x) => `${x.qty}${x.row.qtyUnit}`).join(' + ') : '—'}</span>
                </div>
                <div className="hl-kpi">
                  <span className="hl-kpi__label"><Icon name="box" size="sm" />이론중량 (계산값)</span>
                  <span className="hl-kpi__value">{valid.length ? previewTon.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '—'}{valid.length ? <small>t</small> : null}</span>
                  <span className="hl-kpi__sub">매수 × 1매 이론중량 · 등록하면 서버가 다시 계산해요</span>
                </div>
                <div className="hl-kpi">
                  <span className="hl-kpi__label"><Icon name="calendar" size="sm" />출하 요청일</span>
                  <span className="hl-kpi__value" style={{ fontSize: 22 }}>{shipDate && !dateError ? shipDateLabel(shipDate) : '—'}</span>
                  <span className="hl-kpi__sub">{earliestDue ? `가장 이른 납기 ${earliestDue.slice(0, 10)}` : '품목을 고르면 납기를 보여드려요'}</span>
                </div>
              </div>

              <section className="hl-card" style={{ flex: 'none' }}>
                <header className="hl-card__head">
                  <h2>선택한 품목</h2>
                  <span className="hl-card__meta">왼쪽 목록에서 체크한 품목 · 출하 가능 매수 안에서 출하 매수 입력</span>
                </header>
                <div className="hl-card__body hl-card__body--flush" style={{ overflow: 'auto' }}>
                  <table className="hl-table">
                    <thead>
                      <tr>
                        <th>수주</th>
                        <th>구분</th>
                        <th>강종</th>
                        <th>규격</th>
                        <th>납기</th>
                        <th className="num">주문</th>
                        <th className="num">출고 누계</th>
                        <th className="num">예약 매수</th>
                        <th className="num">다른 출하요청</th>
                        <th className="num">출하 가능</th>
                        <th style={{ width: 120 }}>출하 매수</th>
                        <th className="num">이론중량 (계산값)</th>
                        <th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {picked.map((x) => (
                        <tr key={x.row.salesOrderItemId}>
                          <td><SalesOrderLink id={x.row.salesOrderId} no={x.row.salesOrderNo} lineNo={x.row.lineNo} /></td>
                          <td><span className="hl-tag">{itemTypeLabel(x.row.itemType)}</span></td>
                          <td className="mono">{x.row.steelGradeCode}</td>
                          <td className="mono">{x.row.specCode}</td>
                          <td className="tnum">{x.row.dueDate.slice(0, 10)}</td>
                          <td className="num">{fmtInt(x.row.orderedQty)}</td>
                          <td className="num">{fmtInt(x.row.shippedQty)}</td>
                          <td className="num">{fmtInt(x.row.reservedQty)}</td>
                          <td className="num">{fmtInt(x.row.requestedQty)}</td>
                          <td className="num"><span className="hl-sheets">{fmtInt(x.row.shippableQty)}<small>{x.row.qtyUnit}</small></span></td>
                          <td>
                            <span className="hl-col" style={{ gap: 2, padding: x.error ? '4px 0' : undefined }}>
                              <span className="hl-inputwrap" style={{ width: 92 }}>
                                <input
                                  className={`hl-input num${x.error ? ' is-error' : ''}`}
                                  inputMode="numeric"
                                  value={x.qtyText}
                                  onChange={(e) => setQty(x.row, e.target.value)}
                                  aria-label={`${x.row.salesOrderNo} 품목 ${x.row.lineNo} 출하 매수`}
                                  aria-invalid={!!x.error}
                                  title={`1 ~ ${x.row.shippableQty}${x.row.qtyUnit}`}
                                  style={{ paddingRight: 28, textAlign: 'right' }}
                                />
                                <span className="hl-suffix">{x.row.qtyUnit}</span>
                              </span>
                              {x.error ? <span className="hl-danger-text" style={{ fontSize: 11 }}>{x.error}</span> : null}
                            </span>
                          </td>
                          <td className="num" style={{ fontWeight: 600 }}>{x.error ? '—' : fmtTon(calcWeightTon(x.qty, x.row.theoreticalWeightTon))}</td>
                          <td>
                            <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label={`${x.row.salesOrderNo} 품목 ${x.row.lineNo} 빼기`} onClick={() => toggle(x.row)}>
                              <Icon name="x" size="sm" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!picked.length ? <tr><td colSpan={13}><EmptyNote>{customerId === null ? '왼쪽에서 고객사를 고르고 출하할 품목을 체크해 주세요' : '왼쪽 목록에서 출하할 품목을 체크해 주세요'}</EmptyNote></td></tr> : null}
                    </tbody>
                    {picked.length ? (
                      <tfoot>
                        <tr>
                          <td colSpan={10}>합계 · 수주 {orderNos.length}건</td>
                          <td><span className="hl-sheets">{fmtInt(totalQty)}<small>{unitOf(picked.map((x) => x.row))}</small></span></td>
                          <td className="num">{fmtTon(previewTon)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
                <div className="hl-card__foot">
                  <Icon name="info" size="sm" />
                  <span className="hl-cap">부분 출하는 출하요청을 나눠서 해요. 예: 10매 중 4매를 먼저 요청·출고하고, 나머지 6매는 출하요청을 새로 만들어요.</span>
                </div>
              </section>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: 16, flex: 'none' }}>
                <section className="hl-card" style={{ overflow: 'visible' }}>
                  <header className="hl-card__head">
                    <h2>요청 정보</h2>
                    <span className="hl-card__meta">출하번호는 등록할 때 정해져요</span>
                  </header>
                  <div className="hl-card__body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', overflow: 'visible' }}>
                    <div className="hl-field">
                      <span className="hl-field__label">출하 요청일<span className="req">*</span></span>
                      <DateInput value={shipDate} onChange={setShipDate} min={today} ariaLabel="출하 요청일" invalid={!!dateError} width={170} />
                      <span className={dateError ? 'hl-field__hint hl-danger-text' : 'hl-field__hint'}>{dateError ?? '오늘 이후 날짜 · 출고는 물류가 확정해요'}</span>
                    </div>
                    <div className="hl-field">
                      <label htmlFor="shp-new-requester">요청자</label>
                      <input id="shp-new-requester" className="hl-input" value={`${me.employeeName} · ${me.departmentName ?? ''}`} readOnly />
                    </div>
                    <div className="hl-field" style={{ gridColumn: '1 / -1' }}>
                      <label htmlFor="shp-new-memo">메모</label>
                      <textarea id="shp-new-memo" className={`hl-input${memo.length > MEMO_MAX ? ' is-error' : ''}`} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 1차 출하 · 오전 상차 희망" />
                      <span className={memo.length > MEMO_MAX ? 'hl-field__hint hl-danger-text' : 'hl-field__hint'}>{memo.length} / {MEMO_MAX}자</span>
                    </div>
                  </div>
                </section>
                <section className="hl-card">
                  <header className="hl-card__head"><h2>등록하면</h2></header>
                  <div className="hl-card__body">
                    <div className="hl-banner hl-banner--run">
                      <Icon name="info" />
                      <div>품목별로 <b>합격 LOT을 FIFO로 추천</b>해요. 추천은 담당자가 확정해요.</div>
                    </div>
                    <ul className="hl-col" style={{ gap: 8, fontSize: 12.5, margin: 0, padding: 0, listStyle: 'none' }}>
                      <li className="hl-row"><Icon name="check" size="sm" style={{ color: 'var(--ok)' }} />강종·규격이 같은 합격 LOT만 후보</li>
                      <li className="hl-row"><Icon name="check" size="sm" style={{ color: 'var(--ok)' }} />생산완료일이 오래된 순으로 추천</li>
                      <li className="hl-row"><Icon name="check" size="sm" style={{ color: 'var(--ok)' }} />출고 확정 전까지 배정 변경 가능</li>
                    </ul>
                    {!canRequest ? <span className="hl-lockhint"><Icon name="lock" size="sm" />출하요청 등록은 영업 담당만 할 수 있어요 (권한 필요)</span> : null}
                    <button type="button" className="hl-btn hl-btn--primary" style={{ marginTop: 'auto' }} disabled={!ready || create.isPending} onClick={submit} title={canRequest ? undefined : '권한이 필요해요'}>
                      등록하고 배정 추천 보기
                      <Icon name="arrow-right" />
                    </button>
                  </div>
                </section>
              </div>
            </main>
          </>
        );
      }}
    </QueryBoundary>
  );
}
