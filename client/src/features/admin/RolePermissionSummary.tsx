// 역할이 가진 권한을 사용(✓)·조회(눈)·없음(잠금)으로 요약해 보여준다. 데이터는 GET /roles 응답.
import { PERMISSIONS } from '@fantasteel/shared';
import type { RoleView } from '@/api/organization';

export function summarizeRole(role: RoleView | undefined) {
  const level = new Map((role?.permissions ?? []).map((p) => [p.permissionCode, p.permissionLevel]));
  const use = PERMISSIONS.filter((p) => level.get(p.code) === 'USE');
  const view = PERMISSIONS.filter((p) => level.get(p.code) === 'VIEW');
  const none = PERMISSIONS.filter((p) => !level.get(p.code));
  return { use, view, none };
}

export function RolePermissionSummary({ role }: { role: RoleView | undefined }) {
  const s = summarizeRole(role);
  return (
    <div className="hl-row" style={{ flexWrap: 'wrap', gap: '6px 14px', fontSize: 12 }}>
      {s.use.map((x) => (
        <span key={x.code} className="hl-row" style={{ gap: 4 }}>
          <i className="ic ic-check ic--sm" style={{ color: '#17794A' }} aria-hidden="true" />
          {x.label}
        </span>
      ))}
      {s.view.map((x) => (
        <span key={x.code} className="hl-row" style={{ gap: 4 }}>
          <i className="ic ic-eye ic--sm" style={{ color: '#1F5FCC' }} aria-hidden="true" />
          {x.label} 조회
        </span>
      ))}
      {s.none.length ? (
        <span className="hl-row hl-muted" style={{ gap: 4 }}>
          <i className="ic ic-lock ic--sm" aria-hidden="true" />
          {s.none.slice(0, 3).map((x) => x.label).join(' · ')}{s.none.length > 3 ? ` 외 ${s.none.length - 3}` : ''}
        </span>
      ) : null}
      {!role ? <span className="hl-cap">역할 정보를 불러오는 중이에요</span> : null}
    </div>
  );
}
