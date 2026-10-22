import { Injectable } from '@nestjs/common';
import { PERMISSION_LEVEL, type Permission } from '@fantasteel/shared';
import { claimIntegrationFaultAlert, lockIntegrationFaults, recordIntegrationFault } from '../../generated/prisma/sql';
import type { Tx } from '../../prisma/prisma.service';

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class IntegrationFaultRepository {
  findAll(tx: Tx) {
    return tx.integrationFault.findMany({ orderBy: [{ providerKey: 'asc' }, { id: 'asc' }] });
  }

  findByProvider(tx: Tx, providerKey: string) {
    return tx.integrationFault.findMany({ where: { providerKey }, orderBy: { id: 'asc' } });
  }

  /** 장애 한 번을 남기고 이어진 횟수를 올린다 (줄이 없으면 만든다) */
  record(tx: Tx, providerKey: string, faultKind: string, message: string) {
    return tx.$queryRawTyped(recordIntegrationFault(providerKey, faultKind, message));
  }

  /** 알림 시각을 조건부로 적는다. 돌려받은 행이 있는 쪽만 알림을 보낸다 (서버가 여러 대여도 한 번) */
  claimAlert(tx: Tx, providerKey: string, faultKind: string, minFailures: number, repeatMs: number) {
    return tx.$queryRawTyped(claimIntegrationFaultAlert(providerKey, faultKind, minFailures, repeatMs));
  }

  /** 그 연결 대상의 장애 줄을 잠그고 읽는다. 풀 때 같은 장애를 두 서버가 함께 풀어 복구 알림이 두 번 가지 않게 한다 */
  lockByProvider(tx: Tx, providerKey: string) {
    return tx.$queryRawTyped(lockIntegrationFaults(providerKey));
  }

  deleteByIds(tx: Tx, ids: number[]) {
    return tx.integrationFault.deleteMany({ where: { id: { in: ids } } });
  }

  deleteByProvider(tx: Tx, providerKey: string) {
    return tx.integrationFault.deleteMany({ where: { providerKey } });
  }

  /** 그 기능의 사용(USE) 권한이 있는 재직 사원: 연동 장애를 받을 연동 관리 권한자 */
  async findActiveEmployeeIdsWithPermission(tx: Tx, permission: Permission): Promise<number[]> {
    const rows = await tx.employee.findMany({
      where: { isActive: true, role: { rolePermissions: { some: { permission, permissionLevel: PERMISSION_LEVEL.USE } } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
