import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

const connectionSelect = {
  id: true,
  providerKey: true,
  serverUrl: true,
  oauthClientInformation: true,
  oauthTokens: true,
  oauthCodeVerifier: true,
  oauthState: true,
  oauthStateExpiresAt: true,
  settings: true,
  connectedAt: true,
  lastError: true,
  connectedBy: { select: { id: true, employeeName: true } },
} satisfies Prisma.IntegrationConnectionSelect;

export type IntegrationConnectionRow = Prisma.IntegrationConnectionGetPayload<{ select: typeof connectionSelect }>;

/** DB 접근만 둔다. 첫 인자는 항상 tx (컨벤션 6장) */
@Injectable()
export class IntegrationConnectionRepository {
  findAll(tx: Tx) {
    return tx.integrationConnection.findMany({ select: connectionSelect, orderBy: { id: 'asc' } });
  }

  findByProviderKey(tx: Tx, providerKey: string) {
    return tx.integrationConnection.findUnique({ where: { providerKey }, select: connectionSelect });
  }

  findByState(tx: Tx, oauthState: string) {
    return tx.integrationConnection.findUnique({ where: { oauthState }, select: connectionSelect });
  }

  /** 처음 설정·연결할 때 행을 만든다. 있으면 그 행을 그대로 돌려준다 */
  ensure(tx: Tx, providerKey: string, serverUrl: string | null) {
    return tx.integrationConnection.upsert({
      where: { providerKey },
      create: { providerKey, serverUrl },
      update: {},
      select: connectionSelect,
    });
  }

  update(tx: Tx, providerKey: string, data: Prisma.IntegrationConnectionUncheckedUpdateInput) {
    return tx.integrationConnection.update({ where: { providerKey }, data, select: connectionSelect });
  }

  /** 콜백 확인값을 한 번만 쓰게 지운다. 그 사이 다른 콜백이 먼저 썼으면 0건 */
  consumeState(tx: Tx, providerKey: string, oauthState: string) {
    return tx.integrationConnection.updateMany({ where: { providerKey, oauthState }, data: { oauthState: null, oauthStateExpiresAt: null } });
  }
}
