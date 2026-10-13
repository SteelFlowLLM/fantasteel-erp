'use client';

// 조직도 (REQ-ORG-003): 부서 트리와 부서별 인원(이름, 직급, 부서장 여부). 읽기 전용. 관리 화면 탭과 공통 조직도 화면이 같이 쓴다.
// 맨 위 회사 → 최상위 부서를 가로 열로 → 열 안에 부서장, 소속 사원, 하위 부서를 세로 가지로 그린다.
import type { ReactNode } from 'react';
import type { OrgChartDepartmentView, OrgChartMemberView } from '@/api/adminOrganization';
import { Banner } from '@/components/Banner';
import { Card } from '@/components/Card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { HeadTag } from '@/features/admin/components/OrgBadges';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { cn } from '@/lib/cn';

/** 열마다 번갈아 쓰는 머리 색 (머리 띠와 사원 카드 왼쪽 선을 같은 색으로 묶는다) */
const COLUMN_TONES = [
  { head: 'bg-brand text-on-brand', accent: 'border-brand' },
  { head: 'bg-nav-dark-2 text-on-brand', accent: 'border-nav-dark-2' },
] as const;
type ColumnTone = (typeof COLUMN_TONES)[number];

export function OrgChartTab() {
  const chart = useAdminOrgChart();
  return (
    <>
      <Banner className="flex-none">사용 중인 사원만 보여요 · 부서 안에서는 직급 순서 → 사원번호 순이에요</Banner>
      <QueryBoundary query={chart} loadingLabel="조직도를 불러오는 중…">
        {(departments) =>
          departments.length === 0 ? (
            <StateView kind="empty" title="등록된 부서가 없어요" />
          ) : (
            <Card className="flex-none overflow-x-auto">
              <OrgTree departments={byRegistration(departments)} />
            </Card>
          )
        }
      </QueryBoundary>
    </>
  );
}

// 서버는 부서 코드 순으로 주지만, 조직도는 업무 흐름 순(영업 → 구매 → 생산 → 품질 → 물류 → 경영지원, 파트는 제선 → 제강 → 연주 → 열연)이 읽기 쉽다.
// 시드가 그 순서로 부서를 넣으므로 등록 순(id)으로 줄 세운다. 나중에 만든 부서는 뒤에 붙는다.
const byRegistration = (departments: readonly OrgChartDepartmentView[]): OrgChartDepartmentView[] =>
  [...departments].sort((a, b) => a.id - b.id).map((d) => ({ ...d, children: byRegistration(d.children) }));

const countDepartments =(d: OrgChartDepartmentView): number => 1 + d.children.reduce((sum, c) => sum + countDepartments(c), 0);

function OrgTree({ departments }: { departments: readonly OrgChartDepartmentView[] }) {
  const total = departments.reduce((sum, d) => sum + d.totalMemberCount, 0);
  const deptCount = departments.reduce((sum, d) => sum + countDepartments(d), 0);
  return (
    <div className="mx-auto flex min-w-max flex-col items-center px-6 pt-6 pb-8">
      <div className="rounded-full bg-nav-dark px-8 py-2.5 text-base font-bold tracking-wide text-on-brand shadow-sm">FANTASTEEL</div>
      <div className="relative h-14 w-px bg-line-strong">
        <span className="absolute top-1/2 left-4 -translate-y-1/2 whitespace-nowrap rounded-xs bg-brand-tint px-4 py-1.5 text-xs font-semibold text-brand">
          부서 {deptCount}개 · 사원 {total}명
        </span>
        <span className="absolute -bottom-1.5 -left-1.5 size-3 rounded-full border border-line-strong bg-surface" />
      </div>
      {/* 최상위 부서 열: 열마다 위쪽 가로 줄 반쪽씩을 그려 이웃 열과 잇는다 (gap-4의 절반만큼 밖으로) */}
      <div className="grid auto-cols-[minmax(184px,1fr)] grid-flow-col gap-4 self-stretch">
        {departments.map((department, index) => (
          <section key={department.id} className="relative flex flex-col pt-6">
            {index > 0 ? <span className="absolute top-0 right-1/2 -left-2 h-px bg-line-strong" /> : null}
            {index < departments.length - 1 ? <span className="absolute top-0 -right-2 left-1/2 h-px bg-line-strong" /> : null}
            <span className="absolute top-0 left-1/2 h-6 w-px bg-line-strong" />
            <DepartmentColumn department={department} order={index + 1} tone={COLUMN_TONES[index % COLUMN_TONES.length]} />
          </section>
        ))}
      </div>
    </div>
  );
}

function DepartmentColumn({ department, order, tone }: { department: OrgChartDepartmentView; order: number; tone: ColumnTone }) {
  return (
    <div className="flex flex-col">
      <header
        className={cn('flex h-11 items-center justify-center gap-1.5 px-3 text-sm font-semibold', tone.head)}
        data-pet-item="department"
        data-pet-item-title={department.departmentName}
      >
        <span className="font-mono text-xs opacity-70">{String(order).padStart(2, '0')}</span>
        <h3>{department.departmentName}</h3>
        <span className="sr-only" data-pet-field="부서 코드">
          {department.departmentCode}
        </span>
      </header>
      <HeadRow department={department} />
      <Branches department={department} tone={tone} />
    </div>
  );
}

/** 머리 띠 아래 회색 줄: 부서장과 인원 */
function HeadRow({ department, sub = false }: { department: OrgChartDepartmentView; sub?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5 bg-surface-2 px-3 text-center', sub ? 'py-1.5' : 'py-2')}>
      <span className="flex items-center gap-1.5 text-sm font-semibold" data-pet-field="부서장">
        {department.head ? (
          <>
            {department.head.employeeName}
            <span className="font-normal text-ink-2">{department.head.jobGradeName}</span>
            <HeadTag size="sm" departmentNames={[department.departmentName]} />
          </>
        ) : (
          <span className="font-normal text-ink-3">부서장 없음</span>
        )}
      </span>
      <span className="text-cap text-ink-3">
        <span data-pet-field="인원">{department.members.length}명</span>
        {department.children.length > 0 ? (
          <span data-pet-field="하위 부서">
            {' '}
            · 하위 {department.children.length}개 · 전체 {department.totalMemberCount}명
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** 부서장을 뺀 소속 사원과 하위 부서를 왼쪽 세로 줄에 매달아 그린다 */
function Branches({ department, tone }: { department: OrgChartDepartmentView; tone: ColumnTone }) {
  const members = department.members.filter((m) => !m.isHead);
  const count = members.length + department.children.length;
  if (count === 0) {
    return department.members.length === 0 ? <p className="py-2 text-center text-cap text-ink-3">소속 사원이 없어요</p> : null;
  }
  return (
    <ul className="flex flex-col pt-1">
      {members.map((member, i) => (
        <BranchItem key={`m${member.id}`} last={i === count - 1}>
          <MemberCard member={member} tone={tone} />
        </BranchItem>
      ))}
      {department.children.map((child, i) => (
        <BranchItem key={`d${child.id}`} last={members.length + i === count - 1} align="top">
          <SubDepartment department={child} tone={tone} />
        </BranchItem>
      ))}
    </ul>
  );
}

/** 세로 줄 한 마디와 가로 눈금. 마지막 항목은 눈금 아래로 줄을 끊는다. 하위 부서는 머리 띠 높이에 눈금을 단다 */
function BranchItem({ last, align = 'middle', children }: { last: boolean; align?: 'middle' | 'top'; children: ReactNode }) {
  return (
    <li className="relative py-1 pl-6">
      <span className={cn('absolute top-0 left-3 w-px bg-line-strong', !last ? 'bottom-0' : align === 'middle' ? 'h-1/2' : 'h-[22px]')} />
      <span className={cn('absolute left-3 h-px w-3 bg-line-strong', align === 'middle' ? 'top-1/2' : 'top-[22px]')} />
      {children}
    </li>
  );
}

function MemberCard({ member, tone }: { member: OrgChartMemberView; tone: ColumnTone }) {
  return (
    <div className={cn('flex flex-col gap-0.5 border-l-[3px] bg-surface-2 px-3 py-2', tone.accent)} data-pet-item="employee" data-pet-item-title={member.employeeName}>
      <span className="text-cap text-ink-3" data-pet-field="직급">
        {member.jobGradeName}
      </span>
      <b className="text-sm font-semibold">{member.employeeName}</b>
    </div>
  );
}

/** 하위 부서(예: 생산부의 파트): 연한 머리 띠 + 부서장 줄 + 그 아래 가지 */
function SubDepartment({ department, tone }: { department: OrgChartDepartmentView; tone: ColumnTone }) {
  return (
    <div className="flex flex-col border border-line">
      <header
        className="flex h-9 items-center justify-center gap-1.5 bg-brand-tint px-2 text-xs font-semibold text-brand"
        data-pet-item="department"
        data-pet-item-title={department.departmentName}
      >
        <h4>{department.departmentName}</h4>
        <span className="sr-only" data-pet-field="부서 코드">
          {department.departmentCode}
        </span>
      </header>
      <HeadRow department={department} sub />
      <div className="pr-2 pb-1">
        <Branches department={department} tone={tone} />
      </div>
    </div>
  );
}
