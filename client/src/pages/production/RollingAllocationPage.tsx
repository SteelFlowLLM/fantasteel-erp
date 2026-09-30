// 열연 투입 배정 (REQ-INV-006, REQ-PRD-004, BP-INV-01). 디자인: v1 B안 20번(배정 대상 | FIFO 추천·확정).
// 데이터: docs/api/production.md (코일 계획) + docs/api/inventory.md (배정 추천·확정·해제).
import { useState } from 'react';
import { Link } from 'react-router';
import { ALLOCATION_STATUS_LABEL, calcWeightTon } from '@fantasteel/shared';
import { allocationApi, type AllocationRecommendationView } from '@/api/allocations';
import type { PlanDetail, PlanSummary } from '@/api/production';
import { Badge, EmptyNote, Icon, QueryBoundary, StateView } from '@/components/ui';
import { PLAN_TOPICS, usePlanDetail, usePlanParam, usePlans } from '@/features/production/productionHooks';
import { GROUP_STYLE, LockHint, LotLink, PlanListItem, PlanStatusBadge, ServerErrorBanner, Steps, specText, type StepState } from '@/features/production/prodUi';
import { useAction } from '@/hooks/useApi';
import { dLabel, fmtMD, fmtMDHM, fmtTon } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import { canUse, useMe } from '@/stores/auth';

type Chip = 'OPEN' | 'ALL';
const isOpen = (p: PlanSummary) => p.productionPlanStatus === 'CONFIRMED' || p.productionPlanStatus === 'IN_PROGRESS';

export function RollingAllocationPage() {
  const [planId, setPlanId] = usePlanParam();
  const [chip, setChip] = useState<Chip>('OPEN');
  const [q, setQ] = useState('');
  const list = usePlans({ itemType: 'COIL' });

  const needle = q.trim().toLowerCase();
  const match = (p: PlanSummary) => !needle || `${p.productionPlanNo} ${p.salesOrder?.salesOrderNo ?? ''} ${p.salesOrder?.customerName ?? ''}`.toLowerCase().includes(needle);
  const all = list.data ?? [];
  const open = all.filter(isOpen);
  const openShown = open.filter(match);
  const others = all.filter((p) => !isOpen(p) && match(p));
  const selectedId = planId ?? openShown[0]?.id ?? null;

  const item = (p: PlanSummary) => {
    const roll = p.progress.find((x) => x.processCode === 'HOT_ROLLING');
    return (
      <PlanListItem
        key={p.id}
        plan={p}
        active={p.id === selectedId}
        onPick={setPlanId}
        extra={roll ? <div className="hl-row hl-cap"><span>열연 실적 {roll.completedCount}/{roll.totalCount}</span></div> : null}
      />
    );
  };

  return (
    <>
      <section className="hl-master" aria-label="배정 대상 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: '14px' }}>배정 대상</b>
            <span className="hl-tag">{list.data ? open.length : '…'}</span>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="계획·수주번호·고객사 검색" aria-label="배정 대상 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hl-row" style={{ gap: '6px' }}>
            <button className={`hl-chip${chip === 'OPEN' ? ' is-on' : ''}`} type="button" aria-pressed={chip === 'OPEN'} onClick={() => setChip('OPEN')}>진행 중 <b>{open.length}</b></button>
            <button className={`hl-chip${chip === 'ALL' ? ' is-on' : ''}`} type="button" aria-pressed={chip === 'ALL'} onClick={() => setChip('ALL')}>전체 코일 계획 <b>{all.length}</b></button>
          </div>
        </div>
        <div className="hl-master__list">
          <QueryBoundary query={list}>
            {() => (
              <>
                <div style={GROUP_STYLE}>코일 계획 · 편성 확정 · 생산 중</div>
                {openShown.map(item)}
                {!openShown.length ? <EmptyNote style={{ padding: '8px 16px' }}>슬래브 배정이 필요한 코일 계획이 없어요</EmptyNote> : null}
                {chip === 'ALL' ? (
                  <>
                    <div style={GROUP_STYLE}>편성 전 · 완료 · 취소</div>
                    {others.map(item)}
                    {!others.length ? <EmptyNote style={{ padding: '8px 16px' }}>해당 계획이 없어요</EmptyNote> : null}
                  </>
                ) : null}
              </>
            )}
          </QueryBoundary>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          <span className="hl-cap">대상은 <Link to="/production/plans">생산계획</Link>에서 히트 편성을 확정한 코일 계획이에요.</span>
        </div>
      </section>
      <main className="hl-main">
        {selectedId === null ? (
          list.isLoading ? <StateView kind="loading" /> : <StateView kind="empty" title="열연 투입 배정 대상이 없어요" text="코일 수주의 생산계획이 편성 확정되면 여기에 표시돼요." />
        ) : (
          <RollingDetail key={selectedId} planId={selectedId} />
        )}
      </main>
    </>
  );
}

function RollingDetail({ planId }: { planId: number }) {
  const detail = usePlanDetail(planId);
  const plan = detail.data;
  useShellTitle(plan ? `열연 투입 배정 · ${plan.productionPlanNo}` : '열연 투입 배정', plan?.salesOrder ? `${plan.salesOrder.salesOrderNo} · ${plan.salesOrder.customerName}` : undefined);
  return <QueryBoundary query={detail}>{(d) => <RollingBody plan={d} />}</QueryBoundary>;
}

function RollingBody({ plan }: { plan: PlanDetail }) {
  const me = useMe();
  const canAllocate = canUse(me, 'ROLLING_ALLOCATE');
  const so = plan.salesOrder;
  const rolling = plan.rolling;
  const active = plan.productionPlanStatus === 'CONFIRMED' || plan.productionPlanStatus === 'IN_PROGRESS';
  const slabWeight = plan.slabSpec?.theoreticalWeightTon ?? null;

  const [rec, setRec] = useState<AllocationRecommendationView | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);

  const recommend = useAction(allocationApi.recommend, {
    onSuccess: (r) => { setRec(r); setPicked(r.recommendedLots.map((l) => l.lotId)); setReason(''); setError(null); },
    onError: (e) => setError(e),
  });
  const confirm = useAction(allocationApi.confirm, {
    success: (r) => `슬래브 ${r.allocations.length}매를 열연 투입으로 배정했어요${r.isRecommendationFollowed ? '' : ' (추천과 다르게 선택)'} · 남은 필요 ${r.neededQty}매`,
    invalidate: PLAN_TOPICS,
    onSuccess: () => { setRec(null); setPicked([]); setReason(''); setError(null); },
    onError: (e) => setError(e),
  });
  const release = useAction(allocationApi.release, {
    success: (r) => `${r.lotNo} 배정을 해제했어요`,
    invalidate: PLAN_TOPICS,
    onSuccess: () => { setRec(null); setPicked([]); setError(null); },
    onError: (e) => setError(e),
  });

  const confirmed = plan.rollingAllocations.filter((a) => a.status === 'CONFIRMED');
  const consumed = plan.rollingAllocations.filter((a) => a.status === 'CONSUMED');
  const released = plan.rollingAllocations.filter((a) => a.status === 'RELEASED');
  const pendingCoils = plan.lots.coils.filter((c) => c.isPassed === null).length;

  const recIds = rec ? rec.recommendedLots.map((l) => l.lotId) : [];
  const followsFifo = rec ? picked.length === recIds.slice(0, picked.length).length && [...picked].sort((a, b) => a - b).join(',') === [...recIds.slice(0, picked.length)].sort((a, b) => a - b).join(',') : true;
  const limit = rec?.neededQty ?? 0;
  const toggle = (lotId: number) => setPicked((prev) => (prev.includes(lotId) ? prev.filter((x) => x !== lotId) : prev.length >= limit ? prev : [...prev, lotId]));
  const runRecommend = () => recommend.mutate({ purpose: 'ROLLING', productionPlanId: plan.id });

  const steps: { label: string; state: StepState }[] = [
    { label: '히트 편성', state: plan.productionPlanStatus === 'PLANNED' ? 'run' : 'done' },
    { label: 'FIFO 추천', state: rec || confirmed.length || consumed.length ? 'done' : active ? 'run' : 'todo' },
    { label: `배정 확정${confirmed.length ? ` · ${confirmed.length}매` : ''}`, state: confirmed.length ? 'run' : consumed.length ? 'done' : 'todo' },
    { label: `열연 실적${rolling ? ` · ${rolling.rolledQty}/${plan.shortageQty}` : ''}`, state: rolling && rolling.rolledQty >= plan.shortageQty ? 'done' : consumed.length ? 'run' : 'todo' },
    { label: pendingCoils ? `코일 검사 · 대기 ${pendingCoils}` : '코일 검사', state: pendingCoils ? 'run' : plan.productionPlanStatus === 'COMPLETED' ? 'done' : 'todo' },
  ];

  return (
    <>
      <div className="hl-page-head">
        <div>
          <div className="hl-crumb">
            <Link to={`/production/plans?plan=${plan.id}`}>생산계획</Link>
            <Icon name="chevron-right" size="sm" />
            열연 투입 배정
            <Icon name="chevron-right" size="sm" />
            {plan.productionPlanNo}
          </div>
          <h1 className="hl-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: '18px' }}>{plan.productionPlanNo}</span>
            {so ? <span style={{ fontSize: '16px', fontWeight: 500 }}>{so.customerName} · 품목 {so.lineNo}</span> : null}
            <PlanStatusBadge status={plan.productionPlanStatus} />
          </h1>
        </div>
        <div className="hl-page-head__actions" style={{ flexWrap: 'wrap' }}>
          {so ? <Link className="hl-btn" to={`/sales-orders/${so.salesOrderId}`}><Icon name="order" />수주 상세</Link> : null}
          <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>
          <Link className="hl-btn" to={`/production/results?plan=${plan.id}`}><Icon name="factory" />공정 실적 · 열연 등록</Link>
        </div>
      </div>

      {plan.itemType !== 'COIL' || !rolling ? (
        <StateView kind="empty" title="코일 계획이 아니에요" text="열연 투입 배정은 코일 수주 품목의 생산계획에서만 해요." />
      ) : (
        <>
          <section className="hl-card" style={{ flex: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', padding: '12px 16px', gap: '12px' }}>
              <div className="hl-figure">
                <span>코일 수주 품목</span>
                <b style={{ fontSize: '13px', lineHeight: '20px', fontWeight: 500 }}>
                  {so ? <><Link className="hl-link-id" to={`/sales-orders/${so.salesOrderId}`}>{so.salesOrderNo}</Link> · 납기 {fmtMD(so.dueDate)} {active ? dLabel(so.dueDate) : ''}</> : '-'}
                </b>
              </div>
              <div className="hl-figure"><span>제품</span><b className="mono" style={{ fontSize: '13px', lineHeight: '20px' }}>{specText(plan.productSpec)}</b></div>
              <div className="hl-figure"><span>소재 슬래브</span><b className="mono" style={{ fontSize: '13px', lineHeight: '20px' }}>{plan.slabSpec ? specText(plan.slabSpec) : '규격 매핑 없음'}</b></div>
              <div className="hl-figure"><span>목표 · 압연 완료</span><b>{rolling.rolledQty}<small>/ {plan.shortageQty}개</small></b></div>
              <div className="hl-figure"><span>남은 압연</span><b>{rolling.remainingQty}<small>개</small></b></div>
              <div className="hl-figure" title="수주 품목 기준으로 슬래브를 더 확보해야 하는 수"><span>슬래브 추가 확보 필요</span><b className={rolling.rollingNeedQty > 0 ? 'hl-danger-text' : undefined}>{rolling.rollingNeedQty}<small>매</small></b></div>
              <div className="hl-figure"><span>귀속 슬래브</span><b>{rolling.earmarkedSlabQty}<small>매</small></b></div>
              <div className="hl-figure"><span>배정 확정</span><b>{rolling.confirmedAllocationQty}<small>매</small></b></div>
              <div className="hl-figure"><span>투입 완료</span><b>{consumed.length}<small>매</small></b></div>
            </div>
            <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--line)' }}>
              <Steps steps={steps} />
            </div>
          </section>

          {error ? <ServerErrorBanner error={error} purchaseLinks={false} /> : null}

          <section className="hl-card" style={{ flex: 'none' }}>
            <div className="hl-card__head">
              <h2>FIFO 추천 슬래브</h2>
              <span className="hl-card__meta">
                {rec ? <>합격 · <span className="mono">{rec.specCode}</span> · 후보 {rec.candidateLots.length}매</> : '아직 추천을 받지 않았어요'}
              </span>
              <div className="hl-card__actions">
                {!canAllocate ? <LockHint>열연 투입 배정 권한 필요</LockHint> : null}
                <button type="button" className={`hl-btn hl-btn--sm${rec ? ' hl-btn--ghost' : ' hl-btn--primary'}`} disabled={!canAllocate || !active || recommend.isPending} title={!canAllocate ? '권한이 필요해요' : !active ? '편성 확정·생산 중인 계획만 배정할 수 있어요' : undefined} onClick={runRecommend}>
                  <Icon name="refresh" />{rec ? '다시 추천' : 'FIFO 추천'}
                </button>
              </div>
            </div>
            <div style={{ padding: '10px 16px 0' }}>
              <div className="hl-banner hl-banner--run" style={{ padding: '8px 12px', fontSize: '12.5px' }}>
                <Icon name="info" size="sm" />
                <span>강종·규격이 같은 합격 슬래브를 생산완료일 순(FIFO)으로 추천해요. 이 수주 품목에 귀속된 슬래브가 먼저, 모자라면 재고의 여재(다른 수주 예약분 제외)에서 가져와요. 담당자가 확정하고, 투입 전에는 해제할 수 있어요.</span>
              </div>
            </div>
            {rec ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, padding: '12px 16px 0' }}>
                  <div className="hl-figure"><span>필요 (전체)</span><b style={{ fontSize: '15px' }}>{rec.requiredQty}매</b></div>
                  <div className="hl-figure"><span>이미 확정</span><b style={{ fontSize: '15px' }}>{rec.confirmedQty}매</b></div>
                  <div className="hl-figure"><span>더 배정할 매수</span><b style={{ fontSize: '15px' }}>{rec.neededQty}매</b></div>
                  <div className="hl-figure"><span>추천으로 못 채우는 매수</span><b style={{ fontSize: '15px' }} className={rec.shortageQty > 0 ? 'hl-danger-text' : undefined}>{rec.shortageQty}매</b></div>
                </div>
                {rec.shortageQty > 0 ? (
                  <div style={{ padding: '10px 16px 0' }}>
                    <div className="hl-banner hl-banner--wait" style={{ padding: '8px 12px', fontSize: '12.5px' }}>
                      <Icon name="alert" size="sm" />
                      <span>합격 슬래브가 <b>{rec.shortageQty}매</b> 모자라요. 연주·검사가 끝나면 다시 추천받거나, <Link to={`/production/plans?plan=${plan.id}`}>생산계획</Link>에서 재생산 계획을 확인해 주세요.</span>
                    </div>
                  </div>
                ) : null}
                <div style={{ paddingTop: '10px', maxHeight: '340px', overflow: 'auto' }}>
                  <table className="hl-table">
                    <thead>
                      <tr>
                        <th className="ctr" style={{ width: '44px' }}>선택</th>
                        <th>순위</th>
                        <th>슬래브 LOT</th>
                        <th>히트</th>
                        <th>생산완료일</th>
                        <th>야드</th>
                        <th>구분</th>
                        <th>추천</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.candidateLots.map((l, i) => {
                        const on = picked.includes(l.lotId);
                        const recommended = recIds.includes(l.lotId);
                        return (
                          <tr key={l.lotId} className={on ? 'is-selected' : undefined}>
                            <td className="ctr">
                              <input type="checkbox" checked={on} disabled={!canAllocate || (!on && picked.length >= limit)} onChange={() => toggle(l.lotId)} aria-label={`${i + 1}순위 ${l.lotNo} 선택`} />
                            </td>
                            <td className="tnum" style={on ? { fontWeight: 600 } : undefined}>{i + 1}</td>
                            <td><LotLink lotNo={l.lotNo} /></td>
                            <td className="mono">{l.heatNo ?? '-'}</td>
                            <td className="tnum">{fmtMDHM(l.producedAt)}</td>
                            <td>{l.yardName ?? '-'}</td>
                            <td>{l.isEarmarked ? <Badge tone="run" title="이 코일 수주 품목의 열연 투입용으로 이미 귀속된 슬래브">귀속분</Badge> : <Badge title="재고 풀의 여재 슬래브 · 확정하면 이 수주 품목에 귀속돼요">여재</Badge>}</td>
                            <td>{recommended ? <span className="hl-badge hl-badge--plain hl-badge--run">FIFO 추천</span> : <span className="hl-cap">후보</span>}</td>
                          </tr>
                        );
                      })}
                      {!rec.candidateLots.length ? (
                        <tr><td colSpan={8}><EmptyNote>{rec.neededQty > 0 ? '배정할 수 있는 합격 슬래브가 없어요 · 연주와 슬래브 검사가 끝나야 해요' : '배정이 모두 확정됐어요'}</EmptyNote></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {!followsFifo && picked.length ? (
                  <div className="hl-field" style={{ padding: '12px 16px 0' }}>
                    <label htmlFor={`ra-reason-${plan.id}`}>추천과 다르게 고른 사유 (선택)</label>
                    <input id={`ra-reason-${plan.id}`} className="hl-input" type="text" maxLength={500} placeholder="예: 야드 작업 순서" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <span className="hl-field__hint">추천과 다르게 고르면 작업 로그에 "배정 변경"으로 남아요.</span>
                  </div>
                ) : null}
                <div className="hl-card__foot" style={{ marginTop: 12 }}>
                  <span style={{ fontSize: '13px' }}>
                    선택 <b>{picked.length}매</b>
                    {slabWeight ? <> · 이론중량 <b className="tnum">{fmtTon(calcWeightTon(picked.length, slabWeight))}</b> <span className="hl-muted">(계산값)</span></> : null}
                  </span>
                  <span className="hl-cap">{rec.neededQty > 0 ? (picked.length >= rec.neededQty ? `필요 ${rec.neededQty}매 충족` : `필요 ${rec.neededQty}매 중 ${rec.neededQty - picked.length}매 부족`) : '추가 배정 필요 없음'}</span>
                  <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} disabled={!picked.length} onClick={() => setPicked([])}>선택 해제</button>
                  <button
                    type="button"
                    className="hl-btn hl-btn--primary"
                    disabled={!canAllocate || !picked.length || confirm.isPending}
                    title={canAllocate ? undefined : '권한이 필요해요'}
                    onClick={() => confirm.mutate({ purpose: 'ROLLING', productionPlanId: plan.id, lotIds: picked, reason: !followsFifo && reason.trim() ? reason.trim() : undefined })}
                  >
                    <Icon name="check" />배정 확정
                  </button>
                </div>
              </>
            ) : (
              <EmptyNote>
                {active ? '"FIFO 추천"을 누르면 지금 투입할 수 있는 슬래브를 순서대로 보여 줘요. 추천은 저장되지 않아요.' : '편성 확정·생산 중인 코일 계획만 배정할 수 있어요.'}
              </EmptyNote>
            )}
          </section>

          <section className="hl-card" style={{ flex: 'none' }}>
            <div className="hl-card__head">
              <h2>확정 배정</h2>
              <span className="hl-card__meta">투입 대기 {confirmed.length}매 · 투입 완료 {consumed.length}매{released.length ? ` · 해제 ${released.length}건` : ''}</span>
              <div className="hl-card__actions">
                <Link className="hl-btn hl-btn--sm" to={`/production/results?plan=${plan.id}`}><Icon name="factory" />열연 실적 등록<Icon name="arrow-right" size="sm" /></Link>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="hl-table">
                <thead>
                  <tr><th>슬래브 LOT</th><th>히트</th><th>상태</th><th>배정 확정</th><th>투입 · 해제</th><th className="ctr" style={{ width: 110 }}>작업</th></tr>
                </thead>
                <tbody>
                  {[...confirmed, ...consumed, ...released].map((a) => (
                    <tr key={a.id} className={a.status === 'RELEASED' ? 'is-muted' : undefined}>
                      <td><LotLink lotNo={a.lotNo} /></td>
                      <td className="mono">{a.heatLotNo ?? '-'}</td>
                      <td><Badge tone={a.status === 'CONFIRMED' ? 'run' : a.status === 'CONSUMED' ? 'ok' : 'neutral'}>{ALLOCATION_STATUS_LABEL[a.status]}</Badge></td>
                      <td className="tnum">{fmtMDHM(a.confirmedAt)}</td>
                      <td className="tnum">{a.consumedAt ? `${fmtMDHM(a.consumedAt)} 투입` : a.releasedAt ? `${fmtMDHM(a.releasedAt)} 해제` : '-'}</td>
                      <td className="ctr">
                        {a.status === 'CONFIRMED' ? (
                          <button type="button" className="hl-btn hl-btn--sm hl-btn--ghost" disabled={!canAllocate || release.isPending} title={canAllocate ? '투입 전에만 해제할 수 있어요' : '권한이 필요해요'} onClick={() => release.mutate({ id: a.id })}>
                            배정 해제
                          </button>
                        ) : <span className="hl-muted">-</span>}
                      </td>
                    </tr>
                  ))}
                  {!plan.rollingAllocations.length ? <tr><td colSpan={6}><EmptyNote style={{ padding: 6 }}>확정된 열연 배정이 없어요</EmptyNote></td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="hl-card__foot">
              <span className="hl-cap">
                필요한 매수의 슬래브만 열연에 투입해요. 남은 합격 슬래브는 여재(가용재고)로 남고, 한 슬래브를 판매 출하와 열연에 동시에 배정할 수 없어요. 배정을 해제하면 여재에서 가져왔던 슬래브는 다시 재고로 돌아가요.
              </span>
            </div>
          </section>
        </>
      )}
    </>
  );
}
