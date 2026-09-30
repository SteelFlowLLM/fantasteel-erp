import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

@Injectable()
export class IdempotencyKeyRepository {
  findByRequestKey(tx: Tx, requestKey: string) {
    return tx.idempotencyKey.findUnique({ where: { requestKey } });
  }

  claim(tx: Tx, requestKey: string, employeeId: number) {
    return tx.idempotencyKey.create({ data: { requestKey, employeeId } });
  }

  saveResponse(tx: Tx, id: number, response: Prisma.InputJsonValue) {
    return tx.idempotencyKey.update({ where: { id }, data: { response } });
  }
}
