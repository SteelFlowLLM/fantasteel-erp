'use client';

// 조직도 (REQ-ORG-003): 부서 트리와 부서별 인원(이름, 직급, 부서장 여부). 읽기 전용. 관리 화면 탭과 공통 조직도 화면이 같이 쓴다.
// 맨 위 회사 → 최상위 부서를 가로 열로 → 열마다 부서장 카드 아래에 소속 사원과 하위 부서(파트)를 세로 가지로 그린다.
// 열마다 브랜드 남색과 짙은 남색을 번갈아 부서 색(--org)으로 정하고, 머리·부서장·사원 카드는 그 색의 짙기만 바꿔 쓴다.
import type { CSSProperties, ReactNode } from 'react';
import type { OrgChartDepartmentView, OrgChartMemberView } from '@/api/adminOrganization';
import { Banner } from '@/components/Banner';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { QueryBoundary } from '@/components/QueryBoundary';
import { StateView } from '@/components/StateView';
import { useAdminOrgChart } from '@/hooks/useAdminOrganization';
import { cn } from '@/lib/cn';

const ORG_COLORS = ['--color-brand', '--color-nav-dark-2'] as const;
const orgStyle = (index: number): CSSProperties => ({ ['--org' as string]: `var(${ORG_COLORS[index % ORG_COLORS.length]})` });

// 부서 색에서 만든 칠: 진한 단색(머리·부서장 동그라미), 연한 바탕(부서장 카드), 조금 더 진한 연한 바탕(파트 머리·사원 동그라미)
const FILL = 'bg-(--org) text-on-brand';
const TINT = 'bg-[color-mix(in_oklab,var(--org)_10%,white)]';
const TINT_STRONG = 'bg-[color-mix(in_oklab,var(--org)_18%,white)] text-(--org)';

/** petKey: 펫 설명 대상 키. 안내 배너는 빼고 부서 트리 카드에만 단다 (공통 조직도 화면에서만 넘긴다) */
export function OrgChartTab({ petKey }: { petKey?: string }) {
  const chart = useAdminOrgChart();
  return (
    <>
      <Banner className="flex-none">사용 중인 사원만 보여요 · 부서 안에서는 직급 순서 → 사원번호 순이에요</Banner>
      <QueryBoundary query={chart} loadingLabel="조직도를 불러오는 중…">
        {(departments) =>
          departments.length === 0 ? (
            <StateView kind="empty" title="등록된 부서가 없어요" />
          ) : (
            <Card className="flex-none overflow-x-auto" petKey={petKey}>
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

const countParts = (d: OrgChartDepartmentView): number => d.children.reduce((sum, c) => sum + 1 + countParts(c), 0);

function OrgTree({ departments }: { departments: readonly OrgChartDepartmentView[] }) {
  const total = departments.reduce((sum, d) => sum + d.totalMemberCount, 0);
  const parts = departments.reduce((sum, d) => sum + countParts(d), 0);
  return (
    <div className="mx-auto flex min-w-max flex-col items-center px-6 pt-8 pb-10">
      <div className="flex flex-col items-center gap-2">
        <span className="flex size-24 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-nav-dark-2),var(--color-nav-dark))] text-on-brand shadow-lg ring-4 ring-surface">
          <Icon name="users" size="lg" />
        </span>
        <b className="text-3xl font-bold tracking-wide">FANTASTEEL</b>
        <span className="rounded-full bg-surface-2 px-4 py-1.5 text-sm font-medium text-ink-2">
          부서 {departments.length}개{parts > 0 ? ` · 파트 ${parts}개` : ''} · 사원 {total}명
        </span>
      </div>
      <span className="h-8 w-px bg-line-strong" />
      {/* 최상위 부서 열: 열마다 위쪽 가로 줄 반쪽씩을 그려 이웃 열과 잇는다 (gap-4의 절반만큼 밖으로) */}
      <div className="grid auto-cols-[minmax(212px,1fr)] grid-flow-col gap-4 self-stretch">
        {departments.map((department, index) => (
          <section key={department.id} className="relative flex flex-col pt-8" style={orgStyle(index)}>
            {index > 0 ? <span className="absolute top-0 right-1/2 -left-2 h-px bg-line-strong" /> : null}
            {index < departments.length - 1 ? <span className="absolute top-0 -right-2 left-1/2 h-px bg-line-strong" /> : null}
            <span className="absolute top-0 left-1/2 h-8 w-px bg-line-strong" />
            <DepartmentColumn department={department} order={index + 1} />
          </section>
        ))}
      </div>
    </div>
  );
}

function DepartmentColumn({ department, order }: { department: OrgChartDepartmentView; order: number }) {
  return (
    <div className="flex flex-col items-stretch">
      <header
        className={cn('flex h-14 items-center gap-3 rounded-full pr-5 pl-2 shadow-md', FILL)}
        data-pet-item="department"
        data-pet-item-title={department.departmentName}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-white/25 font-mono text-base font-bold">{String(order).padStart(2, '0')}</span>
        <h3 className="text-xl font-bold">{department.departmentName}</h3>
        <span className="ml-auto text-sm font-medium opacity-90" data-pet-field="인원">
          {department.totalMemberCount}명
        </span>
        <span className="sr-only" data-pet-field="부서 코드">
          {department.departmentCode}
        </span>
      </header>
      <span className="mx-auto h-4 w-px bg-line-strong" />
      <LeaderCard department={department} />
      <Branches department={department} />
    </div>
  );
}

/** 부서장: 부서 색 동그라미와 이름을 크게, 사원 카드보다 한 단계 위로 보이게 */
function LeaderCard({ department, small = false }: { department: OrgChartDepartmentView; small?: boolean }) {
  const head = department.head;
  return (
    <div className={cn('flex flex-col items-center gap-1.5 rounded-2xl text-center', TINT, small ? 'px-3 py-3' : 'px-4 py-4')} data-pet-field="부서장">
      {head ? (
        <>
          <span className={cn('relative flex items-center justify-center rounded-full font-bold shadow-md ring-4 ring-surface', FILL, small ? 'size-12 text-lg' : 'size-16 text-2xl')}>
            {head.employeeName.slice(0, 1)}
            <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-surface text-(--org) shadow-sm">
              <Icon name="key" size="sm" />
            </span>
          </span>
          <b className={cn('font-bold', small ? 'text-base' : 'text-xl')}>{head.employeeName}</b>
          <span className={cn('rounded-full px-3 py-0.5 text-xs font-semibold', TINT_STRONG)}>부서장 · {head.jobGradeName}</span>
        </>
      ) : (
        <span className="py-2 text-xs text-ink-3">부서장 없음</span>
      )}
    </div>
  );
}

/** 부서장을 뺀 소속 사원과 하위 부서를 왼쪽 세로 줄에 매달아 그린다 */
function Branches({ department }: { department: OrgChartDepartmentView }) {
  const members = department.members.filter((m) => !m.isHead);
  const count = members.length + department.children.length;
  if (count === 0) {
    return department.members.length === 0 ? <p className="py-3 text-center text-cap text-ink-3">소속 사원이 없어요</p> : null;
  }
  return (
    <ul className="flex flex-col pt-2">
      {members.map((member, i) => (
        <BranchItem key={`m${member.id}`} last={i === count - 1}>
          <MemberCard member={member} />
        </BranchItem>
      ))}
      {department.children.map((child, i) => (
        <BranchItem key={`d${child.id}`} last={members.length + i === count - 1} align="top">
          <SubDepartment department={child} />
        </BranchItem>
      ))}
    </ul>
  );
}

/** 세로 줄 한 마디와 가로 눈금. 마지막 항목은 눈금 아래로 줄을 끊는다. 하위 부서는 머리 높이에 눈금을 단다 */
function BranchItem({ last, align = 'middle', children }: { last: boolean; align?: 'middle' | 'top'; children: ReactNode }) {
  return (
    <li className="relative py-1.5 pl-7">
      <span className={cn('absolute top-0 left-3.5 w-px bg-line-strong', !last ? 'bottom-0' : align === 'middle' ? 'h-1/2' : 'h-[26px]')} />
      <span className={cn('absolute left-3.5 h-px w-3.5 bg-line-strong', align === 'middle' ? 'top-1/2' : 'top-[26px]')} />
      {children}
    </li>
  );
}

function MemberCard({ member }: { member: OrgChartMemberView }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-xs" data-pet-item="employee" data-pet-item-title={member.employeeName}>
      <span className={cn('flex size-10 flex-none items-center justify-center rounded-full text-base font-bold', TINT_STRONG)}>{member.employeeName.slice(0, 1)}</span>
      <span className="flex min-w-0 flex-col">
        <b className="text-base font-semibold">{member.employeeName}</b>
        <span className="text-xs text-ink-3" data-pet-field="직급">
          {member.jobGradeName}
        </span>
      </span>
    </div>
  );
}

/** 하위 부서(예: 생산부의 파트): 부서 색의 연한 둥근 상자 + 파트장 + 그 아래 가지 */
function SubDepartment({ department }: { department: OrgChartDepartmentView }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[color-mix(in_oklab,var(--org)_25%,white)] bg-surface p-2">
      <header
        className={cn('flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-base font-bold', TINT_STRONG)}
        data-pet-item="department"
        data-pet-item-title={department.departmentName}
      >
        <h4>{department.departmentName}</h4>
        <span className="text-xs font-medium opacity-80">{department.totalMemberCount}명</span>
        <span className="sr-only" data-pet-field="부서 코드">
          {department.departmentCode}
        </span>
      </header>
      <LeaderCard department={department} small />
      <Branches department={department} />
    </div>
  );
}
