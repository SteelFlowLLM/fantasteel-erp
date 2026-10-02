'use client';

// 멤버 고르기: 조직도(부서 트리 + 부서원)에서 고른다 (REQ-MSG-001, REQ-ORG-004). 이름·사원번호·부서로 찾을 수도 있다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrgChartNode } from '@/api/directory';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { EmptyNote, Spinner } from '@/components/StateView';
import { Tag } from '@/components/Tag';
import { useEmployeeList, useOrgChart } from '@/hooks/useDirectory';
import { cn } from '@/lib/cn';

export interface MemberPickerProps {
  selected: readonly number[];
  onChange: (ids: number[]) => void;
  /** 한 명만 고른다 (1:1) */
  single?: boolean;
  /** 목록에서 뺄 사원 (나) */
  excludeIds?: readonly number[];
  /** 이미 멤버라 체크된 채 잠긴 사원 (초대) */
  lockedIds?: readonly number[];
}

/** 이 부서와 하위 부서의 부서원 */
function collectMemberIds(node: OrgChartNode): number[] {
  return [...node.members.map((m) => m.id), ...node.children.flatMap(collectMemberIds)];
}

function Check({ checked, indeterminate, single, disabled, label, onChange }: { checked: boolean; indeterminate?: boolean; single?: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type={single ? 'radio' : 'checkbox'}
      className="size-3.5 flex-none accent-brand"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function MemberPicker({ selected, onChange, single, excludeIds = [], lockedIds = [] }: MemberPickerProps) {
  const orgChart = useOrgChart();
  const employees = useEmployeeList({ isActive: true });
  const [keyword, setKeyword] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const nameOf = useMemo(() => new Map((employees.data ?? []).map((e) => [e.id, e.employeeName])), [employees.data]);

  const toggle = (id: number) => {
    if (locked.has(id) || excluded.has(id)) return;
    if (single) onChange([id]);
    else onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const toggleDepartment = (node: OrgChartNode) => {
    const ids = collectMemberIds(node).filter((id) => !excluded.has(id) && !locked.has(id));
    const allOn = ids.length > 0 && ids.every((id) => chosen.has(id));
    onChange(allOn ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const search = keyword.trim().toLowerCase();
  const results = search
    ? (employees.data ?? []).filter(
        (e) => !excluded.has(e.id) && (e.employeeName.toLowerCase().includes(search) || e.employeeNo.includes(search) || e.departmentName.toLowerCase().includes(search)),
      )
    : [];

  const renderNode = (node: OrgChartNode, depth: number) => {
    const ids = collectMemberIds(node).filter((id) => !excluded.has(id));
    const eligible = ids.filter((id) => !locked.has(id));
    const pickedCount = ids.filter((id) => chosen.has(id) || locked.has(id)).length;
    const isCollapsed = collapsed.has(node.id);
    const members = node.members.filter((m) => !excluded.has(m.id));
    return (
      <div key={node.id}>
        {/* 들여쓰기는 트리 깊이마다 달라 style로 준다 */}
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 py-1.5 pr-3" style={{ paddingLeft: 12 + depth * 16 }}>
          <button
            type="button"
            className="flex size-5 items-center justify-center text-ink-3"
            aria-label={isCollapsed ? `${node.departmentName} 펼치기` : `${node.departmentName} 접기`}
            onClick={() => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })}
          >
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size="sm" />
          </button>
          {!single && eligible.length > 0 ? (
            <Check
              label={`${node.departmentName} 전체 선택`}
              checked={eligible.every((id) => chosen.has(id))}
              indeterminate={eligible.some((id) => chosen.has(id)) && !eligible.every((id) => chosen.has(id))}
              onChange={() => toggleDepartment(node)}
            />
          ) : null}
          <b className="text-xs font-semibold text-ink">{node.departmentName}</b>
          <span className="ml-auto text-cap text-ink-3">
            {ids.length}명 · {pickedCount}명 선택
          </span>
        </div>
        {isCollapsed ? null : (
          <>
            {members.map((member) => (
              <label
                key={member.id}
                className={cn('flex cursor-pointer items-center gap-2 border-b border-line py-1.5 pr-3 text-sm hover:bg-surface-2', locked.has(member.id) && 'cursor-default text-ink-3')}
                style={{ paddingLeft: 40 + depth * 16 }}
              >
                <Check
                  single={single}
                  label={member.employeeName}
                  checked={chosen.has(member.id) || locked.has(member.id)}
                  disabled={locked.has(member.id)}
                  onChange={() => toggle(member.id)}
                />
                <span>{member.employeeName}</span>
                <span className="text-xs text-ink-3">{member.jobGradeName}</span>
                {member.isHead ? (
                  <Tag size="sm" tone="outline">
                    부서장
                  </Tag>
                ) : null}
                {locked.has(member.id) ? <span className="ml-auto text-cap text-ink-3">참여 중</span> : null}
              </label>
            ))}
            {node.children.map((child) => renderNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Input leadingIcon="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="이름·사원번호·부서 검색" aria-label="사원 검색" />
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(selected.filter((x) => x !== id))}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-tint px-2.5 text-xs font-medium text-brand hover:bg-[#d8e3ee]"
              aria-label={`${nameOf.get(id) ?? id} 빼기`}
            >
              {nameOf.get(id) ?? id}
              <Icon name="x" size="sm" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="max-h-[320px] min-h-[160px] overflow-auto rounded-sm border border-line">
        {orgChart.isPending || employees.isPending ? (
          <Spinner className="py-8" />
        ) : search ? (
          results.length === 0 ? (
            <EmptyNote>일치하는 사원이 없어요</EmptyNote>
          ) : (
            results.map((employee) => (
              <label key={employee.id} className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-sm hover:bg-surface-2">
                <Check
                  single={single}
                  label={employee.employeeName}
                  checked={chosen.has(employee.id) || locked.has(employee.id)}
                  disabled={locked.has(employee.id)}
                  onChange={() => toggle(employee.id)}
                />
                <span>
                  {employee.employeeName} {employee.jobGradeName}
                </span>
                <span className="text-xs text-ink-3">
                  · {employee.departmentName} · {employee.employeeNo}
                </span>
                {locked.has(employee.id) ? <span className="ml-auto text-cap text-ink-3">참여 중</span> : null}
              </label>
            ))
          )
        ) : (orgChart.data ?? []).length === 0 ? (
          <EmptyNote>등록된 부서가 없어요</EmptyNote>
        ) : (
          (orgChart.data ?? []).map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
