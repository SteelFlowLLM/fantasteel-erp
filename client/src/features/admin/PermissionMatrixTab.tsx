// 역할별 권한 (REQ-AUTH-003): 역할 × 권한 행렬. 칸을 누르면 사용 → 조회 → 없음 순으로 바뀌고, 역할마다 따로 저장한다.
import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type Permission, type RoleCode } from '@fantasteel/shared';
import { ApiError } from '@/api/client';
import { authApi } from '@/api/auth';
import { roleApi, type PermissionEntry, type RoleView } from '@/api/organization';
import { Badge, EmptyNote, Icon } from '@/components/ui';
import { useAction } from '@/hooks/useApi';
import { useAuthStore } from '@/stores/auth';
import { roleLabel } from './organizationHooks';

export type CellLevel = 'USE' | 'VIEW' | 'NONE';
const LABEL: Record<CellLevel, string> = { USE: '사용', VIEW: '조회', NONE: '없음' };
const NEXT: Record<CellLevel, CellLevel> = { USE: 'VIEW', VIEW: 'NONE', NONE: 'USE' };
const HL_COL = { background: 'var(--brand-tint)' } as const;
const PENDING = { background: '#FDF0DF' } as const;

const serverLevel = (role: RoleView, code: string): CellLevel => role.permissions.find((p) => p.permissionCode === code)?.permissionLevel ?? 'NONE';

/** 저장 전 편집 상태. 서버 값과 다른 칸만 들고 있어서, 되돌리면 자동으로 변경이 사라진다. */
export function usePermissionEdits(roles: RoleView[] | undefined) {
  const [edits, setEdits] = useState<Record<number, Record<string, CellLevel>>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  const level = useCallback((role: RoleView, code: string): CellLevel => edits[role.id]?.[code] ?? serverLevel(role, code), [edits]);
  const setLevel = useCallback((role: RoleView, code: string, next: CellLevel) => {
    setErrors((e) => { if (!(role.id in e)) return e; const { [role.id]: _drop, ...rest } = e; return rest; });
    setEdits((prev) => {
      const cur = { ...(prev[role.id] ?? {}) };
      if (next === serverLevel(role, code)) delete cur[code];
      else cur[code] = next;
      const out = { ...prev };
      if (Object.keys(cur).length) out[role.id] = cur;
      else delete out[role.id];
      return out;
    });
  }, []);
  const discard = useCallback((roleId: number) => {
    setEdits((prev) => { const { [roleId]: _d, ...rest } = prev; return rest; });
    setErrors((prev) => { const { [roleId]: _d, ...rest } = prev; return rest; });
  }, []);
  const setError = useCallback((roleId: number, msg: string) => setErrors((p) => ({ ...p, [roleId]: msg })), []);
  const changesOf = useCallback((role: RoleView) => Object.keys(edits[role.id] ?? {}), [edits]);
  const dirtyCount = useMemo(() => (roles ?? []).reduce((n, r) => n + (Object.keys(edits[r.id] ?? {}).length ? 1 : 0), 0), [roles, edits]);
  return { level, setLevel, discard, changesOf, dirtyCount, errors, setError };
}
export type PermissionEdits = ReturnType<typeof usePermissionEdits>;

export function PermissionMatrixTab({ roles, edits, canEdit, focusRole, meRoleCode }: { roles: RoleView[]; edits: PermissionEdits; canEdit: boolean; focusRole: string | null; meRoleCode: string }) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const save = useAction(roleApi.replacePermissions, {
    success: (r) => `${roleLabel(r.roleCode, r.roleName)} 역할 권한을 저장했어요`,
    invalidate: ['employees'],
    onSuccess: (r) => {
      edits.discard(r.id);
      // 내 역할의 권한이 바뀌었으면 메뉴·버튼 권한도 바로 맞춘다.
      if (r.roleCode === meRoleCode) void authApi.me().then((u) => useAuthStore.getState().setUser(u)).catch(() => undefined);
    },
  });

  const submit = (role: RoleView) => {
    const permissions: PermissionEntry[] = [
      ...PERMISSIONS.flatMap((p) => { const lv = edits.level(role, p.code); return lv === 'NONE' ? [] : [{ permissionCode: p.code, permissionLevel: lv }]; }),
      // 이 화면이 모르는 코드는 그대로 유지한다 (PUT은 전체 교체).
      ...role.permissions.filter((p) => !PERMISSIONS.some((d) => d.code === p.permissionCode)),
    ];
    setSavingId(role.id);
    save.mutate({ id: role.id, permissions }, {
      onError: (e) => edits.setError(role.id, e instanceof ApiError ? e.message : '저장하지 못했어요'),
      onSettled: () => setSavingId(null),
    });
  };

  const counts = (role: RoleView) => {
    let use = 0;
    let view = 0;
    for (const p of PERMISSIONS) { const lv = edits.level(role, p.code); if (lv === 'USE') use++; else if (lv === 'VIEW') view++; }
    return { use, view };
  };
  const dirtyRoles = roles.filter((r) => edits.changesOf(r).length > 0);
  const errorRoles = roles.filter((r) => edits.errors[r.id]);

  return (
    <>
      {!canEdit ? (
        <div className="hl-banner" style={{ flex: 'none', alignItems: 'center' }}>
          <Icon name="lock" style={{ marginTop: 0 }} />
          <div><b>조회 전용</b> — 권한을 바꾸려면 부서·권한 관리 사용 권한이 필요해요</div>
        </div>
      ) : dirtyRoles.length ? (
        <div className="hl-banner hl-banner--wait" style={{ flex: 'none', alignItems: 'center' }}>
          <Icon name="edit" style={{ marginTop: 0 }} />
          <div><b>저장 전 변경이 있는 역할 {dirtyRoles.length}개</b> — {dirtyRoles.map((r) => `${roleLabel(r.roleCode, r.roleName)} ${edits.changesOf(r).length}건`).join(' · ')}. 역할마다 따로 저장해요</div>
        </div>
      ) : null}
      {errorRoles.map((r) => (
        <div key={r.id} className="hl-banner hl-banner--danger" style={{ flex: 'none' }} role="alert">
          <Icon name="alert" />
          <div><b>{roleLabel(r.roleCode, r.roleName)} 역할을 저장하지 못했어요</b><br />{edits.errors[r.id]}</div>
        </div>
      ))}
      <section className="hl-card" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <header className="hl-card__head">
          <Icon name="key" style={{ color: '#3F4A57' }} />
          <h3>역할별 권한</h3>
          <span className="hl-card__meta">역할 {roles.length} × 권한 {PERMISSIONS.length}</span>
          <div className="hl-card__actions">
            <span className="hl-legend">
              <span>사용 = 입력·변경</span>
              <span>조회 = 보기만</span>
              <span><i style={{ background: '#FDF0DF', border: '1px solid #F2D2A8' }} />저장 전 변경</span>
              <span><i style={{ width: 6, height: 6, borderRadius: '50%', background: '#1F5FCC' }} />기본값과 다름</span>
            </span>
          </div>
        </header>
        {roles.length ? (
          <table className="hl-table hl-table--compact" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 52 }} />
                <th>권한</th>
                {roles.map((r) => {
                  const c = counts(r);
                  return (
                    <th key={r.id} className="ctr" style={r.roleCode === focusRole ? HL_COL : undefined}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 0' }}>
                        <span className="hl-role">{roleLabel(r.roleCode, r.roleName)}</span>
                        <span className="hl-cap" style={{ fontWeight: 400 }}>사용 {c.use} · 조회 {c.view}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p, i) => {
                const first = i === 0 || PERMISSIONS[i - 1]!.area !== p.area;
                return (
                  <tr key={p.code}>
                    <td className="hl-cap" style={{ fontWeight: 600, ...(first ? { borderTop: '1px solid var(--line-strong)' } : { borderTop: 0 }) }}>{first ? p.area : null}</td>
                    <td style={first ? { borderTop: '1px solid var(--line-strong)' } : undefined}>{p.label}</td>
                    {roles.map((r) => {
                      const lv = edits.level(r, p.code);
                      const pending = lv !== serverLevel(r, p.code);
                      const def: CellLevel = DEFAULT_ROLE_PERMISSIONS[r.roleCode as RoleCode]?.[p.code as Permission] ?? 'NONE';
                      const custom = lv !== def && !pending;
                      const style = { ...(r.roleCode === focusRole ? HL_COL : {}), ...(pending ? PENDING : {}), ...(first ? { borderTop: '1px solid var(--line-strong)' } : {}) };
                      return (
                        <td key={r.id} className="ctr" style={style}>
                          <button
                            type="button"
                            disabled={!canEdit || (savingId === r.id)}
                            onClick={() => edits.setLevel(r, p.code, NEXT[lv])}
                            aria-label={`${p.label} · ${roleLabel(r.roleCode, r.roleName)}: ${LABEL[lv]}${canEdit ? ' (누르면 바뀌어요)' : ''}`}
                            title={custom ? `기본값은 ${LABEL[def]}이에요` : pending ? `저장 전 변경: ${LABEL[serverLevel(r, p.code)]} → ${LABEL[lv]}` : undefined}
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 64, height: 24, border: 0, borderRadius: 4, background: 'transparent', font: 'inherit', fontSize: 12, color: lv === 'USE' ? '#17794A' : lv === 'VIEW' ? '#1F5FCC' : 'var(--ink-3)', cursor: canEdit ? 'pointer' : 'default' }}
                          >
                            {lv === 'USE' ? <Icon name="check" size="sm" /> : lv === 'VIEW' ? <Icon name="eye" size="sm" /> : <span aria-hidden="true">–</span>}
                            {LABEL[lv]}
                            {custom ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1F5FCC' }} aria-hidden="true" /> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="hl-cap">역할별 저장</td>
                {roles.map((r) => {
                  const n = edits.changesOf(r).length;
                  return (
                    <td key={r.id} className="ctr" style={r.roleCode === focusRole ? HL_COL : undefined}>
                      {n ? (
                        <div className="hl-col" style={{ gap: 4, alignItems: 'center', padding: '6px 0' }}>
                          <Badge tone="wait">변경 {n} · 저장 전</Badge>
                          <div className="hl-row" style={{ gap: 4 }}>
                            <button type="button" className="hl-btn hl-btn--sm" onClick={() => edits.discard(r.id)} disabled={savingId === r.id}>취소</button>
                            <button type="button" className="hl-btn hl-btn--sm hl-btn--primary" onClick={() => submit(r)} disabled={!canEdit || savingId === r.id} title={canEdit ? undefined : '권한이 필요해요'}>
                              <Icon name="check" />
                              {savingId === r.id ? '저장 중…' : '저장'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="hl-cap">변경 없음</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        ) : (
          <EmptyNote>역할이 없어요</EmptyNote>
        )}
      </section>
      <div className="hl-col" style={{ gap: 4, flex: 'none' }}>
        <span className="hl-cap"><Icon name="info" size="sm" /> 구매요청 승인 같은 승인 권한은 이 행렬에 없어요. 승인권자는 역할이 아니라 &lsquo;부서 계층&rsquo;에서 지정한 부서장이에요.</span>
        <span className="hl-cap">관리자 역할은 사원 관리·부서·권한 관리의 사용 권한을 유지해야 저장돼요 (아무도 관리할 수 없게 되는 것을 막아요). 저장하면 바로 적용돼요.</span>
      </div>
    </>
  );
}
