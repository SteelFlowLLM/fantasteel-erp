'use client';

// 사원 /admin/employees (REQ-AUTH-002·003): 왼쪽 사원 목록(검색·역할·부서·사용 여부) | 오른쪽 상세, 등록·수정은 창.
// 사원 관리(EMPLOYEE_MANAGE) 사용 권한이 없으면 조회만 하고 변경 버튼을 막는다.
import { useEffect, useMemo, useState } from 'react';
import { PERMISSION, ROLE, ROLE_LABEL, type RoleCode } from '@/codes';
import type { EmployeeListQuery } from '@/api/queryKeys';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, Spinner, StateView } from '@/components/StateView';
import { Segmented } from '@/components/Tabs';
import { Tag } from '@/components/Tag';
import { EmployeeDetail } from '@/features/admin/components/EmployeeDetail';
import { EmployeeFormModal } from '@/features/admin/components/EmployeeFormModal';
import { ActiveBadge, HeadTag } from '@/features/admin/components/OrgBadges';
import { departmentOptionLabel } from '@/features/admin/lib/orgRules';
import { useDepartmentList, useJobGradeList, useManagedEmployeeList, useRoleList } from '@/hooks/useDirectory';
import { useMe } from '@/hooks/useMe';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { fmtMDHM } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';

type ActiveFilter = 'all' | 'active' | 'inactive';
const ACTIVE_FILTERS: readonly { key: ActiveFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '사용' },
  { key: 'inactive', label: '사용 안 함' },
];
const ROLE_CODES = Object.values(ROLE);

export function EmployeeScreen() {
  const me = useMe();
  const canManage = useCanUse(PERMISSION.EMPLOYEE_MANAGE);
  const [keyword, setKeyword] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [roleCode, setRoleCode] = useState<RoleCode | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setKeywordQuery(keyword.trim()), 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  const query: EmployeeListQuery = useMemo(
    () => ({
      ...(departmentId !== '' ? { departmentId } : {}),
      ...(roleCode ? { roleCode } : {}),
      ...(active !== 'all' ? { isActive: active === 'active' } : {}),
      ...(keywordQuery ? { keyword: keywordQuery } : {}),
    }),
    [departmentId, roleCode, active, keywordQuery],
  );
  const filtered = Object.keys(query).length > 0;
  const all = useManagedEmployeeList();
  const list = useManagedEmployeeList(query);
  const departments = useDepartmentList();
  const jobGrades = useJobGradeList();
  const roles = useRoleList();

  const rows = list.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];
  const total = all.data?.length ?? 0;
  const inactiveCount = (all.data ?? []).filter((e) => !e.isActive).length;
  const departmentNames = new Map((departments.data ?? []).map((d) => [d.id, d.departmentName]));
  const lockTitle = canManage ? undefined : permissionNeedText([PERMISSION.EMPLOYEE_MANAGE]);

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-center gap-2">
              <b className="text-base font-semibold">사원</b>
              <Tag>{filtered ? `${rows.length} / ${total}` : total}</Tag>
              <Button variant="primary" size="sm" icon="plus" className="ml-auto" disabled={!canManage} title={lockTitle} onClick={() => setForm('create')}>
                사원 등록
              </Button>
            </div>
            <Input type="search" leadingIcon="search" placeholder="이름·사원번호" aria-label="사원 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <div className="flex gap-2">
              <Select aria-label="역할" value={roleCode} onChange={(e) => setRoleCode(e.target.value as RoleCode | '')}>
                <option value="">역할: 전체</option>
                {ROLE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {ROLE_LABEL[code]}
                  </option>
                ))}
              </Select>
              <Select aria-label="부서" value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">부서: 전체</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {departmentOptionLabel(d.departmentName, d.depth)}
                  </option>
                ))}
              </Select>
            </div>
            <Segmented ariaLabel="사용 여부" items={ACTIVE_FILTERS} active={active} onChange={setActive} className="self-start" />
          </>
        }
      >
        {list.isPending && !list.data ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : null}
        {list.error && !list.data ? <QueryBoundary query={list}>{() => null}</QueryBoundary> : null}
        <ul aria-label="사원 목록">
          {rows.map((employee) => {
            const isSelected = selected?.id === employee.id;
            return (
              <li key={employee.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  aria-current={isSelected || undefined}
                  onClick={() => setSelectedId(employee.id)}
                  className={cn('flex w-full flex-col gap-0.5 px-4 py-2 text-left', isSelected ? 'bg-brand-tint hover:bg-brand-tint-hover' : 'hover:bg-surface-2')}
                >
                  <span className="flex w-full items-center gap-2">
                    <Avatar name={employee.employeeName} size="sm" tone={employee.isActive ? 'brand' : 'neutral'} />
                    <b className={cn('text-sm font-semibold', !employee.isActive && 'text-ink-3')}>{employee.employeeName}</b>
                    <Tag tone="brand" size="sm">
                      {ROLE_LABEL[employee.roleCode]}
                    </Tag>
                    {employee.headDepartmentIds.length > 0 ? (
                      <HeadTag size="sm" departmentNames={employee.headDepartmentIds.map((id) => departmentNames.get(id) ?? '')} />
                    ) : null}
                    <span className="ml-auto">
                      <ActiveBadge isActive={employee.isActive} />
                    </span>
                  </span>
                  <span className="pl-[30px] text-cap text-ink-3">
                    {employee.departmentName} · {employee.jobGradeName} · {employee.employeeNo}
                    {employee.lastLoginAt ? ` · 최근 ${fmtMDHM(employee.lastLoginAt)}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {list.data && rows.length === 0 ? <EmptyNote>조건에 맞는 사원이 없어요</EmptyNote> : null}
      </MasterPane>
      <PageMain>
        {selected ? (
          <EmployeeDetail
            key={selected.id}
            employee={selected}
            meId={me.employeeId}
            canManage={canManage}
            roles={roles.data ?? []}
            departments={departments.data ?? []}
            summary={`${total}명 · 사용 안 함 ${inactiveCount}`}
            onEdit={() => setForm('edit')}
          />
        ) : list.data ? (
          <StateView kind="empty" title="사원을 골라 주세요" text={filtered ? '조건에 맞는 사원이 없어요. 검색 조건을 바꿔 보세요' : '등록된 사원이 없어요'} />
        ) : null}
      </PageMain>
      {form && departments.data && jobGrades.data && roles.data && (form === 'create' || selected) ? (
        <EmployeeFormModal
          key={form === 'edit' ? `edit-${selected?.id}` : 'create'}
          target={form === 'edit' ? selected : undefined}
          meId={me.employeeId}
          departments={departments.data}
          jobGrades={jobGrades.data}
          roles={roles.data}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            setForm(null);
            setSelectedId(id);
          }}
        />
      ) : null}
    </>
  );
}
