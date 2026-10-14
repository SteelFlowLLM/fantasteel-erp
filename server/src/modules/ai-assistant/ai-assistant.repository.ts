import { Injectable } from '@nestjs/common';
import type { Permission, Role } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class AiAssistantRepository {
  /**
   * 권한 밖 요청에 담당 역할을 안내할 때 쓴다 (REQ-AST-009). 권한이 없으면 행이 없으므로 행이 있는 역할 = VIEW 이상.
   * 역할은 따로 읽는다 (Prisma 7 중첩 select를 여러 행에 걸쳐 읽으면 실패할 수 있다, lot.md 구현 메모)
   */
  async findRoleCodesWithAnyPermission(tx: Tx, permissions: readonly Permission[]): Promise<Role[]> {
    if (permissions.length === 0) return [];
    const rows = await tx.rolePermission.findMany({ where: { permission: { in: [...permissions] } }, select: { roleId: true } });
    const roles = await tx.role.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.roleId))] } }, select: { roleCode: true }, orderBy: { id: 'asc' } });
    return roles.map((role) => role.roleCode as Role);
  }
}
