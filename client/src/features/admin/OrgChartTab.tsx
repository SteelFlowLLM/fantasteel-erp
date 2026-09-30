// 조직도 (REQ-ORG-003): 부서 트리와 부서별 인원(이름·직급·역할·부서장 표시). 읽기 전용.
import { Badge, EmptyNote, Icon } from '@/components/ui';
import type { OrgChartNode } from '@/api/organization';
import { avatarCls, countOrgMembers, roleLabel } from './organizationHooks';

function OrgNode({ node, depth }: { node: OrgChartNode; depth: number }) {
  const headOutside = node.head && !node.members.some((m) => m.id === node.head!.id);
  return (
    <div className="hl-col" style={{ gap: 8 }}>
      <section className="hl-card">
        <header className="hl-card__head">
          <Icon name="building" style={{ color: '#3F4A57' }} />
          <h3>{node.departmentName}</h3>
          <span className="hl-cap mono">{node.departmentCode}</span>
          <span className="hl-tag">{node.members.length}명</span>
          {node.children.length ? <span className="hl-cap">하위 부서 {node.children.length}개 · 전체 {countOrgMembers(node)}명</span> : null}
          <span style={{ marginLeft: 'auto' }}>
            {node.head ? <span className="hl-cap">부서장 <b style={{ color: 'var(--ink)' }}>{node.head.employeeName}</b> {node.head.jobGrade}</span> : <Badge tone="wait" title="부서장이 없으면 이 부서 사원은 구매요청을 제출할 수 없어요">부서장 없음</Badge>}
          </span>
        </header>
        <div className="hl-card__body" style={{ padding: '10px 16px' }}>
          {node.members.length || headOutside ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px 12px' }}>
              {headOutside && node.head ? (
                <div className="hl-row" style={{ gap: 8 }}>
                  <span className="hl-avatar hl-avatar--sm">{node.head.employeeName.slice(0, 1)}</span>
                  <div className="hl-col" style={{ minWidth: 0 }}>
                    <span className="hl-row" style={{ gap: 6 }}><b>{node.head.employeeName}</b><Badge tone="run">부서장</Badge></span>
                    <span className="hl-cap">{node.head.jobGrade} · 다른 부서 소속</span>
                  </div>
                </div>
              ) : null}
              {node.members.map((m) => (
                <div key={m.id} className="hl-row" style={{ gap: 8 }}>
                  <span className={`hl-avatar${avatarCls(m.roleCode)} hl-avatar--sm`}>{m.employeeName.slice(0, 1)}</span>
                  <div className="hl-col" style={{ minWidth: 0 }}>
                    <span className="hl-row" style={{ gap: 6 }}><b>{m.employeeName}</b>{m.isHead ? <Badge tone="run">부서장</Badge> : null}</span>
                    <span className="hl-cap">{m.jobGrade} · {roleLabel(m.roleCode)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="hl-cap">이 부서에 속한 사원이 없어요</span>
          )}
        </div>
      </section>
      {node.children.length ? (
        <div className="hl-col" style={{ gap: 8, marginLeft: 20, paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
          {node.children.map((c) => <OrgNode key={c.id} node={c} depth={depth + 1} />)}
        </div>
      ) : null}
    </div>
  );
}

export function OrgChartTab({ tree }: { tree: OrgChartNode[] }) {
  if (!tree.length) return <EmptyNote>등록된 부서가 없어요</EmptyNote>;
  return (
    <>
      <span className="hl-cap" style={{ flex: 'none' }}>사용 중인 사원만 보여요 · 부서장이 맨 앞, 나머지는 사원번호순이에요 · 누구나 볼 수 있어요</span>
      {tree.map((n) => <OrgNode key={n.id} node={n} depth={0} />)}
    </>
  );
}
