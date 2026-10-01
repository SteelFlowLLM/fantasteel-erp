'use client';

// 권한 탭 (REQ-AUTH-003): 역할 6개 × 권한 17개 행렬. 칸 = 사용(USE) / 조회(VIEW) / 없음(행 없음).
// 역할마다 따로 저장하고, 저장하면 그 역할 사원의 메뉴·버튼이 바로 바뀐다 (이 탭은 조회 무효화, 다른 탭은 BroadcastChannel).
import { Fragment } from 'react';
import { PERMISSION, PERMISSION_LABEL, PERMISSION_LEVEL, PERMISSION_LEVEL_LABEL, ROLE_LABEL, type Permission, type PermissionLevel, type RoleCode } from '@/codes';
import { roleAdminApi } from '@/api/adminOrganization';
import type { RoleView } from '@/api/directory';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardBody, CardHead } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Table, Td, Th } from '@/components/Table';
import {
  changedCellsOf,
  countLevels,
  effectiveLevelOf,
  levelCountText,
  levelLabelOf,
  levelsOf,
  nextLevelOf,
  permissionRowsByArea,
  permissionsToSave,
  type MatrixDraft,
  type MatrixLevel,
} from '@/features/admin/lib/permissionMatrix';
import { useAction } from '@/hooks/useAction';
import { useRoleList } from '@/hooks/useDirectory';
import { useMe } from '@/hooks/useMe';
import { cn } from '@/lib/cn';
import { permissionNeedText } from '@/lib/permissions';

const ROWS = permissionRowsByArea();

// 칸 색만 화면에 둔다. 글자는 levelLabelOf (사용·조회 = PERMISSION_LEVEL_LABEL, 행 없음 = '없음').
const LEVEL_CLASS: Record<PermissionLevel, string> = {
  USE: 'text-ok',
  VIEW: 'text-run',
};
const NO_LEVEL_CLASS = 'text-ink-disabled';

export interface PermissionMatrixTabProps {
  canEdit: boolean;
  draft: MatrixDraft;
  onDraftChange: (draft: MatrixDraft) => void;
  highlightRole: RoleCode | null;
}

export function PermissionMatrixTab({ canEdit, draft, onDraftChange, highlightRole }: PermissionMatrixTabProps) {
  const roles = useRoleList();
  const me = useMe();
  const save = useAction(roleAdminApi.replacePermissions, {
    success: (saved) => `${saved.name} 역할 권한을 저장했어요`,
    onSuccess: (_saved, input) => clearRole(input.roleId),
  });
  const savingRoleId = save.isPending ? save.variables?.roleId : undefined;

  function clearRole(roleId: number) {
    const next = { ...draft };
    delete next[roleId];
    onDraftChange(next);
  }

  function toggle(role: RoleView, permission: Permission) {
    const saved = levelsOf(role.permissions);
    const current = effectiveLevelOf(saved, draft[role.id], permission);
    const nextLevel: MatrixLevel = nextLevelOf(current);
    onDraftChange({ ...draft, [role.id]: { ...draft[role.id], [permission]: nextLevel } });
  }

  return (
    <QueryBoundary query={roles} loadingLabel="역할 권한을 불러오는 중…">
      {(list) => {
        const changedRoles = list.filter((role) => changedCellsOf(levelsOf(role.permissions), draft[role.id]).length > 0);
        const myRole = list.find((role) => role.id === me.roleId);
        const losesOwnManage =
          myRole !== undefined &&
          changedCellsOf(levelsOf(myRole.permissions), draft[myRole.id]).length > 0 &&
          effectiveLevelOf(levelsOf(myRole.permissions), draft[myRole.id], PERMISSION.ORG_MANAGE) !== PERMISSION_LEVEL.USE;
        return (
          <>
            {canEdit ? null : (
              <Banner className="flex-none" icon="lock">
                조회만 할 수 있어요 — 권한을 바꾸려면 {permissionNeedText([PERMISSION.ORG_MANAGE])}
              </Banner>
            )}
            {changedRoles.length > 0 ? (
              <Banner tone="wait" className="flex-none">
                저장 전 변경이 있는 역할 {changedRoles.length}개 — {changedRoles.map((role) => ROLE_LABEL[role.roleCode]).join(', ')}. 역할마다 따로 저장해요.
              </Banner>
            ) : null}
            {losesOwnManage && myRole ? (
              <Banner tone="danger" className="flex-none">
                내 역할({ROLE_LABEL[myRole.roleCode]})의 부서·권한 관리 사용 권한이 빠져요. 저장하면 이 화면에서 권한을 더 바꿀 수 없어요.
              </Banner>
            ) : null}
            <Card className="flex-none">
              <CardHead
                title="역할별 권한"
                meta={`역할 ${list.length} × 권한 ${ROWS.reduce((sum, row) => sum + row.permissions.length, 0)}`}
                actions={
                  <span className="flex items-center gap-3 text-cap text-ink-3">
                    <span className="inline-flex items-center gap-1 text-ok">
                      <Icon name="check" size="sm" />
                      <span className="text-ink-3">{PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.USE]} = 입력·변경·확정</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-run">
                      <Icon name="eye" size="sm" />
                      <span className="text-ink-3">{PERMISSION_LEVEL_LABEL[PERMISSION_LEVEL.VIEW]} = 보기만</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-3 rounded-xs bg-wait-bg shadow-[inset_0_0_0_1px_var(--color-wait)]" />
                      저장 전 변경
                    </span>
                  </span>
                }
              />
              <CardBody flush className="overflow-x-auto">
                <Table compact>
                  <thead>
                    <tr>
                      <Th className="w-16">영역</Th>
                      <Th>권한</Th>
                      {list.map((role) => {
                        const counts = countLevels(levelsOf(role.permissions));
                        return (
                          <Th key={role.id} align="center" className={cn('min-w-24', role.roleCode === highlightRole && 'bg-brand-tint')}>
                            <span className="flex flex-col items-center py-1 leading-4">
                              <b className="text-xs font-semibold text-ink">{ROLE_LABEL[role.roleCode]}</b>
                              <span className="text-2xs text-ink-3">{levelCountText(counts)}</span>
                            </span>
                          </Th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((group) => (
                      <Fragment key={group.area}>
                        {group.permissions.map((permission, index) => (
                          <tr key={permission}>
                            {index === 0 ? (
                              <Td rowSpan={group.permissions.length} className="align-top pt-2 text-xs font-semibold text-ink-2">
                                {group.area}
                              </Td>
                            ) : null}
                            <Td className="text-sm">{PERMISSION_LABEL[permission]}</Td>
                            {list.map((role) => {
                              const saved = levelsOf(role.permissions);
                              const level = effectiveLevelOf(saved, draft[role.id], permission);
                              const changed = level !== (saved[permission] ?? null);
                              const label = levelLabelOf(level);
                              return (
                                <Td key={role.id} align="center" className={cn('px-1', role.roleCode === highlightRole && 'bg-brand-tint/40')}>
                                  <button
                                    type="button"
                                    disabled={!canEdit || savingRoleId === role.id}
                                    title={changed ? `저장된 값은 ${levelLabelOf(saved[permission] ?? null)}이에요` : undefined}
                                    aria-label={`${ROLE_LABEL[role.roleCode]} · ${PERMISSION_LABEL[permission]}: ${label}`}
                                    onClick={() => toggle(role, permission)}
                                    className={cn(
                                      'inline-flex h-6 min-w-14 items-center justify-center gap-1 rounded-xs px-1.5 text-xs font-medium enabled:hover:bg-surface-3 disabled:cursor-default',
                                      level ? LEVEL_CLASS[level] : NO_LEVEL_CLASS,
                                      changed && 'bg-wait-bg shadow-[inset_0_0_0_1px_var(--color-wait)] enabled:hover:bg-wait-bg',
                                    )}
                                  >
                                    {level === PERMISSION_LEVEL.USE ? <Icon name="check" size="sm" /> : level === PERMISSION_LEVEL.VIEW ? <Icon name="eye" size="sm" /> : null}
                                    {level ? label : '–'}
                                  </button>
                                </Td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <Td colSpan={2} className="text-xs">
                        역할별 저장
                      </Td>
                      {list.map((role) => {
                        const saved = levelsOf(role.permissions);
                        const changes = changedCellsOf(saved, draft[role.id]).length;
                        const saving = savingRoleId === role.id;
                        return (
                          <Td key={role.id} align="center" className="px-1 py-1.5">
                            {changes > 0 ? (
                              <span className="flex flex-col items-center gap-1">
                                <span className="text-2xs font-medium text-wait">변경 {changes} · 저장 전</span>
                                <span className="flex gap-1">
                                  <Button size="sm" className="h-6 px-2" disabled={saving} onClick={() => clearRole(role.id)}>
                                    취소
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    className="h-6 px-2"
                                    disabled={!canEdit || saving}
                                    onClick={() =>
                                      save.mutate({ roleId: role.id, permissions: permissionsToSave(saved, draft[role.id]), expectedUpdatedAt: role.updatedAt })
                                    }
                                  >
                                    {saving ? '저장 중…' : '저장'}
                                  </Button>
                                </span>
                              </span>
                            ) : (
                              <span className="text-2xs font-normal text-ink-3">변경 없음</span>
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </Table>
              </CardBody>
            </Card>
            <div className="flex flex-none flex-col gap-1 text-cap text-ink-3">
              <span>· 구매요청 승인은 이 행렬에 없어요. 요청자 소속 부서의 부서장이 승인해요 (부서장은 역할이 아니에요).</span>
              <span>· 저장하면 그 역할 사원의 메뉴와 버튼이 바로 바뀌어요. 열려 있는 다른 탭에도 적용돼요.</span>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
