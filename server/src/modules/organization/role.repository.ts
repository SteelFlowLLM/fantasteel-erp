import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';
import type { PermissionEntry } from './permission-matrix';

@Injectable()
export class RoleRepository {
  list(tx: Tx) {
    return tx.role.findMany({ include: { rolePermissions: true }, orderBy: { id: 'asc' } });
  }

  findById(tx: Tx, id: number) {
    return tx.role.findUnique({ where: { id }, include: { rolePermissions: true } });
  }

  /** 역할의 권한 행렬을 통째로 바꾼다 (목록에 없는 권한 = 권한 없음). */
  async replacePermissions(tx: Tx, roleId: number, entries: readonly PermissionEntry[]): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (entries.length) {
      await tx.rolePermission.createMany({ data: entries.map((e) => ({ roleId, permissionCode: e.permissionCode, permissionLevel: e.permissionLevel })) });
    }
  }
}
