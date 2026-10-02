'use client';

// 조직도 탭 (REQ-ORG-003): 부서 트리와 부서별 인원(이름, 직급, 부서장 여부). 읽기 전용.
import type { OrgChartDepartmentView } from '@/api/adminOrganization';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Card } from '@/components/Card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { HeadTag } from '@/features/admin/components/OrgBadges';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { cn } from '@/lib/cn';

export function OrgChartTab() {
  const chart = useAdminOrgChart();
  return (
    <>
      <Banner className="flex-none">사용 중인 사원만 보여요 · 부서 안에서는 직급 표시 순서(직급 탭) → 사원번호 순이에요</Banner>
      <QueryBoundary query={chart} loadingLabel="조직도를 불러오는 중…">
        {(departments) =>
          departments.length === 0 ? (
            <StateView kind="empty" title="등록된 부서가 없어요" />
          ) : (
            <div className="flex flex-none flex-col gap-3">
              {departments.map((department) => (
                <Card key={department.id}>
                  <DepartmentBlock department={department} />
                </Card>
              ))}
            </div>
          )
        }
      </QueryBoundary>
    </>
  );
}

function DepartmentBlock({ department }: { department: OrgChartDepartmentView }) {
  const isRoot = department.depth === 0;
  return (
    <div className={cn('flex flex-col', !isRoot && 'border-t border-line')}>
      <header className={cn('flex items-center gap-2 px-4', isRoot ? 'h-11 border-b border-line' : 'h-10 bg-surface-2')}>
        {isRoot ? null : <span className="text-ink-3">└</span>}
        <h3 className={cn('font-semibold', isRoot ? 'text-base' : 'text-sm')}>{department.departmentName}</h3>
        <span className="font-mono text-cap text-ink-3">{department.departmentCode}</span>
        <span className="text-cap text-ink-2">{department.members.length}명</span>
        {department.children.length > 0 ? (
          <span className="text-cap text-ink-3">
            · 하위 부서 {department.children.length}개 · 전체 {department.totalMemberCount}명
          </span>
        ) : null}
        <span className="ml-auto">
          {department.head ? (
            <Badge tone="run" plain>
              부서장 {department.head.employeeName} {department.head.jobGradeName}
            </Badge>
          ) : (
            <Badge tone="wait">부서장 없음</Badge>
          )}
        </span>
      </header>
      {department.members.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 px-4 py-3">
          {department.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 rounded-sm border border-line px-2.5 py-2">
              <Avatar name={member.employeeName} size="md" tone={member.isHead ? 'brand' : 'neutral'} />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <b className="text-sm font-semibold">{member.employeeName}</b>
                  {member.isHead ? <HeadTag size="sm" departmentNames={[department.departmentName]} /> : null}
                </span>
                <span className="text-cap text-ink-3">{member.jobGradeName}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-cap text-ink-3">이 부서에 속한 사원이 없어요</p>
      )}
      {department.children.length > 0 ? (
        <div className="ml-6 border-l border-line">
          {department.children.map((child) => (
            <DepartmentBlock key={child.id} department={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
