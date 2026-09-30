// 검사 항목 (REQ-QC-002): 공정(연주 슬래브 · 열연 코일)·강종별 검사 항목과 min/max(경계 포함).
import { useState } from 'react';
import { masterApi, type InspectionItemView, type InspectionProcess } from '@/api/masterData';
import { Badge, EmptyNote, Field, Modal, QueryBoundary } from '@/components/ui';
import { AddButton, CardHead, DeleteButton, EditButton, errMsg, FormFooter, LockHint, parseOptDec, SelectBox, useMasterAction } from './common';
import { useInspectionItems, useSteelGrades } from './masterHooks';

const PROCESSES: { key: InspectionProcess; label: string }[] = [
  { key: 'CASTING', label: '연주 (슬래브)' },
  { key: 'HOT_ROLLING', label: '열연 (코일)' },
];
const CODE_RE = /^[A-Z][A-Z0-9_]{0,49}$/;

export function InspectionTab({ canEdit }: { canEdit: boolean }) {
  const [process, setProcess] = useState<InspectionProcess>('CASTING');
  const [gradeId, setGradeId] = useState('');
  const [editing, setEditing] = useState<InspectionItemView | 'new' | null>(null);
  const grades = useSteelGrades();
  const items = useInspectionItems({ processCode: process, steelGradeId: gradeId ? Number(gradeId) : undefined });
  const remove = useMasterAction((i: InspectionItemView) => masterApi.inspectionItems.remove(i.id), '검사 항목을 삭제했어요');
  const label = PROCESSES.find((p) => p.key === process)?.label ?? '';

  return (
    <section className="hl-card md-card">
      <CardHead title="검사 항목" count={items.data?.length} sub="성분(화학성분) 검사는 강종·성분 탭의 성분 규격을 써요">
        <div className="hl-seg" role="group" aria-label="공정">
          {PROCESSES.map((p) => <button key={p.key} type="button" className={process === p.key ? 'is-on' : undefined} onClick={() => setProcess(p.key)}>{p.label}</button>)}
        </div>
        <SelectBox value={gradeId} onChange={setGradeId} label="강종" style={{ width: 150 }}>
          <option value="">강종 전체</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.steelGradeCode}</option>)}
        </SelectBox>
        {!canEdit ? <LockHint /> : null}
        <AddButton canEdit={canEdit} onClick={() => setEditing('new')}>항목 추가</AddButton>
      </CardHead>
      <QueryBoundary query={items}>
        {(rows) => (
          <div className="md-scroll">
            <table className="hl-table hl-table--compact">
              <thead><tr><th>적용 강종</th><th>항목 코드</th><th>항목명</th><th>단위</th><th className="num">최소</th><th className="num">최대</th><th>필수</th><th className="num">순서</th><th className="num" /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td>{i.steelGradeCode ? <span className="mono">{i.steelGradeCode}</span> : <span className="hl-tag">공통</span>}</td>
                    <td className="mono">{i.inspectionItemCode}</td>
                    <td>{i.inspectionItemName}</td>
                    <td className="hl-ink2">{i.unit ?? '–'}</td>
                    <td className="num">{i.minValue ?? <span className="hl-muted">–</span>}</td>
                    <td className="num">{i.maxValue ?? <span className="hl-muted">–</span>}</td>
                    <td>{i.isRequired ? <Badge tone="ok">필수</Badge> : <span className="hl-muted">선택</span>}</td>
                    <td className="num tnum">{i.sortOrder}</td>
                    <td className="num">
                      <span className="hl-row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <EditButton label={i.inspectionItemName} canEdit={canEdit} onClick={() => setEditing(i)} />
                        <DeleteButton label={i.inspectionItemName} canEdit={canEdit} pending={remove.isPending} onConfirm={() => remove.mutate(i)} />
                      </span>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={9}><EmptyNote>{label}에 등록된 검사 항목이 없어요</EmptyNote></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>
      <div className="hl-card__foot"><span className="hl-cap">강종을 고르면 그 강종 전용 항목과 공통 항목을 함께 보여줘요 · 최소·최대는 경계값을 포함해요 · 지워도 이미 판정한 검사 결과는 그대로예요</span></div>
      {editing ? <InspectionModal item={editing === 'new' ? null : editing} process={process} defaultGradeId={gradeId} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function InspectionModal({ item, process, defaultGradeId, onClose }: { item: InspectionItemView | null; process: InspectionProcess; defaultGradeId: string; onClose: () => void }) {
  const editing = !!item;
  const grades = useSteelGrades({ active: 'true' });
  const [gradeId, setGradeId] = useState(item ? (item.steelGradeId ? String(item.steelGradeId) : '') : defaultGradeId);
  const [code, setCode] = useState(item?.inspectionItemCode ?? '');
  const [name, setName] = useState(item?.inspectionItemName ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [min, setMin] = useState(item?.minValue ?? '');
  const [max, setMax] = useState(item?.maxValue ?? '');
  const [required, setRequired] = useState(item?.isRequired ?? true);
  const [sort, setSort] = useState(String(item?.sortOrder ?? 0));
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMasterAction(masterApi.inspectionItems.create, '검사 항목을 추가했어요', onClose);
  const update = useMasterAction(masterApi.inspectionItems.update, '검사 항목을 저장했어요', onClose);

  const minN = parseOptDec(min, 4);
  const maxN = parseOptDec(max, 4);
  const sortN = Number(sort);
  const errors = {
    code: CODE_RE.test(code) ? null : '영문 대문자로 시작, 대문자·숫자·밑줄 50자 이내 (예: TENSILE_STRENGTH)',
    name: name.trim() ? null : '항목명을 입력해 주세요',
    range:
      minN === undefined || maxN === undefined ? '최소·최대는 소수 4자리까지 숫자로 입력해 주세요'
        : minN === null && maxN === null ? '최소값·최대값 중 하나는 입력해 주세요'
        : minN !== null && maxN !== null && minN > maxN ? '최소값이 최대값보다 클 수 없어요' : null,
    sort: sort.trim() !== '' && Number.isInteger(sortN) && sortN >= 0 ? null : '순서는 0 이상의 정수예요',
  };
  const submit = () => {
    setTried(true);
    setServerError(null);
    if ((!editing && errors.code) || errors.name || errors.range || errors.sort) return;
    const opts = { onError: (e: unknown) => setServerError(errMsg(e)) };
    const common = { inspectionItemName: name.trim(), unit: unit.trim() || null, minValue: minN ?? null, maxValue: maxN ?? null, isRequired: required, sortOrder: sortN };
    if (item) update.mutate({ id: item.id, ...common, }, opts);
    else create.mutate({ processCode: process, steelGradeId: gradeId ? Number(gradeId) : null, inspectionItemCode: code, ...common }, opts);
  };

  return (
    <Modal title={editing ? `검사 항목 수정 · ${item.inspectionItemCode}` : '검사 항목 추가'} onClose={onClose} width={560} footer={<FormFooter error={serverError} onClose={onClose} onSubmit={submit} pending={create.isPending || update.isPending} submitLabel={editing ? '저장' : '추가'} />}>
      <div className="hl-row" style={{ gap: 8 }}>
        <span className="hl-cap">공정</span>
        <b>{PROCESSES.find((p) => p.key === (item?.processCode ?? process))?.label}</b>
        {editing ? <span className="hl-cap">공정·강종·항목 코드는 바꿀 수 없어요</span> : null}
      </div>
      <Field label="적용 강종" hint="공통을 고르면 모든 강종에 적용돼요">
        <SelectBox value={gradeId} onChange={setGradeId} disabled={editing}>
          <option value="">공통 (모든 강종)</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.steelGradeCode} · {g.steelGradeName}</option>)}
          {item?.steelGradeId && !grades.data?.some((g) => g.id === item.steelGradeId) ? <option value={item.steelGradeId}>{item.steelGradeCode}</option> : null}
        </SelectBox>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <Field label={<>항목 코드<span className="req">*</span></>} error={tried && !editing ? errors.code : null}>
          <input className="hl-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} readOnly={editing} placeholder="TENSILE_STRENGTH" maxLength={50} />
        </Field>
        <Field label={<>항목명<span className="req">*</span></>} error={tried ? errors.name : null}>
          <input className="hl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="인장강도" maxLength={50} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Field label="단위"><input className="hl-input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="MPa" maxLength={20} /></Field>
        <Field label="최소값"><input className="hl-input num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="–" /></Field>
        <Field label="최대값"><input className="hl-input num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="–" /></Field>
      </div>
      {tried && errors.range ? <span className="hl-cap hl-danger-text" role="alert">{errors.range}</span> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
        <Field label="순서" error={tried ? errors.sort : null} hint="작은 수가 먼저 나와요"><input className="hl-input num" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
        <label className="hl-row" style={{ gap: 8, fontSize: 13, height: 32 }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          필수 검사 항목
        </label>
      </div>
    </Modal>
  );
}
