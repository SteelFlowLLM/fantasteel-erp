import { Injectable } from '@nestjs/common';
import { BUSINESS_EVENT_TYPE, EVENT_TARGET_TYPE, type AuthUser, type PermissionLevel } from '@fantasteel/shared';
import { notFound } from '../../common/errors/app.exception';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessEventRecorder } from '../business-event/business-event.recorder';
import type { ReplaceRolePermissionsDto } from './dto/replace-role-permissions.dto';
import { diffPermissionMatrix, isEmptyDiff, normalizePermissionMatrix, sortPermissionEntries, summarizeDiff, type PermissionEntry } from './permission-matrix';
import { RoleRepository } from './role.repository';

export interface RoleView {
  id: number;
  roleCode: string;
  roleName: string;
  permissions: PermissionEntry[];
}

type RoleWithPermissions = NonNullable<Awaited<ReturnType<RoleRepository['findById']>>>;

function toView(r: RoleWithPermissions): RoleView {
  const permissions = r.rolePermissions.map((p) => ({ permissionCode: p.permissionCode, permissionLevel: p.permissionLevel as PermissionLevel }));
  return { id: r.id, roleCode: r.roleCode, roleName: r.roleName, permissions: sortPermissionEntries(permissions) };
}

/** 변경 전후를 작업 로그에 남길 때 쓰는 모양: 권한 코드 → 수준 */
const asMap = (entries: readonly PermissionEntry[]) => Object.fromEntries(entries.map((e) => [e.permissionCode, e.permissionLevel]));

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RoleRepository,
    private readonly events: BusinessEventRecorder,
    private readonly realtime: RealtimeService,
  ) {}

  async list(): Promise<RoleView[]> {
    return (await this.roles.list(this.prisma)).map(toView);
  }

  async get(id: number): Promise<RoleView> {
    const role = await this.roles.findById(this.prisma, id);
    if (!role) throw notFound('역할');
    return toView(role);
  }

  /** 역할의 권한 행렬을 통째로 바꾼다. 권한은 요청마다 DB에서 읽으므로 바로 적용된다. */
  async replacePermissions(id: number, dto: ReplaceRolePermissionsDto, user: AuthUser): Promise<RoleView> {
    return this.prisma.tx(async (tx) => {
      const role = await this.roles.findById(tx, id);
      if (!role) throw notFound('역할');
      const after = normalizePermissionMatrix(role.roleCode, dto.permissions);
      const before = toView(role).permissions;
      const diff = diffPermissionMatrix(before, after);
      if (isEmptyDiff(diff)) return toView(role);

      await this.roles.replacePermissions(tx, id, after);
      await this.events.record(tx, {
        actor: user,
        eventType: BUSINESS_EVENT_TYPE.MASTER_CHANGED,
        targetType: EVENT_TARGET_TYPE.MASTER,
        targetId: role.id,
        targetNo: role.roleCode,
        summary: `${role.roleName} 역할 권한 변경: ${summarizeDiff(diff)}`,
        before: { roleId: role.id, roleCode: role.roleCode, permissions: asMap(before) },
        after: { roleId: role.id, roleCode: role.roleCode, permissions: asMap(after) },
      });
      this.realtime.changed('employees', 'master-data');
      return { id: role.id, roleCode: role.roleCode, roleName: role.roleName, permissions: sortPermissionEntries(after) };
    });
  }
}
