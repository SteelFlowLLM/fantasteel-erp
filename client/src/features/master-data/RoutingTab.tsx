// 라우팅 (REQ-MST-005): 품목 유형(슬래브·코일)별 공정 순서와 공정별 계획 수율. 열연 수율은 규격 매핑에서 계산한다.
import { useState } from 'react';
import type { ProcessCode } from '@fantasteel/shared';
import { masterApi, type RoutingProcessView, type RoutingView } from '@/api/masterData';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { LockHint, LOCK_TITLE, useMasterAction } from './common';
import { useRoutings } from './masterHooks';

const TITLE: Record<'SLAB' | 'COIL', string> = { SLAB: '슬래브 라우팅', COIL: '코일 라우팅' };

export function RoutingTab({ canEdit, goMapping }: { canEdit: boolean; goMapping: () => void }) {
  const routings = useRoutings();
  return (
    <QueryBoundary query={routings}>
      {(rows) => (
        <div className="md-scroll md-col">
          {!canEdit ? <LockHint /> : null}
          <div className="md-grid2">
            {rows.map((r) => <RoutingCard key={`${r.itemType}-${r.processes.map((p) => `${p.id}:${p.plannedYieldRate}`).join(',')}`} routing={r} canEdit={canEdit} goMapping={goMapping} />)}
          </div>
          {!rows.length ? <EmptyNote>등록된 라우팅이 없어요</EmptyNote> : null}
        </div>
      )}
    </QueryBoundary>
  );
}

function RoutingCard({ routing, canEdit, goMapping }: { routing: RoutingView; canEdit: boolean; goMapping: () => void }) {
  const [vals, setVals] = useState<Record<number, string>>(() => Object.fromEntries(routing.processes.map((p) => [p.id, p.plannedYieldRate ?? ''])));
  const [tried, setTried] = useState(false);
  const save = useMasterAction(masterApi.routings.save, `${TITLE[routing.itemType]}을 저장했어요`);

  const errorOf = (p: RoutingProcessView): string | null => {
    if (p.yieldSource === 'MAPPING') return null;
    const s = (vals[p.id] ?? '').trim();
    if (!s) return p.processCode === 'IRONMAKING' ? null : '계획 수율을 입력해 주세요';
    const n = Number(s);
    return /^\d*\.?\d+$/.test(s) && n > 0 && n <= 1 ? null : '0보다 크고 1 이하로 입력해 주세요 (예: 0.95)';
  };
  const dirty = routing.processes.some((p) => p.yieldSource === 'INPUT' && (vals[p.id] ?? '').trim() !== (p.plannedYieldRate ?? ''));
  const invalid = routing.processes.some((p) => errorOf(p));

  const submit = () => {
    setTried(true);
    if (invalid) return;
    save.mutate({
      itemType: routing.itemType,
      processes: routing.processes.map((p) => ({
        processCode: p.processCode as ProcessCode,
        ...(p.yieldSource === 'INPUT' ? { plannedYieldRate: (vals[p.id] ?? '').trim() ? Number(vals[p.id]) : null } : {}),
      })),
    });
  };

  return (
    <section className="hl-card md-card">
      <header className="hl-card__head">
        <Icon name="flow" style={{ color: '#3F4A57' }} />
        <h3>{TITLE[routing.itemType]}</h3>
        <span className="hl-tag">공정 {routing.processes.length}</span>
      </header>
      <table className="hl-table hl-table--compact">
        <thead><tr><th style={{ width: 56 }}>순서</th><th>공정</th><th className="num">계획 수율</th></tr></thead>
        <tbody>
          {routing.processes.map((p) => {
            const err = tried ? errorOf(p) : null;
            return (
              <tr key={p.id}>
                <td className="tnum">{p.processSeq}</td>
                <td><b>{p.processName}</b> <span className="hl-cap mono">{p.processCode}</span></td>
                <td className="num">
                  {p.yieldSource === 'MAPPING' ? (
                    <button type="button" className="hl-link-id" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={goMapping} title="규격 매핑 탭으로 이동">규격 매핑에서 계산</button>
                  ) : (
                    <span className="hl-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <input
                        className={`hl-input num${err ? ' is-error' : ''}`}
                        style={{ width: 96, height: 26 }}
                        inputMode="decimal"
                        value={vals[p.id] ?? ''}
                        onChange={(e) => setVals((v) => ({ ...v, [p.id]: e.target.value }))}
                        disabled={!canEdit}
                        title={canEdit ? undefined : LOCK_TITLE}
                        placeholder={p.processCode === 'IRONMAKING' ? '미설정' : '0.95'}
                        aria-label={`${p.processName} 계획 수율`}
                      />
                      <span className="hl-cap" style={{ width: 44, textAlign: 'right' }}>{(vals[p.id] ?? '').trim() && Number(vals[p.id]) > 0 && Number(vals[p.id]) <= 1 ? `${(Number(vals[p.id]) * 100).toFixed(1)}%` : ''}</span>
                    </span>
                  )}
                  {err ? <div className="hl-cap hl-danger-text" role="alert">{err}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hl-card__foot">
        <span className="hl-cap">수율은 0보다 크고 1 이하 비율이에요 · 열연 수율은 입력하지 않아요</span>
        <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} disabled={!dirty} onClick={() => { setVals(Object.fromEntries(routing.processes.map((p) => [p.id, p.plannedYieldRate ?? '']))); setTried(false); }}>되돌리기</button>
        <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" disabled={!canEdit || !dirty || save.isPending} title={canEdit ? undefined : LOCK_TITLE} onClick={submit}>
          <Icon name="check" />저장
        </button>
      </div>
    </section>
  );
}
