// 조직 정보에서 사람 고르기 (REQ-ORG-004): 조직도(부서 트리 + 체크박스) 또는 이름·사원번호 검색.
import { useMemo, useState, type ReactNode } from 'react';
import { useDirectoryEmployees, useDirectoryTree, type DirectoryTreeNode } from '@/api/directory';
import { EmptyNote, Icon, QueryBoundary } from '@/components/ui';
import './collab.css';

interface MemberPickerProps {
  /** 고른 사원 id */
  value: number[];
  onChange: (ids: number[]) => void;
  /** true면 한 명만 고른다 (1:1 대화) */
  single?: boolean;
  /** 목록에서 빼는 사원 (나 자신) */
  excludeIds?: number[];
  /** 이미 들어 있어 바꿀 수 없는 사원 (방의 기존 멤버) */
  lockedIds?: number[];
  height?: number;
}

const memberIdsUnder = (node: DirectoryTreeNode): number[] => [...node.members.map((m) => m.id), ...node.children.flatMap(memberIdsUnder)];

export function MemberPicker({ value, onChange, single, excludeIds = [], lockedIds = [], height = 300 }: MemberPickerProps) {
  const tree = useDirectoryTree();
  const directory = useDirectoryEmployees();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const selected = useMemo(() => new Set(value), [value]);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const byId = useMemo(() => new Map((directory.data ?? []).map((e) => [e.id, e])), [directory.data]);
  const keyword = q.trim().toLowerCase();
  const hits = keyword
    ? (directory.data ?? []).filter((e) => !excluded.has(e.id) && (e.employeeName.toLowerCase().includes(keyword) || e.employeeNo.includes(keyword) || e.departmentName.toLowerCase().includes(keyword)))
    : [];

  const toggle = (id: number) => {
    if (locked.has(id)) return;
    if (single) onChange(selected.has(id) ? [] : [id]);
    else onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const toggleDept = (node: DirectoryTreeNode) => {
    const ids = memberIdsUnder(node).filter((id) => !excluded.has(id) && !locked.has(id));
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    onChange(allOn ? value.filter((id) => !ids.includes(id)) : [...new Set([...value, ...ids])]);
  };
  const toggleOpen = (id: number) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const person = (id: number, name: string, jobGrade: string, extra: string | null, isHead: boolean, depth: number) => {
    const isLocked = locked.has(id);
    return (
      <label key={id} className={`collab-pick__row${selected.has(id) || isLocked ? ' is-on' : ''}`} style={{ paddingLeft: 12 + depth * 18 }}>
        <input type={single ? 'radio' : 'checkbox'} name="collab-pick" checked={selected.has(id) || isLocked} disabled={isLocked} onChange={() => toggle(id)} onClick={() => single && selected.has(id) && toggle(id)} />
        <span className="hl-avatar hl-avatar--sm">{name.slice(0, 1)}</span>
        <span className="hl-grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name} <span className="hl-cap">{jobGrade}{extra ? ` · ${extra}` : ''}</span>
        </span>
        {isHead ? <span className="hl-tag">부서장</span> : null}
        {isLocked ? <span className="hl-cap">참여 중</span> : null}
      </label>
    );
  };

  const renderNode = (node: DirectoryTreeNode, depth: number): ReactNode => {
    const members = node.members.filter((m) => !excluded.has(m.id));
    const selectable = memberIdsUnder(node).filter((id) => !excluded.has(id) && !locked.has(id));
    const onCount = selectable.filter((id) => selected.has(id)).length;
    const open = !closed.has(node.id);
    return (
      <div key={node.id}>
        <div className="collab-pick__dept" style={{ paddingLeft: 8 + depth * 18 }}>
          <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ width: 22, height: 22 }} aria-label={`${node.departmentName} ${open ? '접기' : '펼치기'}`} aria-expanded={open} onClick={() => toggleOpen(node.id)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
          </button>
          {single ? null : (
            <input
              type="checkbox"
              aria-label={`${node.departmentName} 전체 선택`}
              disabled={!selectable.length}
              checked={selectable.length > 0 && onCount === selectable.length}
              ref={(el) => {
                if (el) el.indeterminate = onCount > 0 && onCount < selectable.length;
              }}
              onChange={() => toggleDept(node)}
            />
          )}
          <b>{node.departmentName}</b>
          <span className="hl-cap">{memberIdsUnder(node).length}명{onCount ? ` · ${onCount}명 선택` : ''}</span>
        </div>
        {open ? (
          <>
            {members.map((m) => person(m.id, m.employeeName, m.jobGrade, null, m.isHead, depth + 1))}
            {node.children.map((c) => renderNode(c, depth + 1))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="collab-pick">
      <label className="hl-search" style={{ width: '100%', height: 32 }}>
        <Icon name="search" size="sm" />
        <input type="search" placeholder="이름·사원번호·부서 검색" aria-label="사원 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {value.length ? (
        <div className="hl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {value.map((id) => (
            <button key={id} type="button" className="hl-chip" aria-label={`${byId.get(id)?.employeeName ?? id} 빼기`} onClick={() => toggle(id)}>
              {byId.get(id)?.employeeName ?? `사원 ${id}`}
              <Icon name="x" size="sm" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="collab-pick__list" style={{ height }} role="group" aria-label="조직도에서 선택">
        {keyword ? (
          <QueryBoundary query={directory}>
            {() => (hits.length ? <>{hits.map((e) => person(e.id, e.employeeName, e.jobGrade, `${e.departmentName} · ${e.employeeNo}`, false, 0))}</> : <EmptyNote>일치하는 사원이 없어요</EmptyNote>)}
          </QueryBoundary>
        ) : (
          <QueryBoundary query={tree}>
            {(nodes) => (nodes.length ? <>{nodes.map((n) => renderNode(n, 0))}</> : <EmptyNote>등록된 부서가 없어요</EmptyNote>)}
          </QueryBoundary>
        )}
      </div>
    </div>
  );
}
