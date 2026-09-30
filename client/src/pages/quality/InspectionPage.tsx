// 검사 입력 (REQ-QC-001~003): 공정별 검사 대기열 | 측정값 입력 → 시스템 자동 판정.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PROCESS_CODE_LABEL } from '@fantasteel/shared';
import type { Inspection, InspectionProcessCode, PendingInspection } from '@/api/quality';
import { Badge, EmptyNote, Icon, QueryBoundary, SoonButton, StateView } from '@/components/ui';
import { InspectionForm } from '@/features/quality/InspectionForm';
import { InspectionResultView } from '@/features/quality/InspectionResultView';
import { useDoneInspections, useInspectionOfLot, useNow, usePendingInspections } from '@/features/quality/qualityHooks';
import { LotHeader, LotInfoCard, ResultBadge } from '@/features/quality/qualityUi';
import { PROCESS_TAB_HINT, lotIcon, waitText } from '@/features/quality/qualityUtil';
import { fmtMDHM } from '@/lib/format';
import { useShellTitle } from '@/shell/shellTitle';
import './InspectionPage.css';

type Tab = 'ALL' | InspectionProcessCode | 'DONE';
const PROCESS_TABS: InspectionProcessCode[] = ['STEELMAKING', 'CASTING', 'HOT_ROLLING'];
const href = (lotId: number) => `/quality/inspections?lot=${lotId}`;

export function InspectionPage() {
  const pendingQ = usePendingInspections();
  return <QueryBoundary query={pendingQ} loadingLabel="검사 대기열을 불러오는 중…">{(pending) => <Workspace pending={pending} />}</QueryBoundary>;
}

function Workspace({ pending }: { pending: PendingInspection[] }) {
  const [sp, setSp] = useSearchParams();
  const now = useNow();
  const doneQ = useDoneInspections();
  const done = doneQ.data ?? [];
  const [tabState, setTab] = useState<Tab | null>(null);
  const [q, setQ] = useState('');
  /** 방금 등록해서 시스템 판정을 보여 주는 검사 */
  const [result, setResult] = useState<Inspection | null>(null);

  const paramId = Number(sp.get('lot')) || null;
  const paramPending = paramId ? pending.find((p) => p.lot.id === paramId) : undefined;
  const paramDone = paramId ? done.find((i) => i.lot.id === paramId) : undefined;
  const tab: Tab = tabState ?? (paramId && !paramPending && paramDone ? 'DONE' : 'ALL');

  const needle = q.trim().toUpperCase();
  const match = (...s: string[]) => !needle || s.some((x) => x.toUpperCase().includes(needle));
  const pendingList = pending.filter((p) => (tab === 'ALL' || p.processCode === tab) && match(p.lot.lotNo));
  const doneList = done.filter((i) => match(i.lot.lotNo, i.qualityInspectionNo));
  const activeId = paramId ?? (tab === 'DONE' ? doneList[0]?.lot.id : pendingList[0]?.lot.id) ?? null;

  const selPending = activeId ? pending.find((p) => p.lot.id === activeId) : undefined;
  const selDone = activeId ? done.find((i) => i.lot.id === activeId) : undefined;
  const fresh = result && result.lot.id === activeId ? result : null;
  const formItem = fresh ? undefined : selPending;
  // 목록(최근 300건)에 없는 LOT은 그 LOT의 검사만 따로 불러온다 (알림 링크 등)
  const lookup = useInspectionOfLot(activeId, doneQ.isSuccess && !selPending && !selDone && !fresh);
  const inspection: Inspection | null = fresh ?? (selPending ? null : selDone ?? lookup.data ?? null);
  const lot = formItem?.lot ?? inspection?.lot ?? null;
  useShellTitle(lot?.lotNo, lot ? '검사 입력' : undefined);

  const count = (t: Tab) => (t === 'ALL' ? pending.length : t === 'DONE' ? done.length : pending.filter((p) => p.processCode === t).length);
  const nextItem = pendingList.find((p) => p.lot.id !== result?.lot.id) ?? pending.find((p) => p.lot.id !== result?.lot.id);
  const remaining = pending.filter((p) => p.lot.id !== result?.lot.id).length;

  const onRegistered = (i: Inspection) => {
    setResult(i);
    setSp({ lot: String(i.lot.id) }, { replace: true });
  };
  const goNext = () => {
    setResult(null);
    if (tab === 'DONE') setTab('ALL');
    setSp(nextItem ? { lot: String(nextItem.lot.id) } : {}, { replace: true });
  };

  const tabLabel = (t: Tab) => (t === 'ALL' ? '전체' : t === 'DONE' ? '완료' : PROCESS_CODE_LABEL[t]);

  return (
    <>
      <section className="hl-master qc-master" aria-label="검사 대기 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>검사 대기열</b>
            <span className="hl-cap">{tab === 'DONE' ? '최근 검사 순' : '생산 시각 순'}</span>
          </div>
          <div className="hl-seg qi-seg" role="tablist" aria-label="공정별 보기">
            {(['ALL', ...PROCESS_TABS, 'DONE'] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : undefined} onClick={() => setTab(t)}>
                {tabLabel(t)} {count(t)}
              </button>
            ))}
          </div>
          <span className="hl-cap">
            {tab === 'ALL' ? '제강 히트 성분 · 연주 슬래브 표면·치수 · 열연 코일 치수·기계적 성질' : tab === 'DONE' ? '등록한 검사 (최근 300건까지)' : PROCESS_TAB_HINT[tab]}
          </span>
          <span className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="LOT번호 검색" aria-label="LOT 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        </div>
        <div className="hl-master__list">
          {tab !== 'DONE' ? (
            <>
              {pendingList.map((p) => (
                <Link key={p.lot.id} className={`hl-mitem${p.lot.id === activeId ? ' is-active' : ''}`} to={href(p.lot.id)}>
                  <div className="hl-row">
                    <Icon name={lotIcon(p.lot.lotType)} size="sm" style={{ color: '#173A5E' }} />
                    <span className="mono" style={{ fontWeight: 600 }}>{p.lot.lotNo}</span>
                    <span style={{ marginLeft: 'auto' }}><Badge tone="wait">대기 {waitText(p.lot.producedAt, now)}</Badge></span>
                  </div>
                  <span className="hl-cap">{p.lot.lotTypeName} · {PROCESS_CODE_LABEL[p.processCode]} · {p.lot.steelGradeCode ?? '—'}{p.lot.specCode ? ` ${p.lot.specCode}` : ''}</span>
                  <span className="hl-cap">{p.lot.productionPlanNo ? `계획 ${p.lot.productionPlanNo}` : '계획 없음'}{p.lot.salesOrderNo ? ` · 수주 ${p.lot.salesOrderNo}` : ''}</span>
                  <span className="hl-cap">생산 {fmtMDHM(p.lot.producedAt)}{p.lot.lotType !== 'HEAT' && p.lot.heatIsPassed === null ? ' · 상위 히트 판정 전' : ''}</span>
                </Link>
              ))}
              {!pendingList.length ? <EmptyNote>{pending.length ? '조건에 맞는 검사 대기 LOT이 없어요' : '검사 대기 LOT이 없어요'}</EmptyNote> : null}
              <div className="hl-banner" style={{ margin: '14px 16px', fontSize: 12, lineHeight: '17px' }}>
                <Icon name="info" size="sm" />
                <span>제강·연주·열연 실적이 저장되면 LOT이 이 대기열에 올라와요. 히트가 판정 전이어도 슬래브는 먼저 검사할 수 있어요.</span>
              </div>
            </>
          ) : (
            <>
              {doneQ.isLoading ? <EmptyNote>불러오는 중…</EmptyNote> : null}
              {doneQ.error && !doneQ.data ? <EmptyNote>검사 기록을 불러오지 못했어요</EmptyNote> : null}
              {doneList.map((i) => (
                <Link key={i.id} className={`hl-mitem${i.lot.id === activeId ? ' is-active' : ''}`} to={href(i.lot.id)}>
                  <div className="hl-row">
                    <Icon name={lotIcon(i.lot.lotType)} size="sm" style={{ color: 'var(--ink-3)' }} />
                    <span className="mono">{i.lot.lotNo}</span>
                    <span style={{ marginLeft: 'auto' }}><ResultBadge result={i.inspectionResult} /></span>
                  </div>
                  <span className="hl-cap">{i.lot.lotTypeName} · {i.inspectionName} · {i.lot.steelGradeCode ?? '—'}{i.lot.specCode ? ` ${i.lot.specCode}` : ''}</span>
                  <span className="hl-cap"><span className="mono">{i.qualityInspectionNo}</span> · {fmtMDHM(i.inspectedAt)} · {i.inspectorEmployeeName ?? '시스템'}</span>
                </Link>
              ))}
              {doneQ.isSuccess && !doneList.length ? <EmptyNote>{done.length ? '조건에 맞는 검사가 없어요' : '등록된 검사가 없어요'}</EmptyNote> : null}
            </>
          )}
        </div>
      </section>

      <main className="hl-main qc-main">
        {!activeId ? (
          <section className="hl-card qi-empty"><span className="hl-cap">검사 대기 LOT이 없어요 · 실적이 저장되면 대기열에 올라와요</span></section>
        ) : !lot ? (
          lookup.isLoading || doneQ.isLoading ? <StateView kind="loading" /> : (
            <StateView
              kind="empty"
              title="이 LOT은 검사 대기 목록에 없어요"
              text="이미 다른 곳에서 검사했거나, 상위 히트가 불합격이거나, 투입·출고된 LOT일 수 있어요."
              actions={<Link className="hl-btn" to="/quality/rejected">불합격 관리 보기</Link>}
            />
          )
        ) : (
          <>
            <LotHeader
              area="검사 입력"
              lotNo={lot.lotNo}
              typeName={lot.lotTypeName}
              badges={inspection ? <ResultBadge result={inspection.inspectionResult} /> : <Badge tone="wait">검사 대기 {waitText(lot.producedAt, now)}</Badge>}
              actions={(
                <>
                  <Link className="hl-btn" to={`/lots/trace?lot=${encodeURIComponent(lot.lotNo)}`}><Icon name="trace" />LOT 추적</Link>
                  <Link className="hl-btn" to="/business-events"><Icon name="history" />작업 로그</Link>
                  <SoonButton grade="EX">비슷한 사례 찾기</SoonButton>
                </>
              )}
            />
            <LotInfoCard lot={lot} inspectionName={formItem?.inspectionName ?? inspection?.inspectionName} />
            {formItem ? (
              <>
                {lot.lotType !== 'HEAT' && lot.heatIsPassed === null ? (
                  <div className="hl-banner hl-banner--wait">
                    <Icon name="info" />
                    <span>상위 히트 {lot.heatLotNo}의 성분 검사가 아직 판정 전이에요. 먼저 검사할 수 있고, 히트가 합격해야 재고에 들어가요.</span>
                  </div>
                ) : null}
                <InspectionForm key={lot.id} item={formItem} onRegistered={onRegistered} />
              </>
            ) : inspection ? (
              <InspectionResultView inspection={inspection} fresh={!!fresh} remaining={remaining} onNext={goNext} />
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
