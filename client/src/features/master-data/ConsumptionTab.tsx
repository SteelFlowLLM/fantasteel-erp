// 배합 원단위 (REQ-MST-006): 공통 원료(용선 1t당 t) + 강종별 합금철(용강 1t당 kg)을 편집 가능한 격자로.
import { useMemo, useState } from 'react';
import { masterApi, type RawMaterialView, type SpecificConsumptionView, type SteelGradeView } from '@/api/masterData';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import { CONSUMPTION_UNIT_LABEL } from '@fantasteel/shared';
import { LockHint, LOCK_TITLE, useMasterAction } from './common';
import { useConsumptions, useRawMaterials, useSteelGrades } from './masterHooks';

const cellKey = (rmId: number, gradeId: number | null) => `${rmId}:${gradeId ?? 0}`;
const validRate = (s: string) => /^\d*\.?\d+$/.test(s.trim()) && Number(s) > 0;

export function ConsumptionTab({ canEdit }: { canEdit: boolean }) {
  const consumptions = useConsumptions();
  const materials = useRawMaterials({ active: 'true' });
  const grades = useSteelGrades({ active: 'true' });
  return (
    <QueryBoundary query={consumptions}>
      {(cs) => (
        <QueryBoundary query={materials}>
          {(ms) => (
            <QueryBoundary query={grades}>
              {(gs) => <ConsumptionGrid key={cs.map((c) => `${c.id}:${c.consumptionRate}`).join('|')} consumptions={cs} materials={ms} grades={gs} canEdit={canEdit} />}
            </QueryBoundary>
          )}
        </QueryBoundary>
      )}
    </QueryBoundary>
  );
}

function ConsumptionGrid({ consumptions, materials, grades, canEdit }: { consumptions: SpecificConsumptionView[]; materials: RawMaterialView[]; grades: SteelGradeView[]; canEdit: boolean }) {
  const byKey = useMemo(() => new Map(consumptions.map((c) => [cellKey(c.rawMaterialId, c.steelGradeId), c])), [consumptions]);
  const common = materials.filter((m) => m.rawMaterialType !== 'FERROALLOY');
  const alloys = materials.filter((m) => m.rawMaterialType === 'FERROALLOY');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);

  const valueOf = (k: string) => edits[k] ?? byKey.get(k)?.consumptionRate ?? '';
  const changed = (k: string) => k in edits && edits[k].trim() !== (byKey.get(k)?.consumptionRate ?? '');
  const changedKeys = Object.keys(edits).filter(changed);
  const errorOf = (k: string) => (changed(k) && edits[k].trim() !== '' && !validRate(edits[k]) ? '0보다 큰 숫자' : null);
  const invalid = changedKeys.some((k) => errorOf(k));

  const save = useMasterAction(async (keys: string[]) => {
    // 하나씩 저장한다. 서버가 거절하면 그 메시지로 멈춘다.
    for (const k of keys) {
      const [rmId, gId] = k.split(':').map(Number);
      const text = edits[k].trim();
      const existing = byKey.get(k);
      if (text === '') {
        if (existing) await masterApi.consumptions.remove(existing.id);
      } else {
        await masterApi.consumptions.upsert({ rawMaterialId: rmId, steelGradeId: gId || null, consumptionRate: Number(text) });
      }
    }
    return keys.length;
  }, (n) => `원단위 ${n}건을 저장했어요`, () => setEdits({}));

  const cell = (rm: RawMaterialView, gradeId: number | null, unit: string) => {
    const k = cellKey(rm.id, gradeId);
    const err = tried ? errorOf(k) : null;
    return (
      <span className="hl-inputwrap" style={{ display: 'inline-block', width: 108 }}>
        <input
          className={`hl-input num${err ? ' is-error' : ''}`}
          style={{ height: 26, paddingRight: 30, ...(changed(k) ? { borderColor: '#E0A458', background: '#FDF0DF' } : {}) }}
          inputMode="decimal"
          value={valueOf(k)}
          onChange={(e) => setEdits((v) => ({ ...v, [k]: e.target.value }))}
          disabled={!canEdit}
          title={err ?? (canEdit ? undefined : LOCK_TITLE)}
          placeholder="미설정"
          aria-label={`${rm.itemName}${gradeId ? ` ${grades.find((g) => g.id === gradeId)?.steelGradeCode}` : ''} 원단위`}
        />
        <span className="hl-suffix" style={{ top: 4 }}>{unit}</span>
      </span>
    );
  };

  return (
    <div className="md-scroll md-col">
      {!canEdit ? <LockHint /> : null}
      <section className="hl-card md-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h3>공통 원단위</h3>
          <span className="hl-cap">{CONSUMPTION_UNIT_LABEL.TON_PER_TON} · 철광석·석탄·석회석은 강종과 상관없는 공통값이에요</span>
        </header>
        <table className="hl-table hl-table--compact">
          <thead><tr><th>원료 코드</th><th>원료</th><th>종류</th><th className="num">원단위</th></tr></thead>
          <tbody>
            {common.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.materialCode}</td>
                <td>{m.itemName}</td>
                <td className="hl-ink2">{m.rawMaterialTypeName}</td>
                <td className="num">{cell(m, null, 't/t')}</td>
              </tr>
            ))}
            {!common.length ? <tr><td colSpan={4}><EmptyNote>사용 중인 철광석·석탄·석회석 원료가 없어요</EmptyNote></td></tr> : null}
          </tbody>
        </table>
      </section>
      <section className="hl-card md-card" style={{ flex: 'none' }}>
        <header className="hl-card__head">
          <h3>합금철 원단위 (강종별)</h3>
          <span className="hl-cap">{CONSUMPTION_UNIT_LABEL.KG_PER_TON}</span>
        </header>
        <div style={{ overflow: 'auto' }}>
          <table className="hl-table hl-table--compact">
            <thead>
              <tr><th>원료 코드</th><th>합금철</th>{grades.map((g) => <th key={g.id} className="num mono">{g.steelGradeCode}</th>)}</tr>
            </thead>
            <tbody>
              {alloys.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.materialCode}</td>
                  <td>{m.itemName}</td>
                  {grades.map((g) => <td key={g.id} className="num">{cell(m, g.id, 'kg/t')}</td>)}
                </tr>
              ))}
              {!alloys.length ? <tr><td colSpan={2 + grades.length}><EmptyNote>사용 중인 합금철 원료가 없어요</EmptyNote></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <div className="hl-row" style={{ gap: 8 }}>
        <span className={`hl-cap${changedKeys.length ? ' hl-wait-text' : ''}`}>
          {changedKeys.length ? `변경 ${changedKeys.length}건 · 칸을 비우고 저장하면 그 원단위를 지워요 (지우면 준비 상태 점검에 걸려요)` : '값을 고치고 저장해요 · 0보다 커야 해요 · 비어 있으면 미설정이에요'}
        </span>
        <button type="button" className="hl-btn hl-btn--sm" style={{ marginLeft: 'auto' }} disabled={!changedKeys.length || save.isPending} onClick={() => { setEdits({}); setTried(false); }}>되돌리기</button>
        <button
          type="button"
          className="hl-btn hl-btn--sm hl-btn--primary"
          disabled={!canEdit || !changedKeys.length || save.isPending}
          title={canEdit ? undefined : LOCK_TITLE}
          onClick={() => { setTried(true); if (!invalid) save.mutate(changedKeys); }}
        >
          <Icon name="check" />{save.isPending ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}
