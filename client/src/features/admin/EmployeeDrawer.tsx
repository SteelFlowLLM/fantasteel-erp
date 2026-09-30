// 사원 등록·수정 서랍 (v1 39번 B안의 오른쪽 서랍). 서버 규칙(본인 역할·상태 변경 금지, 부서장 사용 중지 금지)은 컨트롤을 막고 짧은 안내를 붙인다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { AuthUser } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { employeeApi, type DepartmentView, type EmployeeView, type RoleView, type UpdateEmployeeBody } from '@/api/organization';
import { Icon } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { canView } from '@/stores/auth';
import { flattenDepartments, roleLabel } from './organizationHooks';
import { RolePermissionSummary, summarizeRole } from './RolePermissionSummary';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  /** 수정할 사원. 없으면 새로 등록한다. */
  target?: EmployeeView;
  me: AuthUser;
  departments: DepartmentView[];
  roles: RoleView[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}

export function EmployeeDrawer({ target, me, departments, roles, canManage, onClose, onSaved }: Props) {
  const editing = !!target;
  const self = !!target && target.id === me.employeeId;
  const [employeeNo, setEmployeeNo] = useState('');
  const [name, setName] = useState(target?.employeeName ?? '');
  const [email, setEmail] = useState(target?.email ?? '');
  const [departmentId, setDepartmentId] = useState<number | ''>(target?.departmentId ?? '');
  const [roleId, setRoleId] = useState<number | ''>(target?.roleId ?? '');
  const [jobGrade, setJobGrade] = useState(target?.jobGrade ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(target?.employeeStatus === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const deptOptions = useMemo(() => flattenDepartments(departments), [departments]);
  const selectedRole = roles.find((r) => r.id === roleId);

  const create = useAction(employeeApi.create, { success: '사원을 등록했어요', invalidate: ['employees', 'departments'], onSuccess: (e) => onSaved(e.id) });
  const update = useAction(employeeApi.update, { success: '사원 정보를 저장했어요', invalidate: ['employees', 'departments'], onSuccess: (e) => onSaved(e.id) });
  const pending = create.isPending || update.isPending;
  const fail = (e: unknown) => setServerError(e instanceof ApiError ? e.message : '저장하지 못했어요');

  const errors = {
    employeeNo: !editing && !/^\d{7}$/.test(employeeNo) ? '사원번호는 숫자 7자리로 입력해 주세요' : null,
    name: !name.trim() || name.trim().length > 50 ? '이름은 1~50자로 입력해 주세요' : null,
    jobGrade: !jobGrade.trim() || jobGrade.trim().length > 20 ? '직급은 1~20자로 입력해 주세요' : null,
    email: email.trim() && !EMAIL_RE.test(email.trim()) ? '이메일 형식이 아니에요' : null,
    department: departmentId === '' ? '부서를 선택해 주세요' : null,
    role: roleId === '' ? '역할을 선택해 주세요' : null,
    password: !editing && (password.length < 8 || password.length > 72) ? '초기 비밀번호는 8~72자로 입력해 주세요' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = () => {
    setTried(true);
    setServerError(null);
    if (invalid || departmentId === '' || roleId === '') return;
    if (!editing) {
      create.mutate(
        { employeeNo, employeeName: name.trim(), departmentId, roleId, jobGrade: jobGrade.trim(), ...(email.trim() ? { email: email.trim() } : {}), initialPassword: password },
        { onError: fail },
      );
      return;
    }
    const body: UpdateEmployeeBody = {};
    if (name.trim() !== target.employeeName) body.employeeName = name.trim();
    if (departmentId !== target.departmentId) body.departmentId = departmentId;
    if (roleId !== target.roleId) body.roleId = roleId;
    if (jobGrade.trim() !== target.jobGrade) body.jobGrade = jobGrade.trim();
    if ((email.trim() || null) !== target.email) body.email = email.trim() || null;
    if (target.employeeStatus !== 'LOCKED' && status !== target.employeeStatus) body.employeeStatus = status;
    if (!Object.keys(body).length) {
      setServerError('바뀐 내용이 없어요');
      return;
    }
    update.mutate({ id: target.id, ...body }, { onError: fail });
  };

  const isHead = !!target?.isDepartmentHead;
  const title = editing ? '사원 정보 수정' : '사원 등록';
  const err = (k: keyof typeof errors) => (tried ? errors[k] : null);

  return (
    <div className="hl-scrim hl" style={{ justifyContent: 'flex-end', alignItems: 'stretch' }} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="hl-card" style={{ width: 540, maxWidth: '100%', borderRadius: 0, border: 0, boxShadow: '0 12px 32px rgba(18,24,32,0.18)' }}>
        <header className="hl-card__head" style={{ height: 60, padding: '0 20px' }}>
          <i className="ic ic-users" style={{ color: '#173A5E' }} aria-hidden="true" />
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <span className="hl-cap">{target ? `${target.employeeName} · 사원번호 ${target.employeeNo}` : '역할이 메뉴와 업무 권한을 정해요'}</span>
          <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }} aria-label="닫기" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="hl-card__body" style={{ padding: '16px 20px', gap: 12, flex: 1, overflow: 'auto' }}>
          {!canManage ? (
            <div className="hl-banner" style={{ alignItems: 'center' }}><Icon name="lock" /><div>사원 관리 사용 권한이 있어야 저장할 수 있어요</div></div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="hl-field">
              <span className="hl-field__label">이름<span className="req">*</span></span>
              <input className={`hl-input${err('name') ? ' is-error' : ''}`} type="text" placeholder="예: 홍길동" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} autoFocus />
              {err('name') ? <span className="hl-field__hint hl-danger-text">{err('name')}</span> : null}
            </label>
            <label className="hl-field">
              <span className="hl-field__label">사원번호<span className="req">*</span></span>
              <input className={`hl-input mono${err('employeeNo') ? ' is-error' : ''}`} type="text" inputMode="numeric" placeholder="숫자 7자리" maxLength={7} value={editing ? target.employeeNo : employeeNo} readOnly={editing} onChange={(e) => setEmployeeNo(e.target.value.replace(/\D/g, ''))} />
              {editing ? <span className="hl-field__hint">사원번호는 바꿀 수 없어요</span> : err('employeeNo') ? <span className="hl-field__hint hl-danger-text">{err('employeeNo')}</span> : <span className="hl-field__hint">로그인 ID로 쓰여요</span>}
            </label>
          </div>
          <label className="hl-field">
            <span className="hl-field__label">이메일</span>
            <input className={`hl-input${err('email') ? ' is-error' : ''}`} type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {err('email') ? <span className="hl-field__hint hl-danger-text">{err('email')}</span> : null}
          </label>
          <div className="hl-field" style={{ gap: 6 }} role="radiogroup" aria-label="역할 선택">
            <span className="hl-field__label">역할 선택<span className="req">*</span></span>
            {roles.map((r) => {
              const s = summarizeRole(r);
              const off = self;
              return (
                <label key={r.id} className={`hl-radio-card${roleId === r.id ? ' is-on' : ''}`} style={{ padding: '8px 12px', alignItems: 'center', ...(off ? { opacity: 0.55, cursor: 'not-allowed' } : {}) }}>
                  <input type="radio" name="employee-role" aria-label={r.roleName} checked={roleId === r.id} onChange={() => setRoleId(r.id)} disabled={off} />
                  <span className="hl-role" style={{ width: 52, justifyContent: 'center' }}>{roleLabel(r.roleCode, r.roleName)}</span>
                  <span style={{ fontSize: 12, color: '#3F4A57' }}>사용 {s.use.length} · 조회 {s.view.length}</span>
                  {roleId === r.id ? <span className="hl-cap" style={{ marginLeft: 'auto' }}>선택됨</span> : null}
                </label>
              );
            })}
            {self ? <span className="hl-field__hint">내 계정의 역할은 바꿀 수 없어요</span> : err('role') ? <span className="hl-field__hint hl-danger-text">{err('role')}</span> : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
            <label className="hl-field">
              <span className="hl-field__label">부서<span className="req">*</span></span>
              <span className="hl-selectwrap">
                <select className={`hl-input${err('department') ? ' is-error' : ''}`} value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">부서 선택</option>
                  {deptOptions.map((d) => <option key={d.dept.id} value={d.dept.id}>{d.label}</option>)}
                </select>
                <i className="ic ic-chevron-down ic--sm" aria-hidden="true" />
              </span>
              {err('department') ? <span className="hl-field__hint hl-danger-text">{err('department')}</span> : null}
            </label>
            <label className="hl-field">
              <span className="hl-field__label">직급<span className="req">*</span></span>
              <input className={`hl-input${err('jobGrade') ? ' is-error' : ''}`} type="text" placeholder="예: 대리" maxLength={20} value={jobGrade} onChange={(e) => setJobGrade(e.target.value)} />
              {err('jobGrade') ? <span className="hl-field__hint hl-danger-text">{err('jobGrade')}</span> : null}
            </label>
          </div>
          {editing ? (
            <div className="hl-field">
              <span className="hl-field__label">사용 상태</span>
              <div className="hl-row" style={{ gap: 8 }}>
                <div className="hl-seg" style={{ flex: 'none' }}>
                  <button type="button" className={status === 'ACTIVE' && target.employeeStatus !== 'LOCKED' ? 'is-on' : undefined} onClick={() => setStatus('ACTIVE')} disabled={target.employeeStatus === 'LOCKED'}>사용</button>
                  <button type="button" className={status === 'INACTIVE' ? 'is-on' : undefined} onClick={() => setStatus('INACTIVE')} disabled={self || isHead || target.employeeStatus === 'LOCKED'}>사용 중지</button>
                  {target.employeeStatus === 'LOCKED' ? <button type="button" className="is-on" disabled>잠김</button> : null}
                </div>
              </div>
              {target.employeeStatus === 'LOCKED' ? (
                <span className="hl-field__hint">잠긴 계정은 상세 화면의 &lsquo;잠금 해제&rsquo;로 풀어 주세요</span>
              ) : self ? (
                <span className="hl-field__hint">내 계정은 사용 중지할 수 없어요</span>
              ) : isHead ? (
                <span className="hl-field__hint">부서장이라 사용 중지할 수 없어요 · 부서·권한에서 부서장을 먼저 바꿔 주세요</span>
              ) : (
                <span className="hl-field__hint">사용 중지하면 로그인할 수 없고 조직도·담당자 목록에서 빠져요</span>
              )}
            </div>
          ) : (
            <label className="hl-field">
              <span className="hl-field__label">초기 비밀번호<span className="req">*</span></span>
              <span className="hl-inputwrap">
                <input className={`hl-input${err('password') ? ' is-error' : ''}`} type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="8자 이상" maxLength={72} style={{ paddingRight: 56 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="hl-suffix" style={{ border: 0, background: 'transparent', padding: 0 }} onClick={() => setShowPw((v) => !v)} aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}>{showPw ? '숨기기' : '보기'}</button>
              </span>
              {err('password') ? <span className="hl-field__hint hl-danger-text">{err('password')}</span> : <span className="hl-field__hint">사원에게 직접 전달해 주세요 · 서버에는 암호화해서 저장돼요</span>}
            </label>
          )}
          <div className="hl-col" style={{ gap: 6, padding: '10px 12px', border: '1px solid #DDE2E7', borderRadius: 6, background: '#F7F8FA' }}>
            <div className="hl-row">
              <span className="hl-label">권한 미리보기</span>
              {selectedRole ? <span className="hl-role">{roleLabel(selectedRole.roleCode, selectedRole.roleName)}</span> : null}
              {selectedRole && canView(me, 'ORG_MANAGE') ? <Link className="hl-cap" to={`/admin/organization?tab=permissions&role=${selectedRole.roleCode}`} style={{ marginLeft: 'auto', color: '#1F5FCC' }}>행렬에서 보기</Link> : null}
            </div>
            {selectedRole ? <RolePermissionSummary role={selectedRole} /> : <span className="hl-cap">역할을 고르면 권한이 보여요</span>}
            <span className="hl-cap">구매요청 승인은 역할이 아니라 부서장으로 지정돼야 할 수 있어요</span>
          </div>
        </div>
        <footer className="hl-card__foot" style={{ padding: '12px 20px', borderRadius: 0 }}>
          {serverError ? <span className="hl-cap hl-danger-text" role="alert">{serverError}</span> : tried && invalid ? <span className="hl-cap hl-danger-text">빨간 표시를 확인해 주세요</span> : null}
          <button type="button" className="hl-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" onClick={submit} disabled={pending || !canManage} title={canManage ? undefined : '권한이 필요해요'}>
            <Icon name="check" />
            {pending ? '저장 중…' : editing ? '저장' : '등록'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
