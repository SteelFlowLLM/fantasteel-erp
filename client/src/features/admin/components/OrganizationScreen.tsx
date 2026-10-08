'use client';

// 부서·직급·권한 /admin/organization (REQ-AUTH-002·003, REQ-ORG-001~003): 탭 부서 · 직급 · 권한 · 조직도.
// 부서·권한 관리(ORG_MANAGE) 사용 권한이 없으면 조회만 한다. 탭은 주소 ?tab=, 권한 탭의 강조 역할은 ?role=.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PERMISSION, ROLE, type RoleCode } from '@/codes';
import { Badge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { PageMain } from '@/components/Page';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { Tabs } from '@/components/Tabs';
import { DepartmentTab } from '@/features/admin/components/DepartmentTab';
import { JobGradeTab } from '@/features/admin/components/JobGradeTab';
import { OrgChartTab } from '@/features/admin/components/OrgChartTab';
import { PermissionMatrixTab } from '@/features/admin/components/PermissionMatrixTab';
import { changedCellsOf, levelsOf, type MatrixDraft } from '@/features/admin/lib/permissionMatrix';
import { useDepartmentList, useJobGradeList, useRoleList } from '@/hooks/useDirectory';
import { useCanUse, useCanView } from '@/hooks/usePermission';

const TAB_KEYS = ['departments', 'job-grades', 'permissions', 'org-chart'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const SUBTITLE: Record<TabKey, string> = {
  departments: '부서를 계층으로 관리하고 부서장을 지정해요',
  'job-grades': '직급과 조직도 표시 순서를 정해요',
  permissions: '역할이 할 수 있는 일을 정해요 · 칸을 누르면 사용 → 조회 → 없음 순으로 바뀌어요',
  'org-chart': '부서별 인원과 부서장을 한눈에 봐요',
};

const isTabKey = (value: string | null): value is TabKey => (TAB_KEYS as readonly string[]).includes(value ?? '');
const isRoleCode = (value: string | null): value is RoleCode => (Object.values(ROLE) as string[]).includes(value ?? '');

export function OrganizationScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const roleParam = params.get('role');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'departments';
  const highlightRole = isRoleCode(roleParam) ? roleParam : null;

  const canEdit = useCanUse(PERMISSION.ORG_MANAGE);
  const canViewEmployees = useCanView(PERMISSION.EMPLOYEE_MANAGE);
  const departments = useDepartmentList();
  const jobGrades = useJobGradeList();
  const roles = useRoleList();
  // 권한 탭의 저장 전 변경. 다른 탭을 보고 와도 남는다.
  const [draft, setDraft] = useState<MatrixDraft>({});
  const changeCount = (roles.data ?? []).reduce((sum, role) => sum + changedCellsOf(levelsOf(role.permissions), draft[role.id]).length, 0);

  const changeTab = (key: TabKey) => router.replace(`${pathname}?tab=${key}`, { scroll: false });

  return (
    <PageMain>
      <div className="flex flex-none items-end gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold">부서·직급·권한</h1>
          <span className="text-cap text-ink-3">{SUBTITLE[tab]}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.ORG_MANAGE]} />}
          {canViewEmployees ? (
            <ButtonLink href="/admin/employees" icon="users">
              사원
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <Tabs
        ariaLabel="부서·직급·권한"
        active={tab}
        onChange={changeTab}
        items={[
          { key: 'departments', label: '부서', count: departments.data?.length },
          { key: 'job-grades', label: '직급', count: jobGrades.data?.length },
          {
            key: 'permissions',
            label: (
              <>
                권한
                {changeCount > 0 ? (
                  <Badge tone="wait" plain>
                    변경 {changeCount}
                  </Badge>
                ) : null}
              </>
            ),
          },
          { key: 'org-chart', label: '조직도' },
        ]}
      />
      {tab === 'departments' ? <DepartmentTab canEdit={canEdit} /> : null}
      {tab === 'job-grades' ? <JobGradeTab /> : null}
      {tab === 'permissions' ? <PermissionMatrixTab canEdit={canEdit} draft={draft} onDraftChange={setDraft} highlightRole={highlightRole} /> : null}
      {tab === 'org-chart' ? <OrgChartTab /> : null}
    </PageMain>
  );
}
