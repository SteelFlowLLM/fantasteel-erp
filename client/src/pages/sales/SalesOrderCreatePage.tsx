// 수주 등록 (REQ-SO-001~003, SPEC 5-2·6). 모양은 v1 B안 s11: 왼쪽 입력 | 오른쪽 단계·예약 미리보기.
// 수량은 1 이상의 정수(슬래브 매, 코일 개)만 받고 반올림하지 않는다. 톤은 calcWeightTon 계산값으로만 보여주고 저장하지 않는다.
// 예약·생산계획은 저장할 때 서버가 정한다 — 오른쪽 숫자는 지금 가용재고로 본 미리보기다.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ITEM_QTY_UNIT, ITEM_TYPE_LABEL, calcWeightTon, sumTon } from '@fantasteel/shared';
import { ApiError, newIdempotencyKey } from '@/api/client';
import type { LookupProductSpec } from '@/api/lookups';
import { salesOrderApi, type CreateSalesOrderBody, type SalesOrderView } from '@/api/salesOrders';
import { DateInput } from '@/components/DateInput';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { useInventories } from '@/features/inventory/inventoryHooks';
import { FILL_COLOR, LockHint, sumOf, unitOf, useLookups } from '@/features/sales/salesUi';
import { useAction } from '@/hooks/useApi';
import { fmtDims, fmtTon, todayStr } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import './SalesOrderCreatePage.css';

type SpecType = 'SLAB' | 'COIL';
const QTY_ERROR = '수량은 1 이상의 정수로 입력해 주세요';
const small = { height: 28 };
const TYPES: SpecType[] = ['SLAB', 'COIL'];

interface Row { key: number; itemType: SpecType; grade: string; specId: number | null; qtyText: string }
type QtyState = { state: 'empty' } | { state: 'invalid' } | { state: 'ok'; qty: number };

/** 정수만 통과시킨다: "10" → 10. "10.5", "0", "-3", "1e2", "십" → invalid. 반올림하지 않는다. */
function parseQty(text: string): QtyState {
  const t = text.trim();
  if (!t) return { state: 'empty' };
  if (!/^\d+$/.test(t)) return { state: 'invalid' };
  const n = Number(t);
  return n >= 1 && Number.isSafeInteger(n) ? { state: 'ok', qty: n } : { state: 'invalid' };
}

export function SalesOrderCreatePage() {
  const me = useMe();
  const navigate = useNavigate();
  const canCreate = canUse(me, 'ORDER_CREATE');
  const lookups = useLookups();
  const inv = useInventories();
  // 폼을 연 동안 키 하나: 두 번 누르거나 다시 시도해도 수주가 한 건만 생긴다.
  const idemKey = useRef(newIdempotencyKey());
  const seq = useRef(1);
  const today = todayStr();

  const [customerId, setCustomerId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const specs = lookups.data?.productSpecs ?? [];
  const specById = new Map(specs.map((s) => [s.id, s]));
  const gradesOf = (t: SpecType) => [...new Set(specs.filter((s) => s.itemType === t).map((s) => s.steelGradeCode))];
  const specsOf = (t: SpecType, g: string) => specs.filter((s) => s.itemType === t && s.steelGradeCode === g);
  const newRow = (t: SpecType, g?: string): Row => {
    const grade = g && gradesOf(t).includes(g) ? g : gradesOf(t)[0] ?? '';
    return { key: seq.current++, itemType: t, grade, specId: specsOf(t, grade)[0]?.id ?? null, qtyText: '' };
  };

  // 선택 목록이 오면 첫 행을 하나 만들어 둔다
  const ready = specs.length > 0;
  useEffect(() => {
    if (ready) setRows((prev) => (prev.length ? prev : [newRow(TYPES.find((t) => gradesOf(t).length) ?? 'SLAB')]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const patchRow = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickType = (r: Row, t: SpecType) => { const n = newRow(t, r.grade); patchRow(r.key, { itemType: t, grade: n.grade, specId: n.specId }); };
  const pickGrade = (r: Row, g: string) => patchRow(r.key, { grade: g, specId: specsOf(r.itemType, g)[0]?.id ?? null });

  // ── 행 계산: 계산값 톤, 가용재고, 예약 미리보기 (같은 규격을 여러 행에 쓰면 앞 행부터 가용재고를 쓴다)
  const availLeft = new Map((inv.data?.products ?? []).map((p) => [p.productSpecId, p.availableQty]));
  const lines = rows.map((r, i) => {
    const spec: LookupProductSpec | undefined = r.specId !== null ? specById.get(r.specId) : undefined;
    const q = parseQty(r.qtyText);
    const qty = q.state === 'ok' ? q.qty : 0;
    const unit = ITEM_QTY_UNIT[r.itemType];
    const known = !!inv.data && !!spec && availLeft.has(spec.id);
    const avail = spec ? availLeft.get(spec.id) ?? 0 : 0;
    const reserve = known ? Math.min(qty, avail) : 0;
    if (spec && known) availLeft.set(spec.id, avail - reserve);
    const error = !spec ? '규격을 선택해 주세요' : q.state === 'invalid' ? QTY_ERROR : tried && q.state === 'empty' ? QTY_ERROR : null;
    return {
      r, no: i + 1, spec, q, qty, unit, known, avail, reserve, shortage: known ? qty - reserve : 0, error,
      ton: spec && q.state === 'ok' ? calcWeightTon(q.qty, spec.theoreticalWeightTon) : null,
    };
  });
  const okLines = lines.filter((l) => l.q.state === 'ok' && l.spec);
  const badLines = lines.filter((l) => l.error);
  const totalQty = sumOf(okLines, (l) => l.qty);
  const totalTon = sumTon(okLines.map((l) => l.ton ?? '0'));
  const totalUnit = unitOf(okLines.map((l) => ({ qtyUnit: l.unit })));
  const totalReserve = sumOf(okLines, (l) => l.reserve);
  const totalShortage = sumOf(okLines, (l) => l.shortage);
  const previewKnown = okLines.length > 0 && okLines.every((l) => l.known);
  const types = [...new Set(rows.map((r) => ITEM_TYPE_LABEL[r.itemType]))];

  const customerError = customerId === '' ? '고객사를 선택해 주세요' : null;
  const dueError = !dueDate ? '납기를 입력해 주세요' : dueDate < today ? '납기는 오늘 이후로 입력해 주세요' : null;
  const basicOk = !customerError && !dueError;
  const itemsOk = rows.length > 0 && okLines.length === rows.length;
  const customer = lookups.data?.customers.find((c) => c.id === customerId);

  const create = useAction((body: CreateSalesOrderBody) => salesOrderApi.create(body, idemKey.current), {
    invalidate: ['sales-orders', 'inventories', 'production-plans', 'chat-rooms', 'business-events'],
    success: (o: SalesOrderView) => {
      const reserved = sumOf(o.items, (it) => it.reservedQty);
      const short = o.items.filter((it) => it.unsecuredQty > 0);
      const u = unitOf(o.items);
      return `${o.salesOrderNo} 수주를 등록했어요 · 재고 예약 ${reserved}${u}` + (short.length ? ` · 부족 ${sumOf(short, (it) => it.unsecuredQty)}${u}는 생산계획 ${short.length}건으로 넘겼어요` : ' · 생산계획은 필요 없어요');
    },
    onSuccess: (o) => navigate(`/sales-orders/${o.id}`),
    onError: (e) => setServerError(e instanceof ApiError ? `${e.message} (${e.code})` : '저장하지 못했어요'),
  });

  const save = () => {
    setTried(true);
    setServerError(null);
    if (!canCreate || !basicOk || !itemsOk || customerId === '') return;
    create.mutate({
      customerId,
      dueDate,
      note: note.trim() || undefined,
      items: okLines.map((l) => ({ productSpecId: l.spec!.id, orderedQty: l.qty })),
    });
  };

  const stepDot = (done: boolean) => <span className="hl-step__dot">{done ? <i className="ic ic-check" style={{ width: 10, height: 10 }} /> : null}</span>;
  const secNo = (done: boolean, n: string) => <span className="n" style={done ? undefined : { background: '#C3CBD4' }}>{done ? <i className="ic ic-check" style={{ width: 11, height: 11 }} /> : n}</span>;

  if (!lookups.data) {
    return (
      <main className="hl-main">
        <QueryBoundary query={lookups} loadingLabel="고객사·규격을 불러오는 중…">{() => null}</QueryBoundary>
      </main>
    );
  }
  const lk = lookups.data;

  return (
        <>
          <section className="hl-master so-new" aria-label="수주 입력" style={{ width: 380 }}>
            <div className="hl-master__head" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <b style={{ fontSize: 14 }}>수주 입력</b>
              <span className="hl-cap">1 · 2단계</span>
              <Link className="hl-btn hl-btn--ghost hl-btn--sm" to="/sales-orders" style={{ marginLeft: 'auto' }}><Icon name="chevron-left" />목록</Link>
            </div>
            <div className="hl-master__list" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="sec">{secNo(basicOk, '1')}기본 정보</div>
              <dl className="hl-kv so-new__kv">
                <dt><label htmlFor="so-new-customer">고객사</label></dt>
                <dd>
                  <span className="hl-selectwrap">
                    <select id="so-new-customer" className={`hl-input${tried && customerError ? ' is-error' : ''}`} style={small} value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">고객사 선택</option>
                      {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.customerName}</option>)}
                    </select>
                    <Icon name="chevron-down" size="sm" style={{ top: 7 }} />
                  </span>
                  {tried && customerError ? <div className="hl-qty-hint" style={{ marginTop: 4 }}><Icon name="alert" size="sm" />{customerError}</div> : null}
                </dd>
                <dt>납기</dt>
                <dd>
                  <DateInput value={dueDate} onChange={setDueDate} min={today} ariaLabel="납기" width={170} invalid={tried && !!dueError} />
                  {tried && dueError
                    ? <div className="hl-qty-hint" style={{ marginTop: 4 }}><Icon name="alert" size="sm" />{dueError}</div>
                    : <div className="hl-cap" style={{ marginTop: 3, fontWeight: 400 }}>숫자로 입력(예: 20261020)하거나 달력에서 골라요</div>}
                </dd>
                <dt>담당</dt>
                <dd>{me.employeeName} <span className="hl-cap" style={{ fontWeight: 400 }}>· {me.departmentName} · 등록한 사원이 담당이 돼요</span></dd>
                <dt><label htmlFor="so-new-note">비고</label></dt>
                <dd><input id="so-new-note" className="hl-input" style={small} type="text" maxLength={500} value={note} placeholder="고객 요청 사항 (선택)" onChange={(e) => setNote(e.target.value)} /></dd>
              </dl>
              <div className="sec">
                {secNo(itemsOk, '2')}품목
                <span className="hl-tag">{rows.length}행</span>
                <span className="hl-cap" style={{ fontWeight: 500 }}>{types.length > 1 ? '코일·슬래브 혼합' : types[0] ?? ''}</span>
              </div>
              {lines.map((l) => {
                const { r } = l;
                const err = !!l.error;
                const grades = gradesOf(r.itemType);
                const specOptions = specsOf(r.itemType, r.grade);
                return (
                  <div key={r.key} className={`ir${err ? ' is-err' : ''}`}>
                    <div className="hl-row" style={{ fontSize: 12.5, gap: 6 }}>
                      <span className="hl-tag" style={err ? { background: '#FCEAE8', color: '#C0322B' } : undefined}>{l.no}</span>
                      <span className="hl-selectwrap" style={{ width: 74 }}>
                        <select className="hl-input" style={{ ...small, fontWeight: 600, paddingRight: 20, paddingLeft: 6 }} value={r.itemType} onChange={(e) => pickType(r, e.target.value as SpecType)} aria-label={`${l.no}행 품목 유형`}>
                          {TYPES.map((t) => <option key={t} value={t} disabled={!gradesOf(t).length}>{ITEM_TYPE_LABEL[t]}</option>)}
                        </select>
                        <Icon name="chevron-down" size="sm" style={{ top: 7, right: 5 }} />
                      </span>
                      <span className="hl-selectwrap" style={{ width: 82 }}>
                        <select className="hl-input mono" style={{ ...small, paddingRight: 20, paddingLeft: 6 }} value={r.grade} onChange={(e) => pickGrade(r, e.target.value)} aria-label={`${l.no}행 강종`}>
                          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <Icon name="chevron-down" size="sm" style={{ top: 7, right: 5 }} />
                      </span>
                      <span className="hl-selectwrap" style={{ flex: 1, minWidth: 0 }}>
                        <select className="hl-input" style={{ ...small, paddingRight: 20, paddingLeft: 6 }} value={r.specId ?? ''} onChange={(e) => patchRow(r.key, { specId: e.target.value ? Number(e.target.value) : null })} aria-label={`${l.no}행 규격 (두께 × 폭 × 길이 mm)`}>
                          {!specOptions.length ? <option value="">규격 없음</option> : null}
                          {specOptions.map((s) => <option key={s.id} value={s.id}>{fmtDims(s.thicknessMm, s.widthMm, s.lengthMm)}</option>)}
                        </select>
                        <Icon name="chevron-down" size="sm" style={{ top: 7, right: 5 }} />
                      </span>
                      <button className="hl-iconbtn hl-iconbtn--sm" style={{ width: 24, height: 24 }} aria-label={`${l.no}행 삭제`} type="button" disabled={rows.length <= 1} onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                        <Icon name="trash" />
                      </button>
                    </div>
                    <div className="ir__g">
                      <span className="hl-cap" title="1매 이론중량 (기준정보 확정값)">1{l.unit} {l.spec ? fmtTon(l.spec.theoreticalWeightTon) : '—'}</span>
                      <span className="hl-inputwrap">
                        <input
                          className={`hl-input num${err ? ' is-error' : ''}`}
                          type="text"
                          inputMode="numeric"
                          value={r.qtyText}
                          placeholder="0"
                          onChange={(e) => patchRow(r.key, { qtyText: e.target.value })}
                          style={{ paddingRight: 26 }}
                          aria-label={`${l.no}행 수량 (${l.unit})`}
                          aria-invalid={err || undefined}
                        />
                        <span className="hl-suffix">{l.unit}</span>
                      </span>
                    </div>
                    {l.error ? (
                      <div className="hl-qty-hint" style={{ paddingLeft: 80 }} role="alert"><Icon name="alert" size="sm" />{l.error}</div>
                    ) : l.q.state === 'ok' && l.spec ? (
                      <div className="hl-qty-ok" style={{ paddingLeft: 80 }}>
                        = <b style={{ color: '#121820' }}>{l.qty.toLocaleString('en-US')}{l.unit}</b> · {fmtTon(l.ton)} <span className="hl-tag">계산값</span>
                      </div>
                    ) : (
                      <div className="hl-qty-ok" style={{ paddingLeft: 80 }}>정수로 입력해요 · 톤은 자동으로 계산돼요</div>
                    )}
                    <span className="hl-cap" style={{ paddingLeft: 80, whiteSpace: 'normal' }}>
                      <span className="mono">{l.spec?.specCode ?? '—'}</span>
                      {' · '}
                      {inv.isLoading ? '가용재고 확인 중…' : inv.error ? '가용재고를 불러오지 못했어요' : l.spec && l.known ? `합격 가용재고 ${l.avail}${l.unit}` : '가용재고 정보 없음'}
                      {l.q.state === 'ok' && l.known ? <> → <b>재고에서 {l.reserve}{l.unit} 예약{l.shortage ? ` · 부족 ${l.shortage}${l.unit} → 생산계획` : ''}</b> (예상)</> : null}
                    </span>
                  </div>
                );
              })}
              <button className="hl-btn hl-btn--sm" style={{ borderStyle: 'dashed' }} type="button" onClick={() => setRows((prev) => [...prev, newRow(prev[prev.length - 1]?.itemType ?? 'SLAB', prev[prev.length - 1]?.grade)])}>
                <Icon name="plus" />품목 행 추가
              </button>
              <div className="hl-cap" style={{ display: 'flex', gap: 6, lineHeight: '16px' }}>
                <Icon name="info" size="sm" />
                수량은 정수로 입력해요 (슬래브 매 · 코일 개) · 톤은 수량 × 1매 이론중량 계산값이고 저장하지 않아요
              </div>
            </div>
            <div className="hl-col" style={{ padding: '12px 16px', borderTop: '1px solid #DDE2E7', background: '#F7F8FA', gap: 8 }}>
              {serverError ? <div className="hl-qty-hint" role="alert"><Icon name="alert" size="sm" />{serverError}</div> : null}
              <div className="hl-row">
                {!canCreate ? (
                  <LockHint>수주 등록 권한 필요</LockHint>
                ) : (
                  <span className="hl-cap" style={tried && (badLines.length || !basicOk) ? { color: '#C0322B' } : undefined}>
                    {tried && !basicOk ? '기본 정보를 확인해 주세요' : badLines.length ? `${badLines.map((l) => l.no).join('·')}행 수정 후 저장` : `합계 ${totalQty.toLocaleString('en-US')}${totalUnit} · ${fmtTon(totalTon)} (계산값)`}
                  </span>
                )}
                <Link className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} to="/sales-orders">취소</Link>
                <button className="hl-btn hl-btn--sm hl-btn--primary" type="button" disabled={create.isPending || !canCreate} title={canCreate ? undefined : '권한이 필요해요'} onClick={save}>
                  {create.isPending ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </section>
          <main className="hl-main so-new" style={{ padding: '16px 24px', gap: 12 }}>
            <section className="hl-card" style={{ flex: 'none' }}>
              <div className="hl-steps" style={{ padding: '12px 20px' }}>
                <span className={basicOk ? 'hl-step is-done' : 'hl-step is-run'}>{stepDot(basicOk)}1 · 기본 정보</span>
                <span className={`hl-step__line${basicOk ? ' is-done' : ''}`} />
                <span className={itemsOk ? 'hl-step is-done' : basicOk ? 'hl-step is-run' : 'hl-step'}>
                  {stepDot(itemsOk)}2 · 품목{' '}
                  <span className="hl-cap" style={{ fontWeight: 500 }}>({okLines.length}행 입력{badLines.length ? ` · ${badLines.length}행 확인 필요` : ''})</span>
                </span>
                <span className={`hl-step__line${itemsOk && basicOk ? ' is-done' : ''}`} />
                <span className={basicOk && itemsOk ? 'hl-step is-run' : 'hl-step'}>{stepDot(false)}3 · 저장·예약 결과</span>
              </div>
            </section>
            <div className="hl-banner hl-banner--run" style={{ flex: 'none', padding: '8px 12px' }}>
              <Icon name="info" />
              <span>아래는 지금 가용재고로 본 <b>미리보기</b>예요. 실제 예약 수량과 생산계획은 저장할 때 서버가 정해요 (그 사이 다른 수주가 먼저 예약하면 달라질 수 있어요).</span>
            </div>
            <div className="hl-statbar" style={{ flex: 'none' }}>
              <div className="hl-kpi" style={{ padding: '10px 16px', gap: 2 }}>
                <span className="hl-kpi__label">주문 합계</span>
                <span className="big">{totalQty.toLocaleString('en-US')}<small>{totalUnit}</small></span>
                <span className="hl-kpi__sub">{fmtTon(totalTon)} 계산값 · {okLines.length}품목{customer ? ` · ${customer.customerName}` : ''}{dueDate ? ` · 납기 ${dueDate}` : ''}</span>
              </div>
              <div className="hl-kpi" style={{ padding: '10px 16px', gap: 2 }}>
                <span className="hl-kpi__label">재고 예약 (예상)</span>
                <span className="big">{previewKnown ? totalReserve.toLocaleString('en-US') : '—'}<small>{totalUnit}</small></span>
                <span className="hl-kpi__sub">합격·가용 재고 우선 · LOT은 정하지 않아요</span>
              </div>
              <div className="hl-kpi" style={{ padding: '10px 16px', gap: 2 }}>
                <span className="hl-kpi__label">생산 필요 (예상)</span>
                <span className="big hl-wait-text">{previewKnown ? totalShortage.toLocaleString('en-US') : '—'}<small>{totalUnit}</small></span>
                <span className="hl-kpi__sub">{!previewKnown ? '수량을 입력하면 계산해요' : totalShortage ? '부족한 수량만 생산계획으로 넘어가요' : '생산 필요 없음'}</span>
              </div>
            </div>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <header className="hl-card__head">
                <h3>품목별 예약 미리보기</h3>
                <span className="hl-card__meta">수량 기준 · 저장 전</span>
              </header>
              <table className="hl-table">
                <thead>
                  <tr>
                    <th>품목</th>
                    <th>규격 코드</th>
                    <th className="num">주문</th>
                    <th className="num">가용재고</th>
                    <th style={{ width: 220 }}>예약 / 생산 필요</th>
                    <th>예상 결과</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const bb = i === lines.length - 1 ? { borderBottom: 0 } : undefined;
                    const ok = l.q.state === 'ok' && !!l.spec;
                    return (
                      <tr key={l.r.key} className={ok ? undefined : 'is-muted'}>
                        <td style={bb}>
                          <span className="hl-tag">{l.no}</span>{' '}
                          {ITEM_TYPE_LABEL[l.r.itemType]} <span className="mono">{l.r.grade}</span>{' '}
                          {l.spec ? fmtDims(l.spec.thicknessMm, l.spec.widthMm, l.spec.lengthMm) : ''}
                        </td>
                        <td className="mono" style={bb}>{l.spec?.specCode ?? '—'}</td>
                        <td className={`num${l.q.state === 'invalid' ? ' hl-danger-text' : ''}`} style={bb}>{ok ? `${l.qty.toLocaleString('en-US')}${l.unit} · ${fmtTon(l.ton)}` : l.r.qtyText.trim() || '미입력'}</td>
                        <td className="num" style={bb}>{l.spec && inv.data ? `${(inv.data.products.find((p) => p.productSpecId === l.spec!.id)?.availableQty ?? 0).toLocaleString('en-US')}${l.unit}` : '—'}</td>
                        <td style={bb}>
                          {ok && l.known ? (
                            <div className="hl-stack" style={{ height: 10 }}>
                              {l.reserve ? <span style={{ width: `${(l.reserve / l.qty) * 100}%`, background: FILL_COLOR.reserved }} /> : null}
                              {l.shortage ? <span style={{ width: `${(l.shortage / l.qty) * 100}%`, background: FILL_COLOR.need }} /> : null}
                            </div>
                          ) : <span className="hl-cap">—</span>}
                        </td>
                        <td style={bb}>
                          {!ok ? <span className="hl-badge hl-badge--danger">{l.q.state === 'empty' ? '수량 입력 필요' : '수량 확인 필요'}</span>
                            : !l.known ? <span className="hl-cap">가용재고 정보 없음</span>
                              : <b>재고에서 {l.reserve}{l.unit} 예약{l.shortage ? <> · <span className="hl-wait-text">부족 {l.shortage}{l.unit} → 생산계획</span></> : null}</b>}
                        </td>
                      </tr>
                    );
                  })}
                  {!lines.length ? <tr><td colSpan={6} style={{ borderBottom: 0 }}><EmptyNote>{specs.length ? '품목 행을 추가해 주세요' : '사용 중인 제품 규격이 없어요 · 기준정보에서 규격을 등록해 주세요'}</EmptyNote></td></tr> : null}
                </tbody>
              </table>
              <div className="hl-card__foot">
                <span className="hl-actor hl-actor--system">시스템</span>
                <span style={{ fontSize: 12.5 }}>저장하면 합격·가용 재고를 수량 단위로 먼저 예약하고(부분 예약 허용), 부족한 수량만 생산계획으로 넘겨요 · 특정 LOT 배정은 출하요청 때 해요</span>
                <div className="hl-legend" style={{ marginLeft: 'auto' }}>
                  <span><i style={{ background: FILL_COLOR.reserved }} />예약</span>
                  <span><i style={{ background: FILL_COLOR.need }} />생산 필요</span>
                </div>
              </div>
            </section>
            <section className="hl-card" style={{ flex: 'none' }}>
              <header className="hl-card__head"><h3>저장하면 이렇게 돼요</h3></header>
              <div className="hl-card__body" style={{ padding: '12px 16px', gap: 8, fontSize: 12.5 }}>
                <div className="hl-row" style={{ gap: 8 }}><Icon name="gauge" />수주 상세로 이동해 품목별 충족 현황(예약 · 생산중 · 검사합격 · 출하)을 볼 수 있어요</div>
                <div className="hl-row" style={{ gap: 8 }}><Icon name="hash" />수주 업무방이 만들어져요 (담당자 + 생산·품질·물류·구매 부서장)</div>
                <div className="hl-row" style={{ gap: 8 }}><Icon name="history" />수주 등록 · 예약 · 생산계획 생성이 작업 로그에 남아요</div>
                <div className="hl-row" style={{ gap: 8 }}><Icon name="shield" />저장을 두 번 눌러도 수주는 한 건만 만들어져요</div>
              </div>
            </section>
          </main>
        </>
  );
}
