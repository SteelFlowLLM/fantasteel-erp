// 부서 계층 (REQ-ORG-001·002): 부서 트리, 부서 만들기, 이름·상위 부서·부서장 바꾸기.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { departmentApi, type DepartmentView, type EmployeeDirectoryEntry, type UpdateDepartmentBody } from '@/api/organization';
import { Badge, EmptyNote, Field, Icon, Modal } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { descendantIds, flattenDepartments } from './organizationHooks';

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;

function HeadSelect({ value, onChange, directory, dept, current }: { value: number | ''; onChange: (v: number | '') => void; directory: EmployeeDirectoryEntry[]; dept?: DepartmentView; current?: { id: number; name: string } | null }) {
  const own = dept ? directory.filter((e) => e.departmentId === dept.id) : [];
  const others = directory.filter((e) => !own.includes(e));
  const opt = (e: EmployeeDirectoryEntry) => <option key={e.id} value={e.id}>{e.employeeName} · {e.jobGrade}{e.departmentId !== dept?.id ? ` · ${e.departmentName}` : ''}</option>;
  const currentMissing = current && !directory.some((e) => e.id === current.id);
  return (
    <span className="hl-selectwrap">
      <select className="hl-input" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">지정 안 함</option>
        {currentMissing && current ? <option value={current.id}>{current.name} (현재 · 사용 중인 사원 목록에 없음)</option> : null}
        {own.length ? <optgroup label="이 부서 사원">{own.map(opt)}</optgroup> : null}
        {others.length ? <optgroup label={dept ? '다른 부서 사원' : '사용 중인 사원'}>{others.map(opt)}</optgroup> : null}
      </select>
      <Icon name="chevron-down" size="sm" />
    </span>
  );
}

function ParentSelect({ value, onChange, departments, blocked }: { value: number | ''; onChange: (v: number | '') => void; departments: DepartmentView[]; blocked?: Set<number> }) {
  return (
    <span className="hl-selectwrap">
      <select className="hl-input" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">상위 부서 없음 (최상위)</option>
        {flattenDepartments(departments).map((d) => (
          <option key={d.dept.id} value={d.dept.id} disabled={blocked?.has(d.dept.id)}>{d.label}{blocked?.has(d.dept.id) ? ' (자기 자신·하위 부서)' : ''}</option>
        ))}
      </select>
      <Icon name="chevron-down" size="sm" />
    </span>
  );
}

export function DepartmentTab({ departments, directory, canEdit }: { departments: DepartmentView[]; directory: EmployeeDirectoryEntry[]; canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => flattenDepartments(departments), [departments]);
  const selId = Number(params.get('dept')) || null;
  const sel = departments.find((d) => d.id === selId) ?? rows[0]?.dept;
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('dept', String(id)); return n; }, { replace: true });

  return (
    <>
      <div className="hl-banner hl-banner--run" style={{ flex: 'none', alignItems: 'center' }}>
        <Icon name="approve" style={{ marginTop: 0 }} />
        <div>
          <b>부서장은 구매요청의 승인권자예요.</b> 사원이 올린 구매요청은 그 사원 부서의 부서장이 승인해요. 부서장이 직접 올린 요청은 상위 부서의 부서장이 승인하고, 부서장이 비어 있거나 사용 중지면 구매요청을 제출할 수 없어요.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, flex: 1, minHeight: 0 }}>
        <section className="hl-card" style={{ overflow: 'auto' }}>
          <header className="hl-card__head">
            <Icon name="building" style={{ color: '#3F4A57' }} />
            <h3>부서 계층</h3>
            <span className="hl-tag">{departments.length}</span>
            <div className="hl-card__actions">
              <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" onClick={() => setCreating(true)} disabled={!canEdit} title={canEdit ? undefined : '권한이 필요해요'}>
                <Icon name="plus" />
                부서 만들기
              </button>
            </div>
          </header>
          {rows.length ? (
            <div className="hl-master__list" style={{ overflow: 'visible' }}>
              {rows.map(({ dept: d, depth }, i) => (
                <div
                  key={d.id}
                  className={`hl-mitem${sel && d.id === sel.id ? ' is-active' : ''}`}
                  style={{ padding: '8px 16px', paddingLeft: 16 + depth * 20, gap: 2, ...(i === rows.length - 1 ? { borderBottom: 0 } : {}) }}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(d.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') select(d.id); }}
                >
                  <div className="hl-row">
                    {depth ? <span className="hl-muted" aria-hidden="true">└</span> : null}
                    <b>{d.departmentName}</b>
                    <span className="hl-cap mono">{d.departmentCode}</span>
                    <span className="hl-cap" style={{ marginLeft: 'auto' }}>{d.memberCount}명</span>
                  </div>
                  <span className="hl-cap" style={depth ? { paddingLeft: 14 } : undefined}>
                    {d.headEmployeeName ? <>부서장 <b style={{ color: 'var(--ink-2)' }}>{d.headEmployeeName}</b></> : <span className="hl-danger-text">부서장 없음</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote>등록된 부서가 없어요</EmptyNote>
          )}
        </section>
        {sel ? <DepartmentEditor key={`${sel.id}-${sel.updatedAt}`} dept={sel} departments={departments} directory={directory} canEdit={canEdit} /> : <div />}
      </div>
      {creating ? <CreateDepartmentModal departments={departments} directory={directory} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); select(id); }} /> : null}
    </>
  );
}

function DepartmentEditor({ dept, departments, directory, canEdit }: { dept: DepartmentView; departments: DepartmentView[]; directory: EmployeeDirectoryEntry[]; canEdit: boolean }) {
  const [name, setName] = useState(dept.departmentName);
  const [parentId, setParentId] = useState<number | ''>(dept.parentId ?? '');
  const [headId, setHeadId] = useState<number | ''>(dept.headEmployeeId ?? '');
  const [sortOrder, setSortOrder] = useState(String(dept.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const blocked = useMemo(() => descendantIds(departments, dept.id), [departments, dept.id]);
  const update = useAction(departmentApi.update, { success: '부서 정보를 저장했어요', invalidate: ['departments', 'employees'] });

  const sortNum = Number(sortOrder);
  const sortBad = sortOrder.trim() === '' || !Number.isInteger(sortNum);
  const nameBad = !name.trim() || name.trim().length > 50;
  const body: UpdateDepartmentBody = {};
  if (name.trim() !== dept.departmentName) body.departmentName = name.trim();
  if ((parentId === '' ? null : parentId) !== dept.parentId) body.parentId = parentId === '' ? null : parentId;
  if ((headId === '' ? null : headId) !== dept.headEmployeeId) body.headEmployeeId = headId === '' ? null : headId;
  if (!sortBad && sortNum !== dept.sortOrder) body.sortOrder = sortNum;
  const dirty = Object.keys(body).length > 0;
  const childCount = departments.filter((d) => d.parentId === dept.id).length;

  const save = () => {
    setError(null);
    if (nameBad) return setError('부서명은 1~50자로 입력해 주세요');
    if (sortBad) return setError('정렬 순서는 정수로 입력해 주세요');
    if (!dirty) return setError('바뀐 내용이 없어요');
    update.mutate({ id: dept.id, ...body }, { onError: (e) => setError(e instanceof ApiError ? e.message : '저장하지 못했어요') });
  };
  const reset = () => {
    setName(dept.departmentName); setParentId(dept.parentId ?? ''); setHeadId(dept.headEmployeeId ?? ''); setSortOrder(String(dept.sortOrder)); setError(null);
  };
  const lockTitle = canEdit ? undefined : '권한이 필요해요';

  return (
    <section className="hl-card" style={{ overflow: 'auto', alignSelf: 'start' }}>
      <header className="hl-card__head">
        <h3>{dept.departmentName}</h3>
        <span className="hl-cap mono">{dept.departmentCode}</span>
        {dept.headEmployeeName ? <Badge tone="run">부서장 {dept.headEmployeeName}</Badge> : <Badge tone="wait">부서장 없음</Badge>}
        <span className="hl-cap" style={{ marginLeft: 'auto' }}>소속 {dept.memberCount}명 · 하위 부서 {childCount}개</span>
      </header>
      <div className="hl-card__body" style={{ gap: 12 }}>
        {!canEdit ? <span className="hl-lockhint"><Icon name="lock" size="sm" />부서·권한 관리 사용 권한이 있어야 바꿀 수 있어요</span> : null}
        <Field label={<>부서명<span className="req">*</span></>}>
          <input className="hl-input" type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} title={lockTitle} />
        </Field>
        <Field label="부서 코드" hint="만든 뒤에는 바꿀 수 없어요">
          <input className="hl-input mono" type="text" value={dept.departmentCode} readOnly />
        </Field>
        <Field label="상위 부서" hint="자기 자신이나 하위 부서는 상위 부서로 지정할 수 없어요">
          <ParentSelect value={parentId} onChange={setParentId} departments={departments} blocked={blocked} />
        </Field>
        <Field label="부서장 (승인권자)" hint="사용 중인 사원만 지정할 수 있어요 · 바꾸면 작업 로그에 남아요">
          <HeadSelect value={headId} onChange={setHeadId} directory={directory} dept={dept} current={dept.headEmployeeId ? { id: dept.headEmployeeId, name: dept.headEmployeeName ?? `사원 ${dept.headEmployeeId}` } : null} />
        </Field>
        <Field label="정렬 순서" hint="같은 상위 부서 안에서 작은 수가 먼저 나와요" style={{ maxWidth: 160 }}>
          <input className="hl-input tnum" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      <footer className="hl-card__foot">
        {error ? <span className="hl-cap hl-danger-text" role="alert">{error}</span> : dirty ? <span className="hl-cap">저장 전 변경이 있어요</span> : null}
        <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={reset} disabled={!dirty || update.isPending}>되돌리기</button>
        <button type="button" className="hl-btn hl-btn--primary" onClick={save} disabled={!canEdit || update.isPending} title={lockTitle}>
          <Icon name="check" />
          {update.isPending ? '저장 중…' : '저장'}
        </button>
      </footer>
    </section>
  );
}

function CreateDepartmentModal({ departments, directory, onClose, onCreated }: { departments: DepartmentView[]; directory: EmployeeDirectoryEntry[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<number | ''>('');
  const [headId, setHeadId] = useState<number | ''>('');
  const [sortOrder, setSortOrder] = useState('0');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useAction(departmentApi.create, { success: '부서를 만들었어요', invalidate: ['departments', 'employees'], onSuccess: (d) => onCreated(d.id) });

  const errors = {
    code: CODE_RE.test(code) ? null : '영문 대문자·숫자·하이픈으로 30자 이내 (예: PRD-COKE)',
    name: name.trim() && name.trim().length <= 50 ? null : '부서명은 1~50자로 입력해 주세요',
    sort: Number.isInteger(Number(sortOrder)) && sortOrder.trim() !== '' ? null : '정렬 순서는 정수로 입력해 주세요',
  };
  const submit = () => {
    setTried(true);
    setServerError(null);
    if (Object.values(errors).some(Boolean)) return;
    create.mutate(
      { departmentCode: code, departmentName: name.trim(), parentId: parentId === '' ? null : parentId, headEmployeeId: headId === '' ? null : headId, sortOrder: Number(sortOrder) },
      { onError: (e) => setServerError(e instanceof ApiError ? e.message : '만들지 못했어요') },
    );
  };
  return (
    <Modal
      title="부서 만들기"
      onClose={onClose}
      footer={(
        <>
          {serverError ? <span className="hl-cap hl-danger-text" style={{ marginRight: 'auto' }} role="alert">{serverError}</span> : null}
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" onClick={submit} disabled={create.isPending}>{create.isPending ? '만드는 중…' : '만들기'}</button>
        </>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={<>부서명<span className="req">*</span></>} error={tried ? errors.name : null}>
          <input className="hl-input" type="text" maxLength={50} autoFocus placeholder="예: 코크스파트" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={<>부서 코드<span className="req">*</span></>} hint="만든 뒤에는 바꿀 수 없어요" error={tried ? errors.code : null}>
          <input className="hl-input mono" type="text" maxLength={30} placeholder="PRD-COKE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <Field label="상위 부서">
        <ParentSelect value={parentId} onChange={setParentId} departments={departments} />
      </Field>
      <Field label="부서장 (승인권자)" hint="나중에 지정해도 돼요. 부서장이 없으면 이 부서 사원은 구매요청을 제출할 수 없어요">
        <HeadSelect value={headId} onChange={setHeadId} directory={directory} />
      </Field>
      <Field label="정렬 순서" style={{ maxWidth: 160 }} error={tried ? errors.sort : null}>
        <input className="hl-input tnum" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </Field>
    </Modal>
  );
}
