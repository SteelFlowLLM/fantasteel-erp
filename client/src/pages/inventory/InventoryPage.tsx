// 재고 (REQ-INV-001·008): 제품(매수·예약·가용) / 원료(톤) / 여재. 조회 전용, 로그인한 모든 사원이 본다.
// 숫자는 GET /inventories, GET /inventories/surplus 응답 그대로다. 톤은 서버가 매수 × 1매 이론중량으로 계산한 값.
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ITEM_QTY_UNIT, ITEM_TYPE_LABEL, RAW_MATERIAL_TYPE_LABEL, type RawMaterialType } from '@fantasteel/shared';
import type { ProductInventoryView } from '@/api/inventories';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { useInventories, useSurplus } from '@/features/inventory/inventoryHooks';
import { lotHref, planHref, sumOf, useLookups } from '@/features/sales/salesUi';
import { fmtDims, fmtMDHM, fmtTon } from '@/lib/format';
import './InventoryPage.css';

type Tab = 'products' | 'raw' | 'surplus';
const TABS: { key: Tab; label: string }[] = [
  { key: 'products', label: '제품' },
  { key: 'raw', label: '원료' },
  { key: 'surplus', label: '여재' },
];
type ProductType = 'SLAB' | 'COIL';

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'raw' || raw === 'surplus' ? raw : 'products';
  const itemType = (params.get('itemType') === 'SLAB' || params.get('itemType') === 'COIL' ? params.get('itemType') : '') as ProductType | '';
  const steelGrade = params.get('steelGrade') ?? '';
  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const lookups = useLookups();
  const grades = lookups.data?.steelGrades ?? [];

  const gradeSelect = (
    <label className="hl-row" style={{ gap: 6 }}>
      <span className="hl-cap">강종</span>
      <span className="hl-selectwrap" style={{ width: 130 }}>
        <select className="hl-input mono" value={steelGrade} onChange={(e) => setParam({ steelGrade: e.target.value })} aria-label="강종">
          <option value="">전체</option>
          {grades.map((g) => <option key={g.id} value={g.steelGradeCode}>{g.steelGradeCode}</option>)}
          {steelGrade && !grades.some((g) => g.steelGradeCode === steelGrade) ? <option value={steelGrade}>{steelGrade}</option> : null}
        </select>
        <Icon name="chevron-down" size="sm" />
      </span>
    </label>
  );

  return (
    <main className="hl-main inv-page" style={{ padding: '16px 20px', gap: 12 }}>
      <div className="hl-tabs" role="tablist" aria-label="재고 구분">
        {TABS.map((t) => (
          <button key={t.key} className={`hl-tab${tab === t.key ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setParam({ tab: t.key === 'products' ? '' : t.key })}>
            {t.label}
          </button>
        ))}
        <span className="hl-cap" style={{ marginLeft: 'auto', alignSelf: 'center' }}>조회 전용 · 예약·출고·검사가 반영되면 바로 바뀌어요</span>
      </div>
      {tab === 'products' ? (
        <ProductTab itemType={itemType} steelGrade={steelGrade} setParam={setParam} gradeSelect={gradeSelect} />
      ) : tab === 'raw' ? (
        <RawTab />
      ) : (
        <SurplusTab steelGrade={steelGrade} gradeSelect={gradeSelect} />
      )}
    </main>
  );
}

const q = (n: number, unit: string, cls?: string) => (n ? <span className={`hl-sheets${cls ? ` ${cls}` : ''}`}>{n.toLocaleString('en-US')}<small>{unit}</small></span> : <span className="hl-muted">0{unit}</span>);

function ProductTab({ itemType, steelGrade, setParam, gradeSelect }: { itemType: ProductType | ''; steelGrade: string; setParam: (p: Record<string, string>) => void; gradeSelect: ReactNode }) {
  const inv = useInventories({ itemType: itemType || undefined, steelGrade: steelGrade || undefined });
  const seg: (ProductType | '')[] = ['', 'SLAB', 'COIL'];
  return (
    <>
      <div className="inv-page__filters">
        <div className="hl-seg" role="tablist" aria-label="품목 유형">
          {seg.map((k) => (
            <button key={k || 'ALL'} className={itemType === k ? 'is-on' : undefined} type="button" role="tab" aria-selected={itemType === k} onClick={() => setParam({ itemType: k })}>
              {k ? ITEM_TYPE_LABEL[k] : '전체'}
            </button>
          ))}
        </div>
        {gradeSelect}
        {inv.isFetching && inv.data ? <span className="hl-cap">새로 불러오는 중…</span> : null}
      </div>
      <QueryBoundary query={inv} loadingLabel="재고를 불러오는 중…">
        {(data) => {
          const rows = data.products;
          const byUnit = (type: ProductType) => rows.filter((r) => r.itemType === type);
          return (
            <>
              <div className="hl-statbar" style={{ flex: 'none' }}>
                {(['SLAB', 'COIL'] as const).filter((t) => !itemType || itemType === t).map((t) => {
                  const rs = byUnit(t);
                  const unit = ITEM_QTY_UNIT[t];
                  return (
                    <div key={t} className="hl-kpi" style={{ padding: '10px 16px', gap: 2 }}>
                      <span className="hl-kpi__label">{ITEM_TYPE_LABEL[t]} · 규격 {rs.length}개</span>
                      <span style={{ fontSize: 20, lineHeight: '26px', fontWeight: 600 }} className="tnum">가용 {sumOf(rs, (r) => r.availableQty).toLocaleString('en-US')}<small style={{ fontSize: 13, color: '#5E6977', marginLeft: 2 }}>{unit}</small></span>
                      <span className="hl-kpi__sub">합격 재고 {sumOf(rs, (r) => r.onHandQty).toLocaleString('en-US')}{unit} − 예약 {sumOf(rs, (r) => r.reservedQty).toLocaleString('en-US')}{unit}</span>
                    </div>
                  );
                })}
              </div>
              <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
                <table className="hl-table">
                  <thead>
                    <tr>
                      <th>규격</th>
                      <th>유형</th>
                      <th>강종</th>
                      <th>치수 (두께 × 폭 × 길이 mm)</th>
                      <th className="num" title="1매 이론중량">1매 중량</th>
                      <th className="num" title="합격·미소진 수량 (여재 포함, 열연 투입용 귀속 제외)">합격 재고</th>
                      <th className="num" title="수주에 잡힌 예약 (ACTIVE)">예약</th>
                      <th className="num" title="합격 재고 − 예약">가용</th>
                      <th className="num" title="가용 수량 × 1매 이론중량">가용 톤</th>
                      <th className="num" title="자기 검사 또는 상위 히트 성분 검사 전">검사 대기</th>
                      <th className="num" title="자기 검사 불합격 또는 상위 히트 불합격">불합격</th>
                      <th className="num" title="코일 수주에 귀속된 합격 슬래브 (재고 풀 밖)">열연 투입용 귀속</th>
                      <th>야드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => <ProductRow key={r.productSpecId} r={r} />)}
                    {!rows.length ? <tr><td colSpan={13} style={{ borderBottom: 0 }}><EmptyNote>조건에 맞는 제품 규격이 없어요</EmptyNote></td></tr> : null}
                  </tbody>
                </table>
                <div className="hl-card__foot">
                  <span className="hl-cap inv-page__cap">
                    <Icon name="info" size="sm" />
                    <span>
                      가용 = 합격 재고 − 예약 (새 수주가 예약할 수 있는 수량) · 톤은 수량 × 1매 이론중량 계산값이에요 · 합격 재고에는 여재가 들어 있고, 열연 투입용으로 귀속된 슬래브·검사 대기·불합격은 들어 있지 않아요 · 단위: 슬래브 매, 코일 개
                    </span>
                  </span>
                </div>
              </section>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}

function ProductRow({ r }: { r: ProductInventoryView }) {
  const u = r.qtyUnit;
  const empty = !r.onHandQty && !r.pendingInspectionQty && !r.failedQty && !r.earmarkedQty;
  return (
    <tr className={empty ? 'inv-page__zero' : undefined}>
      <td className="mono">{r.specCode}</td>
      <td><Icon name={r.itemType === 'COIL' ? 'coil' : 'slab'} size="sm" /> {ITEM_TYPE_LABEL[r.itemType]}</td>
      <td className="mono">{r.steelGradeCode}</td>
      <td className="tnum">{fmtDims(r.thicknessMm, r.widthMm, r.lengthMm)}</td>
      <td className="num">{fmtTon(r.theoreticalWeightTon)}</td>
      <td className="num" title={fmtTon(r.onHandTon)}>{q(r.onHandQty, u)}</td>
      <td className="num" title={fmtTon(r.reservedTon)}>{q(r.reservedQty, u)}</td>
      <td className="num">{q(r.availableQty, u, 'hl-ok-text')}</td>
      <td className="num">{fmtTon(r.availableTon)}</td>
      <td className="num">{q(r.pendingInspectionQty, u, 'hl-wait-text')}</td>
      <td className="num">{q(r.failedQty, u, 'hl-danger-text')}</td>
      <td className="num">{r.itemType === 'SLAB' ? q(r.earmarkedQty, u) : <span className="hl-muted">—</span>}</td>
      <td>{r.yardName ?? '—'}</td>
    </tr>
  );
}

function RawTab() {
  const inv = useInventories({ itemType: 'RAW_MATERIAL' });
  return (
    <QueryBoundary query={inv} loadingLabel="원료 재고를 불러오는 중…">
      {(data) => (
        <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
          <table className="hl-table">
            <thead>
              <tr>
                <th>원료</th>
                <th>코드</th>
                <th>종류</th>
                <th className="num" title="원료 LOT 잔량 합계">잔량 (t)</th>
                <th className="num" title="확정 발주의 (발주량 − 입고 누계) 합계">입고예정 (t)</th>
                <th>야드</th>
              </tr>
            </thead>
            <tbody>
              {data.rawMaterials.map((r) => (
                <tr key={r.rawMaterialId}>
                  <td><b>{r.itemName}</b></td>
                  <td className="mono">{r.materialCode} <span className="hl-muted">· {r.itemCode}</span></td>
                  <td>{RAW_MATERIAL_TYPE_LABEL[r.rawMaterialType as RawMaterialType] ?? r.rawMaterialType}</td>
                  <td className="num"><b>{fmtTon(r.onHandTon)}</b></td>
                  <td className="num">{Number(r.scheduledReceiptTon) ? fmtTon(r.scheduledReceiptTon) : <span className="hl-muted">{fmtTon(r.scheduledReceiptTon)}</span>}</td>
                  <td>{r.yardName ?? '—'}</td>
                </tr>
              ))}
              {!data.rawMaterials.length ? <tr><td colSpan={6} style={{ borderBottom: 0 }}><EmptyNote>등록된 원료가 없어요</EmptyNote></td></tr> : null}
            </tbody>
          </table>
          <div className="hl-card__foot">
            <span className="hl-cap inv-page__cap">
              <Icon name="info" size="sm" />
              <span>원료는 톤(소수)으로 관리해요 · 잔량 = 원료 LOT 잔량 합계 · 입고예정 = 확정된 발주 가운데 아직 입고되지 않은 양</span>
            </span>
          </div>
        </section>
      )}
    </QueryBoundary>
  );
}

function SurplusTab({ steelGrade, gradeSelect }: { steelGrade: string; gradeSelect: ReactNode }) {
  const sur = useSurplus({ steelGrade: steelGrade || undefined });
  return (
    <>
      <div className="inv-page__filters">
        {gradeSelect}
        {sur.isFetching && sur.data ? <span className="hl-cap">새로 불러오는 중…</span> : null}
      </div>
      <QueryBoundary query={sur} loadingLabel="여재를 불러오는 중…">
        {(data) => (
          <>
            <div className="hl-banner hl-banner--run" style={{ flex: 'none', padding: '8px 12px' }}>
              <Icon name="info" />
              <span>여재는 수주에 묶이지 않고 배정도 없는 합격 슬래브예요. <b>여재는 가용재고에 포함돼요</b> — 새 수주가 먼저 예약하고, 코일 수주의 열연 투입에도 쓸 수 있어요.</span>
            </div>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <header className="hl-card__head"><h3>규격별 여재</h3><span className="hl-card__meta">{data.specs.length}개 규격 · {sumOf(data.specs, (s) => s.surplusQty)}매</span></header>
              <table className="hl-table hl-table--compact">
                <thead><tr><th>규격</th><th>강종</th><th className="num">여재</th><th className="num">여재 톤 (계산값)</th><th className="num" title="여재 가운데 이미 수주에 예약돼 있다고 보는 매수 (= 여재 − 가용, 0 밑이면 0)">여재 중 예약</th><th className="num" title="여재 가운데 새 수주가 예약할 수 있는 매수 (= 여재와 규격 가용재고 중 작은 값)">여재 중 가용</th></tr></thead>
                <tbody>
                  {data.specs.map((s) => {
                    // 예약은 규격 풀 단위라 LOT을 못 집는다 → 풀의 가용으로 여재를 나눠 본다. 예약 + 가용 = 여재
                    const avail = Math.min(s.surplusQty, s.availableQty);
                    const reserved = Math.max(0, s.surplusQty - s.availableQty);
                    return (
                      <tr key={s.productSpecId}>
                        <td className="mono">{s.specCode}</td>
                        <td className="mono">{s.steelGradeCode}</td>
                        <td className="num">{q(s.surplusQty, '매')}</td>
                        <td className="num">{fmtTon(s.surplusTon)}</td>
                        <td className="num">{q(reserved, '매')}</td>
                        <td className="num">{q(avail, '매', 'hl-ok-text')}</td>
                      </tr>
                    );
                  })}
                  {!data.specs.length ? <tr><td colSpan={6} style={{ borderBottom: 0 }}><EmptyNote>여재가 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
              <div className="hl-card__foot">
                <span className="hl-cap inv-page__cap">
                  <Icon name="info" size="sm" />
                  <span>예약은 LOT을 정하지 않고 같은 규격 재고 전체에 걸려 있어요. 그래서 여재 중 가용 = 여재와 규격 가용재고 중 작은 값, 여재 중 예약 = 나머지예요 (둘을 더하면 여재예요). 규격 전체 예약·가용은 제품 탭에서 봐요.</span>
                </span>
              </div>
            </section>
            <section className="hl-card" style={{ flex: 'none', minWidth: 0, overflowX: 'auto' }}>
              <header className="hl-card__head"><h3>여재 슬래브</h3><span className="hl-card__meta">{data.lots.length}매 · 생산완료일 오래된 순 (선입선출 순)</span></header>
              <table className="hl-table hl-table--compact">
                <thead><tr><th>LOT</th><th>규격</th><th>강종</th><th>히트</th><th className="num">생산완료</th><th className="num">보유 기간</th><th className="num">1매 중량</th><th>야드</th><th>생산계획</th></tr></thead>
                <tbody>
                  {data.lots.map((l) => (
                    <tr key={l.lotId}>
                      <td><Link className="hl-link-id" to={lotHref(l.lotNo)}>{l.lotNo}</Link></td>
                      <td className="mono">{l.specCode}</td>
                      <td className="mono">{l.steelGradeCode}</td>
                      <td>{l.heatNo ? <Link className="mono" to={lotHref(l.heatNo)}>{l.heatNo}</Link> : '—'}</td>
                      <td className="num hl-cap">{fmtMDHM(l.producedAt)}</td>
                      <td className="num"><span className="tnum">{l.ageDays}일</span></td>
                      <td className="num">{fmtTon(l.theoreticalWeightTon)}</td>
                      <td>{l.yardName ?? '—'}</td>
                      <td>{l.productionPlanId ? <Link to={planHref(l.productionPlanId)}>계획 보기</Link> : <span className="hl-muted">—</span>}</td>
                    </tr>
                  ))}
                  {!data.lots.length ? <tr><td colSpan={9} style={{ borderBottom: 0 }}><EmptyNote>여재 슬래브가 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </section>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
