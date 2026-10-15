'use client';

// 참석자 고르기: 조직도(GET /departments)의 사용 중 사원을 부서별로 묶어 체크한다 (REQ-ORG-004).
import { useMemo } from 'react';
import type { OrgChartDepartmentView } from '@/api/adminOrganization';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';

type MemberGroup = { departmentName: string; members: { id: number; employeeName: string; jobGradeName: string }[] };

const groupsOfChart = (nodes: readonly OrgChartDepartmentView[]): MemberGroup[] =>
  nodes.flatMap((node) => [{ departmentName: node.departmentName, members: node.members }, ...groupsOfChart(node.children)]).filter((group) => group.members.length > 0);

export function AttendeePicker({ selected, myId, invalid, onChange }: { selected: readonly number[]; myId: number; invalid?: boolean; onChange: (ids: number[]) => void }) {
  const chart = useAdminOrgChart();
  const groups = useMemo(() => groupsOfChart(chart.data ?? []), [chart.data]);
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <QueryBoundary query={chart} loadingLabel="사원을 불러오는 중…">
      {() => (
        <div
          role="group"
          aria-label="참석자"
          aria-invalid={invalid || undefined}
          className={`flex max-h-56 flex-col gap-2 overflow-auto rounded-sm border bg-surface p-2.5 ${invalid ? 'border-danger' : 'border-line-strong'}`}
        >
          {groups.map((group) => (
            <div key={group.departmentName} className="flex flex-col gap-1">
              <span className="text-cap font-semibold text-ink-3">{group.departmentName}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {group.members.map((member) => (
                  <label key={member.id} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={selected.includes(member.id)} onChange={() => toggle(member.id)} />
                    {member.employeeName} <span className="text-cap text-ink-3">{member.jobGradeName}</span>
                    {member.id === myId ? <span className="text-cap text-ink-3">(나)</span> : null}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </QueryBoundary>
  );
}
