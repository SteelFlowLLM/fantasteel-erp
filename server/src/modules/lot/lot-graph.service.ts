import { Injectable } from '@nestjs/common';
import type { LotRelation } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';
import type { TraceDirection } from './dto/trace-lot.dto';
import { LotRepository } from './lot.repository';

/** 한 번 추적에서 따라갈 LOT 수의 상한 (무한 확장 방지). */
export const MAX_TRACE_NODES = 2000;

export interface LotWalk {
  /** LOT id → 시작 LOT에서의 거리(단계 수) */
  depths: Map<number, number>;
  relations: LotRelation[];
  hasCycle: boolean;
  truncated: boolean;
}

/**
 * lot_relation을 내부 id로만 따라가는 그래프 탐색 (BP-LOT-01). LOT 번호를 파싱하지 않는다.
 * 방문한 LOT은 다시 펼치지 않으므로 순환 연결이 있어도 끝난다.
 */
@Injectable()
export class LotGraphService {
  constructor(private readonly repo: LotRepository) {}

  async walk(db: Tx, rootId: number, direction: TraceDirection, maxNodes = MAX_TRACE_NODES): Promise<LotWalk> {
    const depths = new Map<number, number>([[rootId, 0]]);
    const relations = new Map<number, LotRelation>();
    let frontier = [rootId];
    let depth = 0;
    let truncated = false;
    while (frontier.length) {
      if (depths.size >= maxNodes) {
        truncated = true;
        break;
      }
      const rels = direction === 'backward' ? await this.repo.relationsByChildIds(db, frontier) : await this.repo.relationsByParentIds(db, frontier);
      const next: number[] = [];
      for (const rel of rels) {
        relations.set(rel.id, rel);
        const other = direction === 'backward' ? rel.parentLotId : rel.childLotId;
        if (!depths.has(other)) {
          depths.set(other, depth + 1);
          next.push(other);
        }
      }
      frontier = next;
      depth += 1;
    }
    const list = [...relations.values()];
    return { depths, relations: list, hasCycle: detectCycle(depths.keys(), list), truncated };
  }

  /** 이 LOT의 조상과 자손 (형제·사촌은 제외) 과 자기 자신. 작업 로그의 "상·하위 LOT 포함" 조회(includeLineage)에 쓴다. */
  async lineageIds(db: Tx, lotId: number): Promise<number[]> {
    const [up, down] = await Promise.all([this.walk(db, lotId, 'backward'), this.walk(db, lotId, 'forward')]);
    return [...new Set([...up.depths.keys(), ...down.depths.keys()])];
  }
}

/** 위상 정렬(Kahn)이 모든 노드를 소진하지 못하면 순환이다. 자기 연결(부모 = 자식)도 순환으로 본다. */
export function detectCycle(nodeIds: Iterable<number>, relations: Pick<LotRelation, 'parentLotId' | 'childLotId'>[]): boolean {
  const indegree = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const id of nodeIds) indegree.set(id, 0);
  for (const r of relations) {
    if (!indegree.has(r.parentLotId) || !indegree.has(r.childLotId)) continue;
    indegree.set(r.childLotId, (indegree.get(r.childLotId) ?? 0) + 1);
    const list = children.get(r.parentLotId) ?? [];
    list.push(r.childLotId);
    children.set(r.parentLotId, list);
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let consumed = 0;
  while (queue.length) {
    const id = queue.pop()!;
    consumed += 1;
    for (const c of children.get(id) ?? []) {
      const d = (indegree.get(c) ?? 0) - 1;
      indegree.set(c, d);
      if (d === 0) queue.push(c);
    }
  }
  return consumed !== indegree.size;
}
