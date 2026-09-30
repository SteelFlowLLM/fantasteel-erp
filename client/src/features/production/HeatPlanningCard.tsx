// 히트 편성 (REQ-PRD-002, BP-PRD-01): 미리보기(heat-preview)의 계산을 서버가 준 숫자 그대로 보여 주고 확정한다.
import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { productionApi, type HeatPreview, type PlanDetail } from '@/api/production';
import { Badge, EmptyNote, Icon, Spinner } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtMD, fmtTon } from '@/lib/format';
import { canUse, useMe } from '@/stores/auth';
import { PLAN_TOPICS } from './productionHooks';
import { LockHint, LotJudgeBadge, LotLink, ServerErrorBanner, fmtRate, qtyUnit } from './prodUi';

const SURPLUS_ROWS = 12;

function FlowBox({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="hl-flowbox" style={{ flex: '1 1 110px', minWidth: 0 }}>
      <span className="hl-muted">{label}</span>
      <b className="tnum">{value}</b>
      {sub ? <span className="hl-cap">{sub}</span> : null}
    </div>
  );
}
const Arrow = () => <span className="hl-arrow"><Icon name="arrow-right" size="sm" /></span>;

function calcRows(plan: PlanDetail, p: HeatPreview): { label: string; value: string; formula: string }[] {
  const unit = qtyUnit(p.itemType);
  const slabWeight = plan.slabSpec ? fmtTon(plan.slabSpec.theoreticalWeightTon) : '-';
  return [
    { label: '새로 생산할 매수', value: `${p.targetQty}${unit}`, formula: `부족 매수 ${p.shortageQty}${unit} − 여재 사용 ${p.surplusUseQty}매` },
    { label: '목표중량', value: fmtTon(p.targetTon), formula: `매수 ${p.targetQty} × 제품 1매 이론중량 ${fmtTon(plan.productSpec.theoreticalWeightTon)}` },
    { label: '누적 계획수율', value: fmtRate(p.cumulativeYieldRate), formula: `연주 ${fmtRate(p.castingYieldRate)} × 열연 ${fmtRate(p.hotRollingYieldRate)} (열연 수율은 규격 매핑에서 계산한 값)` },
    { label: '필요 투입량', value: fmtTon(p.requiredInputTon), formula: `목표중량 ${fmtTon(p.targetTon)} ÷ 누적 계획수율 ${p.cumulativeYieldRate}` },
    { label: '히트 수', value: `${p.heatCount}개`, formula: `ceil(필요 투입량 ${fmtTon(p.requiredInputTon)} ÷ 히트 용량 ${fmtTon(p.heatCapacityTon)})` },
    { label: '히트 톤', value: fmtTon(p.heatTon), formula: `히트 수 ${p.heatCount} × 히트 용량 ${fmtTon(p.heatCapacityTon)}` },
    { label: '필요 용선', value: fmtTon(p.hotMetalTon), formula: `히트 톤 ${fmtTon(p.heatTon)} ÷ 제강 수율 ${p.steelmakingYieldRate}` },
    { label: '히트당 슬래브 매수', value: `${p.slabQtyPerHeat}매`, formula: `floor(히트 용량 ${fmtTon(p.heatCapacityTon)} × 연주 수율 ${p.castingYieldRate} ÷ 슬래브 1매 이론중량 ${slabWeight})` },
    { label: '계획 슬래브 매수', value: `${p.plannedSlabQty}매`, formula: `히트 수 ${p.heatCount} × 히트당 ${p.slabQtyPerHeat}매` },
    { label: '예상 여재', value: `${p.expectedSurplusQty}매`, formula: `max(0, 계획 슬래브 ${p.plannedSlabQty}매 − 새로 생산할 ${p.targetQty}매)` },
  ];
}

export function HeatPlanningCard({ plan, onCancel }: { plan: PlanDetail; onCancel: () => void }) {
  const me = useMe();
  const canPlan = canUse(me, 'PLAN_CONFIRM');
  /** null = 아직 미리보기를 누르지 않음 */
  const [previewQty, setPreviewQty] = useState<number | null>(null);
  const [qtyText, setQtyText] = useState('0');

  const preview = useQuery({
    queryKey: ['production-plans', 'heat-preview', plan.id, previewQty],
    queryFn: () => productionApi.heatPreview(plan.id, previewQty ?? 0),
    enabled: previewQty !== null,
    placeholderData: keepPreviousData,
  });
  const confirm = useAction(productionApi.confirm, { success: '히트 편성을 확정했어요 · 공정 실적 행이 만들어졌어요', invalidate: PLAN_TOPICS });

  const p = preview.data;
  const stale = !!p && (preview.isPlaceholderData || p.surplusUseQty !== previewQty);
  const maxUse = p?.surplus.maxUseQty ?? 0;
  const qtyNum = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : NaN;
  const qtyError = Number.isNaN(qtyNum) ? '0 이상의 정수로 입력해 주세요' : qtyNum > maxUse ? `최대 ${maxUse}매까지 쓸 수 있어요` : null;

  const changeQty = (text: string) => {
    setQtyText(text);
    const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!Number.isNaN(n) && n <= maxUse) setPreviewQty(n);
  };

  return (
    <section className="hl-card">
      <div className="hl-card__head">
        <h2>히트 편성</h2>
        <span className="hl-card__meta">부족 {plan.shortageQty}{qtyUnit(plan.itemType)} · {fmtTon(plan.shortageTon)} (계산값)</span>
        <div className="hl-card__actions">
          {preview.isFetching ? <Spinner label="계산 중…" /> : null}
          <button type="button" className="hl-btn hl-btn--sm" disabled={preview.isFetching} onClick={() => (previewQty === null ? setPreviewQty(0) : void preview.refetch())}>
            <Icon name={p ? 'refresh' : 'calc'} />
            {p ? '다시 계산' : '히트 편성 미리보기'}
          </button>
        </div>
      </div>

      {!p ? (
        <div className="hl-card__body">
          {preview.error ? <ServerErrorBanner error={preview.error} purchaseLinks={false} /> : null}
          {plan.slabSpec === null ? (
            <div className="hl-banner hl-banner--wait"><Icon name="alert" /><span>이 규격에 대응하는 슬래브 규격(규격 매핑)이 없어요. 기준정보에서 매핑을 먼저 등록해 주세요.</span></div>
          ) : null}
          <EmptyNote>
            "히트 편성 미리보기"를 누르면 목표중량 · 필요 투입량 · 히트 수 · 원료 소요를 계산해서 보여 줘요. 미리보기는 아무것도 저장하지 않아요.
          </EmptyNote>
        </div>
      ) : (
        <>
          <div className="hl-card__body" style={{ gap: 12, opacity: stale ? 0.6 : 1 }}>
            {preview.error ? <ServerErrorBanner error={preview.error} purchaseLinks={false} /> : null}
            <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'stretch' }}>
              <FlowBox label="목표중량" value={fmtTon(p.targetTon)} sub={`${p.targetQty}${qtyUnit(p.itemType)}`} />
              <Arrow />
              <FlowBox label="필요 투입량" value={fmtTon(p.requiredInputTon)} sub={`÷ 수율 ${fmtRate(p.cumulativeYieldRate)}`} />
              <Arrow />
              <FlowBox label="히트 수" value={`${p.heatCount}개`} sub={`히트 용량 ${fmtTon(p.heatCapacityTon)}`} />
              <Arrow />
              <FlowBox label="히트 톤" value={fmtTon(p.heatTon)} sub={`슬래브 ${p.plannedSlabQty}매`} />
              <Arrow />
              <FlowBox label="필요 용선" value={fmtTon(p.hotMetalTon)} sub={`÷ 제강 ${fmtRate(p.steelmakingYieldRate)}`} />
            </div>
            {p.plannedSlabQty < p.targetQty ? (
              <div className="hl-banner hl-banner--wait">
                <Icon name="alert" />
                <span>계획 슬래브 <b>{p.plannedSlabQty}매</b>가 새로 생산할 <b>{p.targetQty}매</b>보다 적어요. 확정해도 목표를 다 채우지 못할 수 있어요 · 부족분은 재생산 계획으로 채워요.</span>
              </div>
            ) : null}
            {p.heatCount === 0 ? (
              <div className="hl-banner hl-banner--run"><Icon name="info" /><span>여재 슬래브만으로 채워서 새 히트를 만들지 않아요. 확정하면 열연 실적 행만 생겨요.</span></div>
            ) : null}
          </div>

          <div style={{ overflowX: 'auto', opacity: stale ? 0.6 : 1 }}>
            <table className="hl-table">
              <thead>
                <tr><th>항목</th><th className="num">값</th><th>계산</th></tr>
              </thead>
              <tbody>
                {calcRows(plan, p).map((r) => (
                  <tr key={r.label}>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.label}</td>
                    <td className="num"><b className="tnum">{r.value}</b></td>
                    <td className="hl-cap">{r.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 16px 12px' }}>
            <span className="hl-cap">
              목표중량(t) = 부족 매수 × 제품 1매 이론중량 · 필요 투입량(t) = 목표중량 ÷ 누적 계획수율 · 히트 수 = ceil(필요 투입량 ÷ 히트 용량) · 히트 톤(t) = 히트 수 × 히트 용량. 히트 용량은 용강(히트) 산출 기준이고, 제강 수율은 용선 → 용강 환산에만 써요.
            </span>
          </div>

          {p.itemType === 'COIL' ? (
            <div className="hl-col" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
              <div className="hl-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="hl-field" style={{ width: 150 }}>
                  <label htmlFor={`pp-surplus-${plan.id}`}>여재 사용 매수</label>
                  <label className="hl-inputwrap">
                    <input
                      id={`pp-surplus-${plan.id}`}
                      className={`hl-input num tnum${qtyError ? ' is-error' : ''}`}
                      style={{ paddingRight: 28 }}
                      type="text"
                      inputMode="numeric"
                      value={qtyText}
                      disabled={maxUse === 0}
                      onChange={(e) => changeQty(e.target.value)}
                    />
                    <span className="hl-suffix">매</span>
                  </label>
                </div>
                <div className="hl-col" style={{ gap: 2, flex: 1, minWidth: 200 }}>
                  <span style={{ fontSize: '12.5px' }}>
                    지금 열연에 쓸 수 있는 여재 슬래브 <b>{p.surplus.availableQty}매</b> · 이 계획에 쓸 수 있는 최대 <b>{maxUse}매</b>
                  </span>
                  {qtyError && maxUse > 0 ? <span className="hl-field__hint hl-danger-text">{qtyError}</span> : (
                    <span className="hl-cap">여재를 쓰는 만큼은 새로 만들지 않아요 (히트 수 계산에서 빠져요). 확정하면 아래 목록의 앞에서부터 그 매수만큼 이 수주 품목의 열연 투입용으로 귀속돼요.</span>
                  )}
                </div>
              </div>
              {p.surplus.lots.length ? (
                <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <table className="hl-table hl-table--compact">
                    <thead>
                      <tr><th>FIFO</th><th>여재 슬래브 LOT</th><th>히트</th><th>생산완료일</th><th>검사</th><th>편성 시</th></tr>
                    </thead>
                    <tbody>
                      {p.surplus.lots.slice(0, SURPLUS_ROWS).map((lot, i) => (
                        <tr key={lot.id} className={i < p.surplusUseQty ? 'is-selected' : undefined}>
                          <td className="tnum">{i + 1}</td>
                          <td><LotLink lotNo={lot.lotNo} /></td>
                          <td className="mono">{lot.heatLotNo ?? '-'}</td>
                          <td className="tnum">{fmtMD(lot.producedAt)}</td>
                          <td><LotJudgeBadge isPassed={lot.isPassed} heatIsPassed={lot.heatIsPassed} lotType={lot.lotType} /></td>
                          <td>{i < p.surplusUseQty ? <Badge tone="run">귀속 예정</Badge> : <span className="hl-muted">여재로 남음</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.surplus.lots.length > SURPLUS_ROWS ? <EmptyNote style={{ padding: '6px 16px' }}>외 {p.surplus.lots.length - SURPLUS_ROWS}매</EmptyNote> : null}
                </div>
              ) : (
                <span className="hl-cap">지금 쓸 수 있는 여재 슬래브가 없어요.</span>
              )}
            </div>
          ) : null}

          <div className="hl-col" style={{ gap: 8, padding: '12px 0 0', borderTop: '1px solid var(--line)', opacity: stale ? 0.6 : 1 }}>
            <div className="hl-row" style={{ padding: '0 16px' }}>
              <b className="hl-label">원료 총소요와 현재 재고</b>
              {p.hasRawShortage ? <Badge tone="danger">원료 부족</Badge> : <Badge tone="ok">재고 충분</Badge>}
              <Link to="/mrp" style={{ marginLeft: 'auto', fontSize: '12px' }}>MRP에서 순소요 보기<Icon name="arrow-right" size="sm" /></Link>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="hl-table">
                <thead>
                  <tr><th>원료</th><th className="num">총소요</th><th className="num">현재 재고</th><th className="num">부족</th></tr>
                </thead>
                <tbody>
                  {p.rawMaterials.map((r) => (
                    <tr key={r.rawMaterialId} className={r.isShort ? 'is-risk' : undefined}>
                      <td>{r.rawMaterialName} <span className="mono hl-muted">{r.materialCode}</span></td>
                      <td className="num tnum">{fmtTon(r.requiredTon)}</td>
                      <td className="num tnum">{fmtTon(r.remainingTon)}</td>
                      <td className="num tnum">{r.isShort ? <b className="hl-danger-text">{fmtTon(r.shortageTon)}</b> : <span className="hl-muted">-</span>}</td>
                    </tr>
                  ))}
                  {!p.rawMaterials.length ? <tr><td colSpan={4}><EmptyNote style={{ padding: 6 }}>이 편성에 필요한 원료가 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0 16px 12px' }}>
              {p.hasRawShortage ? (
                <div className="hl-banner hl-banner--danger">
                  <Icon name="alert" />
                  <div>
                    <b>원료가 모자라요.</b> 편성은 확정할 수 있지만, 원료를 확보하기 전에는 제선·제강 실적을 등록할 수 없어요.
                    <div className="hl-row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <Link className="hl-btn hl-btn--sm" to="/mrp"><Icon name="calc" />MRP에서 소요량 보기</Link>
                      <Link className="hl-btn hl-btn--sm" to="/purchase-requisitions"><Icon name="cart" />구매요청으로 가기</Link>
                    </div>
                  </div>
                </div>
              ) : (
                <span className="hl-cap">철광석·석탄·석회석 = 필요 용선 × 용선 1t당 원단위, 합금철 = 히트 톤 × 강종별 원단위(kg/t) ÷ 1,000. 부족은 현재 재고만 뺀 값이고 입고예정은 MRP 화면에서 확인해요.</span>
              )}
            </div>
          </div>
        </>
      )}

      <div className="hl-card__foot" style={{ marginTop: 'auto' }}>
        <span className="hl-cap">
          {p ? '확정하면 제선 1행 · 히트마다 제강·연주 1행' + (plan.itemType === 'COIL' ? ' · 열연 1행' : '') + '의 실적 행이 대기 상태로 만들어져요.' : '편성을 확정하기 전까지는 계획을 취소할 수 있어요.'}
        </span>
        {!canPlan ? <LockHint>생산계획 권한이 필요해요</LockHint> : null}
        <button type="button" className="hl-btn hl-btn--ghost" style={{ marginLeft: 'auto' }} disabled={!canPlan} title={canPlan ? undefined : '권한이 필요해요'} onClick={onCancel}>
          <Icon name="x" />계획 취소
        </button>
        <button
          type="button"
          className="hl-btn hl-btn--primary"
          disabled={!canPlan || !p || stale || preview.isFetching || confirm.isPending || (p.itemType === 'COIL' && !!qtyError)}
          title={!canPlan ? '권한이 필요해요' : !p ? '먼저 미리보기로 계산을 확인해 주세요' : undefined}
          onClick={() => p && confirm.mutate({ id: plan.id, surplusUseQty: p.surplusUseQty })}
        >
          <Icon name="check" />편성 확정
        </button>
      </div>
    </section>
  );
}
