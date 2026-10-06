import { Injectable } from '@nestjs/common';
import type { ItemType } from '@fantasteel/shared';
import type { Tx } from '../../prisma/prisma.service';

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class MasterDataRepository {
  findCustomers(tx: Tx) {
    return tx.customer.findMany({ orderBy: { customerCode: 'asc' }, select: { id: true, customerCode: true, customerName: true } });
  }

  findItems(tx: Tx, itemType?: ItemType) {
    return tx.item.findMany({
      where: itemType ? { itemType } : undefined,
      orderBy: [{ itemType: 'asc' }, { itemCode: 'asc' }],
      include: { steelGrade: { select: { steelGradeCode: true } } },
    });
  }
}
