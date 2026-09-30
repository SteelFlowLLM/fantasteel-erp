// 강종·성분 규격 (REQ-MST-002): 강종(KS 규격 번호)과 강종별 성분 min/max(%).
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { masterApi, type CompositionSpecInput, type SteelGradeView } from '@/api/masterData';
import { EmptyNote, Field, Icon, Modal, QueryBoundary } from '@/components/ui';
import { ActiveToggle, AddButton, DeleteButton, errMsg, FormFooter, LockHint, LOCK_TITLE, parseOptDec, useMasterAction } from './common';
import { useSteelGrades } from './masterHooks';

const GRADE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const ELEMENT_RE = /^[A-Za-z][A-Za-z0-9]{0,9}$/;

export interface CompRow { key: number; elementCode: string; minValue: string; maxValue: string }
let rowSeq = 0;
const newRow = (r?: Partial<CompRow>): CompRow => ({ key: ++rowSeq, elementCode: '', minValue: '', maxValue: '', ...r });
const rowsOf = (g: SteelGradeView): CompRow[] => g.compositionSpecs.map((c) => newRow({ elementCode: c.elementCode, minValue: c.minValue ?? '', maxValue: c.maxValue ?? '' }));

/** 성분 행 검증 → 서버 입력. 오류가 있으면 행 번호별 메시지를 준다. */
function checkRows(rows: CompRow[], requireOne: boolean): { inputs: CompositionSpecInput[]; errors: Record<number, string>; general: string | null } {
  const errors: Record<number, string> = {};
  const inputs: CompositionSpecInput[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const el = r.elementCode.trim();
    const min = parseOptDec(r.minValue, 4);
    const max = parseOptDec(r.maxValue, 4);
    if (!ELEMENT_RE.test(el)) errors[r.key] = '성분 기호는 영문으로 시작하는 10자 이내예요 (예: C, Si, Mn)';
    else if (seen.has(el.toLowerCase())) errors[r.key] = '같은 성분이 두 번 있어요';
    else if (min === undefined || max === undefined) errors[r.key] = '값은 소수 4자리까지 숫자로 입력해 주세요';
    else if (min === null && max === null) errors[r.key] = '최소·최대 중 하나는 입력해 주세요';
    else if ((min ?? 0) > 100 || (max ?? 0) > 100) errors[r.key] = '0~100 % 안에서 입력해 주세요';
    else if (min !== null && max !== null && min > max) errors[r.key] = '최소값이 최대값보다 클 수 없어요';
    else inputs.push({ elementCode: el, minValue: min, maxValue: max, sortOrder: i });
    seen.add(el.toLowerCase());
  });
  return { inputs, errors, general: requireOne && !rows.length ? '성분을 1개 이상 입력해 주세요' : null };
}

export function CompositionEditor({ rows, onChange, disabled, errors }: { rows: CompRow[]; onChange: (r: CompRow[]) => void; disabled?: boolean; errors: Record<number, string> }) {
  const set = (key: number, patch: Partial<CompRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="hl-col" style={{ gap: 6 }}>
      <table className="hl-table hl-table--compact">
        <thead>
          <tr><th style={{ width: 110 }}>성분</th><th className="num">최소 (%)</th><th className="num">최대 (%)</th><th style={{ width: 40 }} /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <input className={`hl-input mono${errors[r.key] ? ' is-error' : ''}`} style={{ height: 26 }} value={r.elementCode} onChange={(e) => set(r.key, { elementCode: e.target.value })} disabled={disabled} aria-label="성분 기호" placeholder="C" />
              </td>
              <td className="num"><input className="hl-input num" style={{ height: 26 }} inputMode="decimal" value={r.minValue} onChange={(e) => set(r.key, { minValue: e.target.value })} disabled={disabled} aria-label={`${r.elementCode} 최소`} placeholder="–" /></td>
              <td className="num"><input className="hl-input num" style={{ height: 26 }} inputMode="decimal" value={r.maxValue} onChange={(e) => set(r.key, { maxValue: e.target.value })} disabled={disabled} aria-label={`${r.elementCode} 최대`} placeholder="–" /></td>
              <td className="num">
                <button type="button" className="hl-iconbtn hl-iconbtn--sm" aria-label={`${r.elementCode || '성분'} 행 지우기`} disabled={disabled} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}><Icon name="x" /></button>
              </td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={4}><EmptyNote>성분이 없어요</EmptyNote></td></tr> : null}
        </tbody>
      </table>
      {rows.filter((r) => errors[r.key]).map((r) => <span key={r.key} className="hl-cap hl-danger-text" role="alert">{r.elementCode || '(빈 성분)'}: {errors[r.key]}</span>)}
      {!disabled ? (
        <div><button type="button" className="hl-btn hl-btn--sm" onClick={() => onChange([...rows, newRow()])}><Icon name="plus" />성분 추가</button></div>
      ) : null}
    </div>
  );
}

export function SteelGradeTab({ canEdit }: { canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const grades = useSteelGrades();
  const selId = Number(params.get('grade')) || null;
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('grade', String(id)); return n; }, { replace: true });

  return (
    <QueryBoundary query={grades}>
      {(rows) => {
        const sel = rows.find((g) => g.id === selId) ?? rows[0];
        return (
          <div className="md-split">
            <section className="hl-card md-card">
              <header className="hl-card__head">
                <h3>강종</h3>
                <span className="hl-tag">{rows.length}</span>
                <div className="hl-card__actions"><AddButton canEdit={canEdit} onClick={() => setCreating(true)}>강종 추가</AddButton></div>
              </header>
              <div className="hl-master__list" style={{ overflow: 'auto' }}>
                {rows.map((g) => (
                  <div
                    key={g.id}
                    className={`hl-mitem${sel && g.id === sel.id ? ' is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => select(g.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') select(g.id); }}
                    style={g.isActive ? undefined : { opacity: 0.6 }}
                  >
                    <div className="hl-row">
                      <b className="mono">{g.steelGradeCode}</b>
                      <span>{g.steelGradeName}</span>
                      <span className="hl-cap" style={{ marginLeft: 'auto' }}>{g.isActive ? `성분 ${g.compositionSpecs.length}` : '사용 안 함'}</span>
                    </div>
                    <span className="hl-cap">{g.standardNo ?? 'KS 규격 번호 없음'}</span>
                  </div>
                ))}
                {!rows.length ? <EmptyNote>등록된 강종이 없어요</EmptyNote> : null}
              </div>
            </section>
            {sel ? <GradeDetail key={`${sel.id}-${sel.updatedAt}`} grade={sel} canEdit={canEdit} onDeleted={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('grade'); return n; }, { replace: true })} /> : <div />}
            {creating ? <CreateGradeModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); select(id); }} /> : null}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function GradeDetail({ grade, canEdit, onDeleted }: { grade: SteelGradeView; canEdit: boolean; onDeleted: () => void }) {
  const [name, setName] = useState(grade.steelGradeName);
  const [stdNo, setStdNo] = useState(grade.standardNo ?? '');
  const [rows, setRows] = useState<CompRow[]>(() => rowsOf(grade));
  const [tried, setTried] = useState(false);
  const update = useMasterAction(masterApi.steelGrades.update, '강종 정보를 저장했어요');
  const replace = useMasterAction(masterApi.steelGrades.replaceComposition, '성분 규격을 저장했어요');
  const remove = useMasterAction(() => masterApi.steelGrades.remove(grade.id), '강종을 삭제했어요', onDeleted);

  const infoDirty = name.trim() !== grade.steelGradeName || (stdNo.trim() || null) !== grade.standardNo;
  const compDirty = JSON.stringify(rows.map(({ elementCode, minValue, maxValue }) => [elementCode.trim(), minValue.trim(), maxValue.trim()])) !== JSON.stringify(rowsOf(grade).map(({ elementCode, minValue, maxValue }) => [elementCode, minValue, maxValue]));
  const check = checkRows(rows, true);
  const compInvalid = Object.keys(check.errors).length > 0 || !!check.general;

  return (
    <section className="hl-card md-card" style={{ overflow: 'auto' }}>
      <header className="hl-card__head">
        <h3 className="mono">{grade.steelGradeCode}</h3>
        <span className="hl-cap">{grade.steelGradeName}</span>
        <div className="hl-card__actions">
          <ActiveToggle active={grade.isActive} canEdit={canEdit} pending={update.isPending} onToggle={() => update.mutate({ id: grade.id, isActive: !grade.isActive })} />
          <DeleteButton label={grade.steelGradeCode} canEdit={canEdit} pending={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
        </div>
      </header>
      <div className="hl-card__body" style={{ gap: 14 }}>
        {!canEdit ? <LockHint /> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Field label="강종 코드" hint="만든 뒤에는 바꿀 수 없어요"><input className="hl-input mono" value={grade.steelGradeCode} readOnly /></Field>
          <Field label="강종 이름"><input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} title={canEdit ? undefined : LOCK_TITLE} maxLength={50} /></Field>
          <Field label="KS 규격 번호"><input className="hl-input" value={stdNo} onChange={(e) => setStdNo(e.target.value)} disabled={!canEdit} placeholder="예: KS D 3503" maxLength={50} /></Field>
        </div>
        <div className="hl-row" style={{ gap: 6 }}>
          <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" disabled={!canEdit || !infoDirty || !name.trim() || update.isPending}
            onClick={() => update.mutate({ id: grade.id, steelGradeName: name.trim(), standardNo: stdNo.trim() || null })}>
            <Icon name="check" />이름·규격 번호 저장
          </button>
        </div>
        <div className="hl-col" style={{ gap: 8 }}>
          <div className="hl-row"><b style={{ fontSize: 13 }}>성분 규격 (%)</b><span className="hl-cap">최소·최대 중 하나는 필요해요 · 저장하면 목록 전체를 바꿔요</span></div>
          <CompositionEditor rows={rows} onChange={setRows} disabled={!canEdit} errors={tried ? check.errors : {}} />
          {tried && check.general ? <span className="hl-cap hl-danger-text" role="alert">{check.general}</span> : null}
          <div className="hl-row" style={{ gap: 6 }}>
            <button type="button" className="hl-btn hl-btn--sm" disabled={!compDirty} onClick={() => { setRows(rowsOf(grade)); setTried(false); }}>되돌리기</button>
            <button
              type="button"
              className="hl-btn hl-btn--sm hl-btn--primary"
              disabled={!canEdit || !compDirty || replace.isPending}
              onClick={() => { setTried(true); if (!compInvalid) replace.mutate({ id: grade.id, compositionSpecs: check.inputs }); }}
            >
              <Icon name="check" />성분 규격 저장
            </button>
          </div>
        </div>
      </div>
      <footer className="hl-card__foot"><span className="hl-cap">규격·LOT·생산계획·검사 항목·배합 원단위가 쓰는 강종은 삭제할 수 없어요 · 사용 안 함으로 바꿔 주세요</span></footer>
    </section>
  );
}

function CreateGradeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [stdNo, setStdNo] = useState('');
  const [rows, setRows] = useState<CompRow[]>([]);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMasterAction(masterApi.steelGrades.create, '강종을 추가했어요', (g) => onCreated(g.id));
  const check = checkRows(rows, false);
  const errors = { code: GRADE_RE.test(code) ? null : '영문 대문자·숫자·하이픈으로 20자 이내 (예: SS275)', name: name.trim() ? null : '강종 이름을 입력해 주세요' };
  const submit = () => {
    setTried(true);
    setServerError(null);
    if (errors.code || errors.name || Object.keys(check.errors).length) return;
    create.mutate({ steelGradeCode: code, steelGradeName: name.trim(), standardNo: stdNo.trim() || null, compositionSpecs: check.inputs }, { onError: (e) => setServerError(errMsg(e, '추가하지 못했어요')) });
  };
  return (
    <Modal title="강종 추가" onClose={onClose} width={560} footer={<FormFooter error={serverError} onClose={onClose} onSubmit={submit} pending={create.isPending} submitLabel="추가" />}>
      <Field label={<>강종 코드<span className="req">*</span></>} error={tried ? errors.code : null} hint="만든 뒤에는 바꿀 수 없어요">
        <input className="hl-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SS275" />
      </Field>
      <Field label={<>강종 이름<span className="req">*</span></>} error={tried ? errors.name : null}><input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></Field>
      <Field label="KS 규격 번호"><input className="hl-input" value={stdNo} onChange={(e) => setStdNo(e.target.value)} placeholder="예: KS D 3503" maxLength={50} /></Field>
      <div className="hl-col" style={{ gap: 6 }}>
        <span className="hl-field__label">성분 규격 (선택)</span>
        <CompositionEditor rows={rows} onChange={setRows} errors={tried ? check.errors : {}} />
      </div>
    </Modal>
  );
}
