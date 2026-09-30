import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

export type RoutingRow = Prisma.RoutingGetPayload<object>;

/** 두 단계 교체 시 (item_type, process_seq) unique와 겹치지 않도록 잠시 옮겨 두는 순번 */
const TEMP_SEQ_OFFSET = 1000;

@Injectable()
export class RoutingRepository {
  findMany(tx: Tx, itemType?: string): Promise<RoutingRow[]> {
    return tx.routing.findMany({ where: itemType ? { itemType } : {}, orderBy: [{ itemType: 'asc' }, { processSeq: 'asc' }] });
  }
  findById(tx: Tx, id: number) {
    return tx.routing.findUnique({ where: { id } });
  }
  updateYield(tx: Tx, id: number, plannedYieldRate: number | null) {
    return tx.routing.update({ where: { id }, data: { plannedYieldRate } });
  }
  /** 한 품목 유형의 공정 목록을 순서·수율째 교체한다. 같은 공정은 행을 유지한다. */
  async replace(tx: Tx, itemType: string, processes: { processCode: string; plannedYieldRate: number | null }[]): Promise<void> {
    const existing = await tx.routing.findMany({ where: { itemType } });
    const keep = new Set(processes.map((p) => p.processCode));
    await tx.routing.deleteMany({ where: { itemType, processCode: { notIn: [...keep] } } });
    await tx.routing.updateMany({ where: { itemType }, data: { processSeq: { increment: TEMP_SEQ_OFFSET } } });
    for (const [i, p] of processes.entries()) {
      const found = existing.find((e) => e.processCode === p.processCode);
      if (found) await tx.routing.update({ where: { id: found.id }, data: { processSeq: i + 1, plannedYieldRate: p.plannedYieldRate } });
      else await tx.routing.create({ data: { itemType, processCode: p.processCode, processSeq: i + 1, plannedYieldRate: p.plannedYieldRate } });
    }
  }
}
