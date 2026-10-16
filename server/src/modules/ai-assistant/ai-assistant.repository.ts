import { Injectable } from '@nestjs/common';
import { PERMISSION_LEVEL, type Permission, type Role } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class AiAssistantRepository {
  /**
   * 권한 밖 요청에 담당 역할을 안내할 때 쓴다 (REQ-AST-009). 권한이 없으면 행이 없으므로 행이 있는 역할 = VIEW 이상.
   * 역할은 따로 읽는다 (Prisma 7 중첩 select를 여러 행에 걸쳐 읽으면 실패할 수 있다, lot.md 구현 메모).
   * 쓰기 도구(승인 카드)는 level 'USE'로 사용 권한이 있는 역할만 찾는다
   */
  async findRoleCodesWithAnyPermission(tx: Tx, permissions: readonly Permission[], level: 'VIEW' | 'USE' = 'VIEW'): Promise<Role[]> {
    if (permissions.length === 0) return [];
    const rows = await tx.rolePermission.findMany({
      where: { permission: { in: [...permissions] }, ...(level === 'USE' ? { permissionLevel: PERMISSION_LEVEL.USE } : {}) },
      select: { roleId: true },
    });
    const roles = await tx.role.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.roleId))] } }, select: { roleCode: true }, orderBy: { id: 'asc' } });
    return roles.map((role) => role.roleCode as Role);
  }
}
