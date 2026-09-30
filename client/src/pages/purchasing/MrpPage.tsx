// MRP 결과 (REQ-PRD-005). v1 B안 13번: 왼쪽 실행 이력 | 오른쪽 실행 결과.
// MRP는 구매요청을 만들지 않는다 (P1). 순소요를 보고 담당자가 "구매요청 만들기"로 등록한다. 자동 초안(조달 자동화)은 P2.
import { Fragment, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PRODUCTION_PLAN_STATUS_LABEL, type ProductionPlanStatus } from '@fantasteel/shared';
import { mrpApi, type MrpRequirementView, type MrpRunDetail } from '@/api/mrp';
import { Badge, EmptyNote, Icon, QueryBoundary, SoonButton, StateView } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtHM, fmtInt, fmtMDHM, fmtMDdow, fmtNum, fmtTon, relTime, todayStr } from '@/lib/format';
import { canUse, canView, useMe } from '@/stores/auth';
import { PrStatusBadge, d10, isPositive, md, tonInput } from '@/features/purchasing/common';
import { RequisitionFormModal, type RequisitionFormInitial } from '@/features/purchasing/RequisitionFormModal';

export function MrpPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const canRun = canUse(me, 'PURCHASE_REQUISITION_CREATE', 'PLAN_CONFIRM');
  const runId = Number(params.get('run')) || null;

  const runs = useQuery({ queryKey: ['mrp-runs', 'list'], queryFn: mrpApi.list });
  const latest = useQuery({ queryKey: ['mrp-runs', 'latest'], queryFn: mrpApi.latest, enabled: !runId });
  const byId = useQuery({ queryKey: ['mrp-runs', 'detail', runId], queryFn: () => mrpApi.get(runId!), enabled: !!runId });
  const current = runId ? byId : latest;
  const latestId = runs.data?.[0]?.id ?? latest.data?.id ?? null;
  const selectRun = (id: number | null) => setParams((p) => { const n = new URLSearchParams(p); if (id === null) n.delete('run'); else n.set('run', String(id)); return n; }, { replace: true });

  const run = useAction(() => mrpApi.run(), {
    success: (r) => `${r.mrpRunNo} 계산을 끝냈어요`,
    invalidate: ['mrp-runs'],
    onSuccess: () => selectRun(null),
  });
  const runButton = (
    <button type="button" className="hl-btn hl-btn--primary" onClick={() => run.mutate(undefined)} disabled={!canRun || run.isPending} title={canRun ? '지금의 생산계획·원료 잔량·입고예정으로 다시 계산해요' : '권한이 필요해요'}>
      <Icon name={canRun ? 'refresh' : 'lock'} />
      {run.isPending ? '계산 중…' : 'MRP 실행'}
    </button>
  );

  return (
    <>
      <section className="hl-master" aria-label="MRP 실행 이력">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>MRP 실행 이력</b>
            <span className="hl-tag">{runs.data?.length ?? 0}</span>
          </div>
          <span className="hl-cap">최근 50건까지 보여요. 실행을 고르면 그때의 계산 결과를 볼 수 있어요.</span>
        </div>
        <div className="hl-master__list">
          {runs.isLoading ? <StateView kind="loading" /> : null}
          {runs.error && !runs.data ? <div className="hl-cap hl-danger-text" style={{ padding: 16 }}>실행 이력을 불러오지 못했어요</div> : null}
          {(runs.data ?? []).map((r) => {
            const isLatest = r.id === latestId;
            const on = runId ? r.id === runId : isLatest;
            return (
              <div key={r.id} className={`hl-mitem${on ? ' is-active' : ''}`} role="button" tabIndex={0} onClick={() => selectRun(isLatest ? null : r.id)} onKeyDown={(e) => { if (e.key === 'Enter') selectRun(isLatest ? null : r.id); }}>
                <div className="hl-row">
                  <b className="tnum" style={{ fontSize: 13.5 }}>{fmtMDdow(r.createdAt)} {fmtHM(r.createdAt)}</b>
                  <span style={{ marginLeft: 'auto' }}>{isLatest ? <Badge tone="run">최신</Badge> : <Badge>지난 실행</Badge>}</span>
                </div>
                <div className="hl-row" style={{ fontSize: 12 }}>
                  <span className="mono" style={{ fontSize: 11.5 }}>{r.mrpRunNo}</span>
                  <span className="hl-muted">·</span>
                  <span>{r.runEmployee?.employeeName ?? '-'}</span>
                </div>
                <div className="hl-row" style={{ fontSize: 12 }}>
                  <span>히트 {fmtInt(r.heatCount)}</span>
                  <span className="hl-muted">·</span>
                  <span className="tnum">{fmtTon(r.heatTon)}</span>
                  <span className="hl-muted">·</span>
                  <span className="tnum">용선 {fmtTon(r.hotMetalTon)}</span>
                </div>
                <div className="hl-row" style={{ fontSize: 12 }}>
                  {r.shortageCount > 0 ? (
                    <>
                      <span className="hl-risk"><Icon name="alert" size="sm" />순소요 {r.shortageCount}종</span>
                      <span className="tnum">합계 {fmtTon(r.totalNetRequiredTon)}</span>
                    </>
                  ) : (
                    <span className="hl-ok-text">순소요 없음</span>
                  )}
                </div>
              </div>
            );
          })}
          {runs.data && !runs.data.length ? <EmptyNote>아직 실행 기록이 없어요 · MRP 실행으로 계산해 보세요</EmptyNote> : null}
        </div>
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b style={{ fontSize: 12.5 }}>계산 방법</b>
          <span className="hl-cap" style={{ lineHeight: '17px' }}>
            진행 중인 생산계획 전체의 남은 히트로 계산해요. 편성 전 계획은 예상 히트로 넣어요.<br />
            총소요 − 원료 LOT 잔량 − 입고예정 = 순소요<br />
            합금철 = 히트 톤 × kg/t ÷ 1,000
          </span>
          <span className="hl-cap">MRP는 구매요청을 만들지 않아요. 구매요청은 담당자가 등록하고 부서장이 승인해요.</span>
        </div>
      </section>
      <main className="hl-main" style={{ gap: 14 }}>
        <QueryBoundary query={current} loadingLabel="MRP 결과를 불러오는 중…">
          {(data) =>
            data ? (
              <RunView key={data.id} run={data} isLatest={data.id === latestId} runButton={runButton} onLatest={() => selectRun(null)} />
            ) : (
              <StateView
                kind="empty"
                title="아직 MRP를 실행한 적이 없어요"
                text="MRP 실행을 누르면 진행 중인 생산계획의 원료 소요를 계산해요"
                actions={runButton}
              />
            )
          }
        </QueryBoundary>
      </main>
    </>
  );
}

function RunView({ run, isLatest, runButton, onLatest }: { run: MrpRunDetail; isLatest: boolean; runButton: ReactNode; onLatest: () => void }) {
  const me = useMe();
  const canCreate = canUse(me, 'PURCHASE_REQUISITION_CREATE');
  const canSeePr = canView(me, 'PURCHASE_REQUISITION_CREATE', 'PO_CONFIRM');
  const canSeePo = canView(me, 'PO_CONFIRM', 'RECEIPT_CONFIRM', 'PURCHASE_REQUISITION_CREATE');
  const [onlyShort, setOnlyShort] = useState(false);
  const [selMat, setSelMat] = useState<number | null>(null);
  const [form, setForm] = useState<RequisitionFormInitial | null>(null);
  const today = todayStr();

  const short = run.requirements.filter((r) => isPositive(r.netRequiredTon));
  const uncovered = short.filter((r) => !r.coverage.isCovered);
  // 계획(PLANNED)은 히트 편성 전이라 서버가 히트 수를 예상으로 계산한다
  const isEstimated = (status: string) => status === 'PLANNED';
  const estimatedCount = run.plans.filter((p) => isEstimated(p.productionPlanStatus)).length;
  const shown = onlyShort ? short : run.requirements;
  const sel = run.requirements.find((r) => r.id === selMat) ?? short[0] ?? run.requirements[0];

  const openForm = (r: MrpRequirementView) => {
    const need = d10(r.requiredDate);
    setForm({
      items: [{ rawMaterialId: r.rawMaterial.id, requiredTon: tonInput(r.coverage.uncoveredTon) }],
      // 필요일이 이미 지났으면 비워 두고 직접 고르게 한다 (희망 입고일은 오늘 이후만 받는다)
      desiredReceiptDate: need && need >= today ? need : '',
      requestReason: `${run.mrpRunNo} ${r.rawMaterial.itemName} 순소요 ${fmtTon(r.netRequiredTon)}${need ? ` · 필요일 ${need}` : ''}`,
    });
  };

  return (
    <>
      <div className="hl-row" style={{ gap: 10, flex: 'none', flexWrap: 'wrap' }}>
        <div className="hl-col" style={{ gap: 2 }}>
          <div className="hl-crumb">
            <span>MRP 결과</span>
            <Icon name="chevron-right" size="sm" />
            {run.mrpRunNo}
          </div>
          <div className="hl-row" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 18, lineHeight: '26px' }}>MRP 실행 {fmtMDHM(run.createdAt)}</b>
            {isLatest ? <Badge tone="run">최신</Badge> : <Badge>지난 실행</Badge>}
            {short.length ? <Badge tone="danger">순소요 {short.length}종</Badge> : <Badge tone="ok">순소요 없음</Badge>}
          </div>
        </div>
        <div className="hl-row" style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
          {!isLatest ? <button type="button" className="hl-btn hl-btn--ghost" onClick={onLatest}>최신 결과 보기</button> : null}
          <SoonButton grade="P2">구매요청 자동 초안</SoonButton>
          {canSeePr ? <Link className="hl-btn" to="/purchase-requisitions"><Icon name="cart" />구매요청 목록</Link> : null}
          {runButton}
        </div>
      </div>
      <div className="hl-row" style={{ gap: 8, fontSize: 12.5, color: 'var(--ink-2)', flex: 'none', flexWrap: 'wrap' }}>
        <Icon name="calendar" size="sm" />
        <span>{fmtMDHM(run.createdAt)} ({relTime(run.createdAt)}) · 실행 {run.runEmployee ? `${run.runEmployee.employeeName} (${run.runEmployee.employeeNo})` : '-'}</span>
        <span className="hl-muted">·</span>
        <span className="hl-muted">잔량·입고예정은 실행 시점 값이에요. 진행 중인 구매요청·발주는 지금 기준으로 다시 확인해요</span>
      </div>

      <div className="hl-statbar" style={{ flex: 'none', alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">남은 히트</span>
          <span className="hl-figure"><b>{fmtInt(run.heatCount)}<small>히트</small></b></span>
          <span className="hl-kpi__sub">생산계획 {run.plans.length}건{estimatedCount ? ` · 편성 전 ${estimatedCount}건 예상 포함` : ''}</span>
        </div>
        <div className="hl-row" style={{ flex: 'none', padding: '0 2px', color: 'var(--ink-3)' }}><Icon name="chevron-right" /></div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">히트 톤</span>
          <span className="hl-figure"><b>{fmtNum(run.heatTon, 3)}<small>t</small></b></span>
          <span className="hl-kpi__sub">합금철 소요의 기준</span>
        </div>
        <div className="hl-row" style={{ flex: 'none', padding: '0 2px', color: 'var(--ink-3)' }}><Icon name="chevron-right" /></div>
        <div className="hl-kpi" style={{ padding: '12px 16px' }}>
          <span className="hl-kpi__label">만들어야 할 용선</span>
          <span className="hl-figure"><b>{fmtNum(run.hotMetalTon, 3)}<small>t</small></b></span>
          <span className="hl-kpi__sub">
            {run.requiredHotMetalTon !== null ? `필요 용선 ${fmtTon(run.requiredHotMetalTon)} (÷ 제강 수율)` : '필요 용선'}
            {run.hotMetalRemainingTon !== null ? ` − 용선 잔량 ${fmtTon(run.hotMetalRemainingTon)}` : ''}
          </span>
        </div>
        <div className="hl-row" style={{ flex: 'none', padding: '0 2px', color: 'var(--ink-3)' }}><Icon name="chevron-right" /></div>
        <div className="hl-kpi" style={{ padding: '12px 16px', flex: 1.3, background: short.length ? '#FFF7F6' : undefined }}>
          <span className="hl-kpi__label">원료·합금철 소요</span>
          <span className="hl-figure">
            <b>
              {run.requirements.length}<small>종</small>{' '}
              {short.length ? <span className="hl-danger-text" style={{ fontSize: 16 }}>순소요 {short.length}종</span> : <span className="hl-ok-text" style={{ fontSize: 16 }}>순소요 없음</span>}
            </b>
          </span>
          <span className="hl-kpi__sub">{short.length ? short.map((r) => `${r.rawMaterial.itemName} ${fmtTon(r.netRequiredTon)}`).join(' · ') : '모든 원료가 잔량·입고예정으로 충분해요'}</span>
        </div>
      </div>

      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h2>원료·합금철 소요량</h2>
          <span className="hl-tag">{shown.length}</span>
          <div className="hl-card__actions">
            <div className="hl-seg">
              <button type="button" className={onlyShort ? undefined : 'is-on'} onClick={() => setOnlyShort(false)}>전체</button>
              <button type="button" className={onlyShort ? 'is-on' : undefined} onClick={() => setOnlyShort(true)}>순소요만</button>
            </div>
          </div>
        </header>
        <div style={{ overflowX: 'auto' }}>
          <table className="hl-table hl-table--compact">
            <thead>
              <tr>
                <th>원료코드</th>
                <th>원료명</th>
                <th className="num">총소요</th>
                <th className="num">원료 LOT 잔량</th>
                <th className="num">입고예정</th>
                <th className="num">순소요</th>
                <th>필요일</th>
                <th>기여 계획</th>
                <th>진행 중인 요청·발주 · 조치</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isShort = isPositive(r.netRequiredTon);
                const c = r.coverage;
                return (
                  <tr key={r.id} className={`${isShort ? 'is-risk' : ''}${sel?.id === r.id ? ' is-selected' : ''}`} onClick={() => setSelMat(r.id)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={isShort ? { fontWeight: 600 } : undefined}>{r.rawMaterial.materialCode}</td>
                    <td style={isShort ? { fontWeight: 600 } : undefined}>{r.rawMaterial.itemName}</td>
                    <td className="num">{fmtTon(r.requiredTon)}</td>
                    <td className="num">{fmtTon(r.remainingTon)}</td>
                    <td className={isPositive(r.scheduledReceiptTon) ? 'num' : 'num hl-muted'}>{fmtTon(r.scheduledReceiptTon)}</td>
                    <td className="num">
                      {isShort ? <span className="hl-risk"><Icon name="alert" size="sm" />{fmtTon(r.netRequiredTon)}</span> : <span className="hl-muted">{fmtTon(r.netRequiredTon)}</span>}
                    </td>
                    <td className="tnum">{d10(r.requiredDate) || <span className="hl-muted">-</span>}</td>
                    <td className="hl-cap" title={r.contributions.map((x) => x.productionPlanNo).join(', ')}>
                      {r.contributions.length ? `${r.contributions[0].productionPlanNo}${r.contributions.length > 1 ? ` 외 ${r.contributions.length - 1}` : ''}` : '-'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                      <div className="hl-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {c.openRequisitions.map((q) => (
                          <Fragment key={q.purchaseRequisitionId}>
                            {canSeePr ? <Link className="hl-link-id" to={`/purchase-requisitions/${q.purchaseRequisitionId}`}>{q.purchaseRequisitionNo}</Link> : <span className="mono">{q.purchaseRequisitionNo}</span>}
                            <PrStatusBadge status={q.purchaseRequisitionStatus} />
                            <span className="hl-cap tnum">{fmtTon(q.unorderedTon)}</span>
                          </Fragment>
                        ))}
                        {c.openPurchaseOrders.map((po) => (
                          <Fragment key={po.purchaseOrderId}>
                            <span className="hl-cap">입고예정</span>
                            {canSeePo ? <Link className="hl-link-id" to={`/purchase-orders?po=${po.purchaseOrderId}`}>{po.purchaseOrderNo}</Link> : <span className="mono">{po.purchaseOrderNo}</span>}
                            <span className="hl-cap tnum">{fmtTon(po.outstandingTon)} · 납기 {md(po.dueDate)}</span>
                          </Fragment>
                        ))}
                        {isShort ? (
                          c.isCovered ? (
                            <Badge tone="ok" title={`구매요청 ${fmtTon(c.openRequisitionTon)} · 실행 뒤 발주 ${fmtTon(c.orderedAfterRunTon)}`}>요청·발주로 덮였어요</Badge>
                          ) : (
                            <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => openForm(r)} disabled={!canCreate} title={canCreate ? `${r.rawMaterial.itemName} ${fmtTon(c.uncoveredTon)} 구매요청을 채워서 열어요` : '권한이 필요해요'}>
                              <Icon name={canCreate ? 'plus' : 'lock'} />
                              구매요청 만들기
                            </button>
                          )
                        ) : !c.openRequisitions.length && !c.openPurchaseOrders.length ? (
                          <span className="hl-muted">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!shown.length ? (
                <tr><td colSpan={9}><EmptyNote>{onlyShort ? '이번 실행에서 순소요가 있는 원료가 없어요' : '계산된 원료가 없어요'}</EmptyNote></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="hl-card__foot" style={{ flexWrap: 'wrap' }}>
          <span className="hl-cap">
            총소요 − 원료 LOT 잔량 − 입고예정 = 순소요 (0보다 작으면 0) · 합금철 = 히트 톤 × kg/t ÷ 1,000 · 잔량·입고예정은 계획마다가 아니라 합계에서 한 번만 빼요
          </span>
          {uncovered.length ? <span className="hl-cap hl-danger-text" style={{ marginLeft: 'auto' }}>아직 요청하지 않은 순소요 {uncovered.length}종</span> : null}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, flex: 'none' }}>
        <section className="hl-card" style={{ minWidth: 0 }}>
          <header className="hl-card__head">
            <h3>근거 생산계획</h3>
            <span className="hl-card__meta">실행 시점에 남은 히트가 있던 계획 {run.plans.length}건</span>
            <div className="hl-card__actions">
              <Link className="hl-btn hl-btn--sm hl-btn--ghost" to="/production/plans">생산계획 <Icon name="chevron-right" /></Link>
            </div>
          </header>
          <div style={{ overflowX: 'auto' }}>
            <table className="hl-table hl-table--compact">
              <thead>
                <tr><th>계획번호</th><th>강종 · 규격</th><th>수주</th><th>납기</th><th className="num">남은 히트</th><th className="num">히트 톤</th><th className="num">필요 용선</th></tr>
              </thead>
              <tbody>
                {run.plans.map((p) => (
                  <tr key={p.productionPlanId}>
                    <td>
                      <Link className="hl-link-id" to={`/production/plans?plan=${p.productionPlanId}`}>{p.productionPlanNo}</Link>{' '}
                      <span className="hl-cap">{PRODUCTION_PLAN_STATUS_LABEL[p.productionPlanStatus as ProductionPlanStatus] ?? p.productionPlanStatus}</span>
                    </td>
                    <td><span className="mono">{p.steelGradeCode}</span> <span className="hl-cap">{p.specCode}</span></td>
                    <td>{p.salesOrderId && p.salesOrderNo ? <Link className="hl-link-id" to={`/sales-orders/${p.salesOrderId}`}>{p.salesOrderNo}</Link> : <span className="hl-muted">연결 없음</span>}</td>
                    <td className="tnum">{md(p.dueDate)}</td>
                    <td className="num">
                      {isEstimated(p.productionPlanStatus) ? <><span className="hl-cap" title="히트 편성 전이라 부족 수량으로 계산한 예상 히트예요">편성 전 · 예상</span>{' '}</> : null}
                      {fmtInt(p.heatCount)}
                    </td>
                    <td className="num">{fmtTon(p.heatTon)}</td>
                    <td className="num">{fmtTon(p.hotMetalTon)}</td>
                  </tr>
                ))}
                {!run.plans.length ? <tr><td colSpan={7}><EmptyNote>남은 히트가 있는 생산계획이 없었어요</EmptyNote></td></tr> : null}
              </tbody>
              {run.plans.length ? (
                <tfoot>
                  <tr><td colSpan={4}>합계</td><td className="num">{fmtInt(run.heatCount)}</td><td className="num">{fmtTon(run.heatTon)}</td><td className="num">{run.requiredHotMetalTon !== null ? fmtTon(run.requiredHotMetalTon) : '-'}</td></tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
        <section className="hl-card" style={{ minWidth: 0 }}>
          <header className="hl-card__head">
            <h3>{sel ? `${sel.rawMaterial.itemName} 계획별 소요` : '계획별 소요'}</h3>
            {sel ? <span className="hl-card__meta mono">{sel.rawMaterial.materialCode}</span> : null}
          </header>
          {sel ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="hl-table hl-table--compact">
                  <thead>
                    <tr><th>계획번호</th><th>수주</th><th>납기</th><th className="num">히트</th><th className="num">소요</th></tr>
                  </thead>
                  <tbody>
                    {sel.contributions.map((x) => (
                      <tr key={x.productionPlanId}>
                        <td><Link className="hl-link-id" to={`/production/plans?plan=${x.productionPlanId}`}>{x.productionPlanNo}</Link></td>
                        <td className="mono">{x.salesOrderNo ?? <span className="hl-muted">-</span>}</td>
                        <td className="tnum">{md(x.dueDate)}</td>
                        <td className="num">{fmtInt(x.heatCount)}</td>
                        <td className="num">{fmtTon(x.requiredTon)}</td>
                      </tr>
                    ))}
                    {!sel.contributions.length ? <tr><td colSpan={5}><EmptyNote>이 원료를 쓰는 계획이 없었어요</EmptyNote></td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="hl-card__body" style={{ padding: '10px 16px', gap: 6 }}>
                <span className="hl-cap">계획별 소요는 용선 재고를 빼기 전 그 계획의 몫이에요. 위 표에서 원료를 누르면 바뀌어요.</span>
                <dl className="hl-kv" style={{ rowGap: 5, fontSize: 12.5 }}>
                  <dt>총소요</dt><dd className="tnum">{fmtTon(sel.requiredTon)}</dd>
                  <dt>잔량 · 입고예정</dt><dd className="tnum">{fmtTon(sel.remainingTon)} · {fmtTon(sel.scheduledReceiptTon)}</dd>
                  <dt>순소요</dt><dd className={`tnum ${isPositive(sel.netRequiredTon) ? 'hl-danger-text' : 'hl-ok-text'}`}>{fmtTon(sel.netRequiredTon)}</dd>
                  <dt>진행 중 구매요청</dt><dd className="tnum">{fmtTon(sel.coverage.openRequisitionTon)}</dd>
                  <dt>실행 뒤 발주</dt><dd className="tnum">{fmtTon(sel.coverage.orderedAfterRunTon)}</dd>
                  <dt>새로 요청할 양</dt><dd className={`tnum ${sel.coverage.isCovered ? 'hl-ok-text' : 'hl-danger-text'}`}>{fmtTon(sel.coverage.uncoveredTon)}</dd>
                </dl>
              </div>
            </>
          ) : (
            <EmptyNote>계산된 원료가 없어요</EmptyNote>
          )}
        </section>
      </div>

      {form ? <RequisitionFormModal initial={form} sourceType="MRP" onClose={() => setForm(null)} /> : null}
    </>
  );
}
