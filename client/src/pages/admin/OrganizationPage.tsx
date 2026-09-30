// 부서·권한 (REQ-ORG-001~004, REQ-AUTH-003). 부서 계층 · 조직도 · 역할별 권한 세 영역을 탭으로 나눈다 (v1 40번 B안의 부서·역할 구성).
import { Link, useSearchParams } from 'react-router';
import { Icon, QueryBoundary, Spinner } from '@/components/ui';
import { canUse, canView, useMe } from '@/stores/auth';
import { DepartmentTab } from '@/features/admin/DepartmentTab';
import { OrgChartTab } from '@/features/admin/OrgChartTab';
import { PermissionMatrixTab, usePermissionEdits } from '@/features/admin/PermissionMatrixTab';
import { useDepartments, useDirectory, useOrgTree, useRoles } from '@/features/admin/organizationHooks';

type Tab = 'departments' | 'chart' | 'permissions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'departments', label: '부서 계층' },
  { key: 'chart', label: '조직도' },
  { key: 'permissions', label: '역할별 권한' },
];

export function OrganizationPage() {
  const me = useMe();
  const canEdit = canUse(me, 'ORG_MANAGE');
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'departments';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  const departments = useDepartments();
  const directory = useDirectory();
  const tree = useOrgTree();
  const roles = useRoles();
  const edits = usePermissionEdits(roles.data);

  const subtitle = tab === 'departments' ? '부서를 계층으로 관리하고 부서장을 지정해요' : tab === 'chart' ? '부서별 인원과 부서장을 한눈에 봐요' : '역할이 할 수 있는 일을 정해요 · 칸을 누르면 사용 → 조회 → 없음 순으로 바뀌어요';

  return (
    <main className="hl-main" style={{ minWidth: 0 }}>
      <div className="hl-row" style={{ gap: 12, flex: 'none' }}>
        <div className="hl-col">
          <h1 className="hl-title">부서·권한</h1>
          <span className="hl-cap">{subtitle}</span>
        </div>
        <div className="hl-page-head__actions">
          {canView(me, 'EMPLOYEE_MANAGE') ? <Link className="hl-btn" to="/admin/employees"><Icon name="users" />사용자</Link> : null}
          {!canEdit ? <span className="hl-lockhint"><Icon name="lock" size="sm" />조회만 할 수 있어요 · 권한 필요</span> : null}
        </div>
      </div>
      <div className="hl-tabs" role="tablist" aria-label="부서·권한 영역">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`hl-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'departments' && departments.data ? <span className="hl-tag">{departments.data.length}</span> : null}
            {t.key === 'permissions' && edits.dirtyCount ? <span className="hl-badge hl-badge--wait" title="저장하지 않은 변경이 있어요">변경 {edits.dirtyCount}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'departments' ? (
        <QueryBoundary query={departments}>
          {(depts) => (directory.data
            ? <DepartmentTab departments={depts} directory={directory.data} canEdit={canEdit} />
            : directory.error ? <QueryBoundary query={directory}>{() => null}</QueryBoundary> : <Spinner />)}
        </QueryBoundary>
      ) : null}
      {tab === 'chart' ? <QueryBoundary query={tree}>{(nodes) => <OrgChartTab tree={nodes} />}</QueryBoundary> : null}
      {tab === 'permissions' ? (
        <QueryBoundary query={roles}>
          {(rs) => <PermissionMatrixTab roles={rs} edits={edits} canEdit={canEdit} focusRole={params.get('role')} meRoleCode={me.roleCode} />}
        </QueryBoundary>
      ) : null}
    </main>
  );
}
