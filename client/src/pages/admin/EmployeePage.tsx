// 사용자 (REQ-AUTH-002). v1 B안 39번: 왼쪽 사원 목록 | 오른쪽 상세, 등록·수정은 오른쪽 서랍.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ROLE_CODES, ROLE_CODE_LABEL, EMPLOYEE_STATUS_LABEL, type EmployeeStatus, type RoleCode } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { employeeApi, type EmployeeView, type ListEmployeesQuery } from '@/api/organization';
import { Badge, EmptyNote, Icon, Modal, Field, Spinner, StateView } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { canUse, canView, useMe } from '@/stores/auth';
import { EmployeeDrawer } from '@/features/admin/EmployeeDrawer';
import { RolePermissionSummary } from '@/features/admin/RolePermissionSummary';
import { avatarCls, roleLabel, statusLabel, statusTone, useDepartments, useEmployeeList, useRoles, flattenDepartments } from '@/features/admin/organizationHooks';

const STATUSES: EmployeeStatus[] = ['ACTIVE', 'INACTIVE', 'LOCKED'];

export function EmployeePage() {
  const me = useMe();
  const canManage = canUse(me, 'EMPLOYEE_MANAGE');
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [kwQuery, setKwQuery] = useState('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [roleCode, setRoleCode] = useState<RoleCode | ''>('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const [drawer, setDrawer] = useState<'create' | 'edit' | null>(null);
  const [pwTarget, setPwTarget] = useState<EmployeeView | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setKwQuery(keyword.trim()), 250);
    return () => clearTimeout(t);
  }, [keyword]);

  const filters: ListEmployeesQuery = {
    ...(departmentId !== '' ? { departmentId } : {}),
    ...(roleCode ? { roleCode } : {}),
    ...(status ? { employeeStatus: status } : {}),
    ...(kwQuery ? { keyword: kwQuery } : {}),
  };
  const filtered = Object.keys(filters).length > 0;
  const all = useEmployeeList({});
  const list = useEmployeeList(filters);
  const departments = useDepartments();
  const roles = useRoles();

  const rows = list.data ?? [];
  const selId = Number(params.get('user')) || null;
  const sel = rows.find((r) => r.id === selId) ?? rows.find((r) => r.employeeStatus === 'LOCKED') ?? rows[0];
  const select = (id: number) => setParams((p) => { const n = new URLSearchParams(p); n.set('user', String(id)); return n; }, { replace: true });

  const total = all.data?.length ?? 0;
  const lockedCount = (all.data ?? []).filter((e) => e.employeeStatus === 'LOCKED').length;
  const deptOptions = useMemo(() => flattenDepartments(departments.data ?? []), [departments.data]);

  return (
    <>
      <section className="hl-master" aria-label="사원 목록">
        <div className="hl-master__head">
          <div className="hl-row">
            <b style={{ fontSize: 14 }}>사용자</b>
            <span className="hl-tag">{filtered ? `${rows.length} / ${total}` : total}</span>
            <button type="button" className="hl-btn hl-btn--primary hl-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setDrawer('create')} disabled={!canManage} title={canManage ? undefined : '권한이 필요해요'}>
              <Icon name="plus" />
              사원 등록
            </button>
          </div>
          <label className="hl-inputwrap">
            <Icon name="search" size="sm" />
            <input className="hl-input" type="search" placeholder="이름·사원번호" aria-label="사원 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </label>
          <div className="hl-row">
            <label className="hl-selectwrap hl-grow">
              <select className="hl-input" aria-label="역할" value={roleCode} onChange={(e) => setRoleCode(e.target.value as RoleCode | '')}>
                <option value="">역할: 전체</option>
                {ROLE_CODES.map((r) => <option key={r} value={r}>{ROLE_CODE_LABEL[r]}</option>)}
              </select>
              <Icon name="chevron-down" size="sm" />
            </label>
            <label className="hl-selectwrap hl-grow">
              <select className="hl-input" aria-label="부서" value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">부서: 전체</option>
                {deptOptions.map((d) => <option key={d.dept.id} value={d.dept.id}>{d.label}</option>)}
              </select>
              <Icon name="chevron-down" size="sm" />
            </label>
          </div>
          <div className="hl-seg" role="group" aria-label="상태" style={{ alignSelf: 'flex-start' }}>
            <button type="button" className={status === '' ? 'is-on' : undefined} onClick={() => setStatus('')}>전체</button>
            {STATUSES.map((s) => <button key={s} type="button" className={status === s ? 'is-on' : undefined} onClick={() => setStatus(s)}>{EMPLOYEE_STATUS_LABEL[s]}</button>)}
          </div>
        </div>
        <div className="hl-master__list">
          {list.isLoading && !list.data ? <div style={{ padding: 16 }}><Spinner /></div> : null}
          {list.error && !list.data ? <StateView kind={list.error instanceof ApiError && list.error.status === 403 ? 'lock' : 'error'} text={list.error instanceof Error ? list.error.message : undefined} actions={<button type="button" className="hl-btn" onClick={() => void list.refetch()}>다시 시도</button>} /> : null}
          {rows.map((u, i) => (
            <div
              key={u.id}
              className={`hl-mitem${sel && u.id === sel.id ? ' is-active' : ''}`}
              style={{ padding: '8px 16px', gap: 2, ...(i === rows.length - 1 ? { borderBottom: 0 } : {}) }}
              role="button"
              tabIndex={0}
              onClick={() => select(u.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') select(u.id); }}
            >
              <div className="hl-row">
                <span className={`hl-avatar${avatarCls(u.roleCode)} hl-avatar--sm`}>{u.employeeName.slice(0, 1)}</span>
                <b className={u.employeeStatus === 'INACTIVE' ? 'hl-muted' : undefined}>{u.employeeName}</b>
                <span className="hl-role">{roleLabel(u.roleCode, u.roleName)}</span>
                {u.isDepartmentHead ? <Badge tone="run">부서장</Badge> : null}
                <span style={{ marginLeft: 'auto' }}><Badge tone={statusTone(u.employeeStatus)}>{statusLabel(u.employeeStatus)}</Badge></span>
              </div>
              <span className={`hl-cap${u.employeeStatus === 'LOCKED' ? ' hl-danger-text' : ''}`} style={{ paddingLeft: 30 }}>
                {u.departmentName} · {u.employeeNo}{u.employeeStatus === 'LOCKED' ? ` · 로그인 ${u.failedLoginCount}회 실패` : u.lastLoginAt ? ` · 최근 ${fmtDateTime(u.lastLoginAt)}` : ''}
              </span>
            </div>
          ))}
          {list.data && !rows.length ? <EmptyNote>조건에 맞는 사원이 없어요</EmptyNote> : null}
        </div>
      </section>
      <main className="hl-main">
        {sel ? (
          <EmployeeDetail
            key={sel.id}
            emp={sel}
            meId={me.employeeId}
            canManage={canManage}
            canOrg={canView(me, 'ORG_MANAGE')}
            roles={roles.data}
            summary={`${total}명 · 잠김 ${lockedCount}`}
            onEdit={() => setDrawer('edit')}
            onResetPassword={() => setPwTarget(sel)}
          />
        ) : list.data ? (
          <StateView kind="empty" title="사원을 골라 주세요" text={filtered ? '조건에 맞는 사원이 없어요. 검색 조건을 바꿔 보세요' : '등록된 사원이 없어요'} />
        ) : null}
      </main>
      {drawer && departments.data && roles.data && (drawer === 'create' || sel) ? (
        <EmployeeDrawer
          key={`${drawer}-${drawer === 'edit' ? sel?.id : 'new'}`}
          target={drawer === 'edit' ? sel : undefined}
          me={me}
          departments={departments.data}
          roles={roles.data}
          canManage={canManage}
          onClose={() => setDrawer(null)}
          onSaved={(id) => { setDrawer(null); select(id); }}
        />
      ) : null}
      {pwTarget ? <ResetPasswordModal emp={pwTarget} onClose={() => setPwTarget(null)} /> : null}
    </>
  );
}

function EmployeeDetail({ emp, meId, canManage, canOrg, roles, summary, onEdit, onResetPassword }: { emp: EmployeeView; meId: number; canManage: boolean; canOrg: boolean; roles: ReturnType<typeof useRoles>['data']; summary: string; onEdit: () => void; onResetPassword: () => void }) {
  const departments = useDepartments();
  const role = roles?.find((r) => r.id === emp.roleId);
  const headOf = (departments.data ?? []).filter((d) => d.headEmployeeId === emp.id);
  const unlock = useAction(employeeApi.unlock, { success: '잠금을 풀었어요', invalidate: ['employees'] });
  const reactivate = useAction(employeeApi.update, { success: '다시 사용하도록 바꿨어요', invalidate: ['employees', 'departments'] });
  const locked = emp.employeeStatus === 'LOCKED';
  const inactive = emp.employeeStatus === 'INACTIVE';
  const lockTitle = canManage ? undefined : '권한이 필요해요';

  return (
    <>
      <div className="hl-row" style={{ gap: 12, flex: 'none' }}>
        <span className={`hl-avatar${avatarCls(emp.roleCode)} hl-avatar--lg`}>{emp.employeeName.slice(0, 1)}</span>
        <div className="hl-col">
          <div className="hl-row">
            <h1 className="hl-title">{emp.employeeName}</h1>
            <span className="hl-role">{roleLabel(emp.roleCode, emp.roleName)}</span>
            <Badge tone={statusTone(emp.employeeStatus)}>{statusLabel(emp.employeeStatus)}</Badge>
            {emp.isDepartmentHead ? <Badge tone="run" title="구매요청의 승인권자예요">부서장</Badge> : null}
            {emp.id === meId ? <span className="hl-tag">나</span> : null}
          </div>
          <span className="hl-cap">{emp.departmentName} · {emp.jobGrade} · 사원번호 {emp.employeeNo}{emp.email ? ` · ${emp.email}` : ''}</span>
        </div>
        <div className="hl-page-head__actions">
          <span className="hl-cap">{summary}</span>
          {canOrg ? <Link className="hl-btn" to="/admin/organization"><Icon name="key" />부서·권한</Link> : null}
          {!canManage ? <span className="hl-lockhint"><Icon name="lock" size="sm" />권한 필요</span> : null}
          <button type="button" className="hl-btn" onClick={onResetPassword} disabled={!canManage} title={lockTitle}><Icon name="key" />비밀번호 재설정</button>
          <button type="button" className="hl-btn" onClick={onEdit} disabled={!canManage} title={lockTitle}><Icon name="edit" />정보 수정</button>
        </div>
      </div>
      {locked ? (
        <div className="hl-banner hl-banner--danger" style={{ flex: 'none' }}>
          <Icon name="lock" />
          <div>
            <b>로그인 {emp.failedLoginCount}회 실패로 계정이 잠겼어요</b>
            <br />
            {emp.lastLoginAt ? `${fmtDateTime(emp.lastLoginAt)} 최근 접속 · ` : ''}잠금을 풀면 바로 다시 로그인할 수 있어요. 비밀번호를 잊었다면 재설정도 해 주세요
          </div>
          <div className="hl-banner__actions">
            <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" disabled={!canManage || unlock.isPending} title={lockTitle} onClick={() => unlock.mutate(emp.id)}>
              <Icon name="lock" />
              잠금 해제
            </button>
          </div>
        </div>
      ) : inactive ? (
        <div className="hl-banner" style={{ flex: 'none' }}>
          <Icon name="info" />
          <div>
            <b>사용 중지된 계정이에요</b>
            <br />
            로그인할 수 없고 조직도·담당자 목록에서 빠져요
          </div>
          <div className="hl-banner__actions">
            <button type="button" className="hl-btn hl-btn--sm" disabled={!canManage || reactivate.isPending} title={lockTitle} onClick={() => reactivate.mutate({ id: emp.id, employeeStatus: 'ACTIVE' })}>
              다시 사용
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, flex: 'none' }}>
        <section className="hl-card">
          <header className="hl-card__head"><h3>계정 정보</h3></header>
          <div className="hl-card__body">
            <dl className="hl-kv">
              <dt>사원번호</dt><dd className="mono">{emp.employeeNo}</dd>
              <dt>이메일</dt><dd>{emp.email ?? '-'}</dd>
              <dt>역할</dt><dd>{roleLabel(emp.roleCode, emp.roleName)}</dd>
              <dt>부서</dt><dd>{emp.departmentName}</dd>
              <dt>직급</dt><dd>{emp.jobGrade}</dd>
              <dt>등록일</dt><dd className="tnum">{fmtDate(emp.createdAt)}</dd>
              <dt>최근 접속</dt><dd className="tnum">{emp.lastLoginAt ? fmtDateTime(emp.lastLoginAt) : '접속 기록 없음'}</dd>
              <dt>상태</dt>
              {locked ? <dd className="hl-danger-text">잠김 (로그인 {emp.failedLoginCount}회 실패)</dd> : inactive ? <dd>사용 중지</dd> : <dd>사용{emp.failedLoginCount ? ` · 로그인 실패 ${emp.failedLoginCount}회` : ''}</dd>}
            </dl>
          </div>
        </section>
        <section className="hl-card">
          <header className="hl-card__head"><h3>역할 권한</h3><span className="hl-cap">{roleLabel(emp.roleCode, emp.roleName)} 역할</span></header>
          <div className="hl-card__body" style={{ gap: 8 }}>
            <RolePermissionSummary role={role} />
            {canOrg ? <Link className="hl-cap" to={`/admin/organization?tab=permissions&role=${emp.roleCode}`} style={{ color: '#1F5FCC' }}>행렬에서 보기</Link> : null}
          </div>
        </section>
      </div>
      <section className="hl-card" style={{ flex: 'none' }}>
        <header className="hl-card__head"><Icon name="approve" /><h3>부서장 지정</h3></header>
        <div className="hl-card__body" style={{ gap: 6 }}>
          {headOf.length ? (
            <>
              <div className="hl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {headOf.map((d) => <Badge key={d.id} tone="run">{d.departmentName} 부서장</Badge>)}
              </div>
              <span className="hl-cap">부서장은 그 부서 사원이 올린 구매요청의 승인권자예요. 부서장을 바꾸려면 부서·권한 화면에서 지정해 주세요.</span>
            </>
          ) : (
            <span className="hl-cap">부서장으로 지정된 부서가 없어요{departments.isLoading ? ' · 불러오는 중…' : ''}</span>
          )}
        </div>
      </section>
    </>
  );
}

function ResetPasswordModal({ emp, onClose }: { emp: EmployeeView; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useAction(employeeApi.resetPassword, { success: '비밀번호를 바꿨어요', invalidate: ['employees'], onSuccess: onClose });
  const bad = pw.length < 8 || pw.length > 72;
  const submit = () => {
    setError(null);
    if (bad) return setError('비밀번호는 8~72자로 입력해 주세요');
    reset.mutate({ id: emp.id, newPassword: pw }, { onError: (e) => setError(e instanceof Error ? e.message : '바꾸지 못했어요') });
  };
  return (
    <Modal
      title="비밀번호 재설정"
      onClose={onClose}
      width={460}
      footer={(
        <>
          <button type="button" className="hl-btn" onClick={onClose}>취소</button>
          <button type="button" className="hl-btn hl-btn--primary" onClick={submit} disabled={reset.isPending}>{reset.isPending ? '바꾸는 중…' : '비밀번호 바꾸기'}</button>
        </>
      )}
    >
      <p style={{ margin: 0, fontSize: 13, lineHeight: '19px' }}>{emp.employeeName}({emp.employeeNo})님의 새 비밀번호를 정해 주세요. 서버가 임시 비밀번호를 만들지 않으니 정한 비밀번호를 직접 전달해 주세요. 계정 상태와 로그인 실패 횟수는 그대로예요.</p>
      <Field label="새 비밀번호" hint="8~72자" error={error}>
        <span className="hl-inputwrap">
          <input className={`hl-input${error ? ' is-error' : ''}`} type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={72} autoFocus style={{ paddingRight: 56 }} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button type="button" className="hl-suffix" style={{ border: 0, background: 'transparent', padding: 0 }} onClick={() => setShow((v) => !v)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>{show ? '숨기기' : '보기'}</button>
        </span>
      </Field>
    </Modal>
  );
}
