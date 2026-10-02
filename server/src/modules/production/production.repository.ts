import { Injectable } from '@nestjs/common';

/**
 * DB 접근은 여기서만 한다. 함수의 첫 인자는 tx (컨벤션 8장).
 *   findById(tx: Tx, id: number) { return tx.salesOrder.findUnique({ where: { id } }); }
 * 집계·3개 이상 JOIN·잠금(FOR UPDATE)은 prisma/sql/*.sql(TypedSQL)로 만들고 tx.$queryRawTyped(...)로 부른다.
 */
@Injectable()
export class ProductionRepository {}
