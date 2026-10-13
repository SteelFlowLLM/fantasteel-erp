import { Injectable } from '@nestjs/common';
import type { Permission, Role } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/** DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장) */
@Injectable()
export class AiAssistantRepository {
  /** 권한 밖 요청에 담당 역할을 안내할 때 쓴다 (REQ-AST-009). 권한이 없으면 행이 없으므로 행이 있는 역할 = VIEW 이상 */
  async findRoleCodesWithPermission(tx: Tx, permission: Permission): Promise<Role[]> {
    const rows = await tx.rolePermission.findMany({ where: { permission }, select: { role: { select: { roleCode: true } } }, orderBy: { roleId: 'asc' } });
    return rows.map((row) => row.role.roleCode as Role);
  }
}
