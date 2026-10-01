// LOT 관계 따라가기 (BP-LOT-01). LOT 번호를 해석하지 않고 lot_relation의 부모·자식 내부 id만 따라간다.
// 역추적 = 자식 → 부모 (코일 → 슬래브 → 히트 → 용선·합금철 → 원료), 정추적 = 부모 → 자식 (원료·히트 → 슬래브 → 코일).
// 같은 LOT은 한 번만 펼친다(N:M 용선 연결이 여러 길로 이어져도 한 번). 자기 연결은 건너뛴다.
import type { LotType } from '@/codes';

export type TraceDirection = 'backward' | 'forward';

export const TRACE_DIRECTION_LABEL: Record<TraceDirection, string> = {
  backward: '역추적',
  forward: '정추적',
};

export const isTraceDirection = (value: string | null | undefined): value is TraceDirection => value === 'backward' || value === 'forward';

/** 코일·슬래브는 어디서 왔는지(역추적), 원료·용선·히트는 어디로 갔는지(정추적)부터 본다 */
export const defaultTraceDirection = (lotType: LotType): TraceDirection => (lotType === 'SLAB' || lotType === 'COIL' ? 'backward' : 'forward');

export interface RelationLink {
  id: number;
  parentLotId: number;
  childLotId: number;
}

export interface TraceWalk {
  /** 시작 LOT부터 가까운 순서 (같은 거리 안에서는 찾은 순서) */
  lotIds: number[];
  /** 시작 LOT에서 몇 단계 떨어졌는지 (시작 = 0) */
  depthById: Map<number, number>;
  /** 지나온 LOT 관계 id (오름차순) */
  relationIds: number[];
}

export function walkLotRelations(relations: readonly RelationLink[], rootIds: readonly number[], direction: TraceDirection): TraceWalk {
  const next = new Map<number, RelationLink[]>();
  for (const relation of relations) {
    if (relation.parentLotId === relation.childLotId) continue;
    const from = direction === 'backward' ? relation.childLotId : relation.parentLotId;
    const list = next.get(from);
    if (list) list.push(relation);
    else next.set(from, [relation]);
  }

  const depthById = new Map<number, number>();
  const lotIds: number[] = [];
  const relationIds = new Set<number>();
  let frontier: number[] = [];
  for (const id of rootIds) {
    if (depthById.has(id)) continue;
    depthById.set(id, 0);
    lotIds.push(id);
    frontier.push(id);
  }

  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const following: number[] = [];
    for (const lotId of frontier) {
      for (const relation of next.get(lotId) ?? []) {
        relationIds.add(relation.id);
        const target = direction === 'backward' ? relation.parentLotId : relation.childLotId;
        if (depthById.has(target)) continue;
        depthById.set(target, depth);
        lotIds.push(target);
        following.push(target);
      }
    }
    frontier = following;
  }

  return { lotIds, depthById, relationIds: [...relationIds].sort((a, b) => a - b) };
}
