import { describe, expect, it } from 'vitest';
import { defaultTraceDirection, walkLotRelations, type RelationLink } from '@/features/lotTrace/lib/traceGraph';

// 1 원료, 2 원료(합금철) → 3 용선(1에서) → 4 히트(3·2에서) → 5·6 슬래브 → 7 코일(5에서)
const RELATIONS: RelationLink[] = [
  { id: 1, parentLotId: 1, childLotId: 3 },
  { id: 2, parentLotId: 3, childLotId: 4 },
  { id: 3, parentLotId: 2, childLotId: 4 },
  { id: 4, parentLotId: 4, childLotId: 5 },
  { id: 5, parentLotId: 4, childLotId: 6 },
  { id: 6, parentLotId: 5, childLotId: 7 },
];

describe('walkLotRelations', () => {
  it('역추적: 코일 → 슬래브 → 히트 → 용선·합금철 → 원료', () => {
    const walk = walkLotRelations(RELATIONS, [7], 'backward');
    expect(walk.lotIds).toEqual([7, 5, 4, 3, 2, 1]);
    expect(walk.depthById.get(4)).toBe(2);
    expect(walk.depthById.get(1)).toBe(4);
    expect(walk.relationIds).toEqual([1, 2, 3, 4, 6]);
  });

  it('정추적: 원료에서 영향받은 히트·슬래브·코일까지 (형제 슬래브 포함)', () => {
    const walk = walkLotRelations(RELATIONS, [1], 'forward');
    expect(new Set(walk.lotIds)).toEqual(new Set([1, 3, 4, 5, 6, 7]));
    expect(walk.lotIds).not.toContain(2);
  });

  it('N:M 연결로 같은 LOT에 두 길로 닿아도 한 번만 넣는다', () => {
    const relations: RelationLink[] = [
      { id: 1, parentLotId: 10, childLotId: 20 },
      { id: 2, parentLotId: 11, childLotId: 20 },
      { id: 3, parentLotId: 10, childLotId: 21 },
      { id: 4, parentLotId: 11, childLotId: 21 },
    ];
    const walk = walkLotRelations(relations, [10, 11], 'forward');
    expect(walk.lotIds).toEqual([10, 11, 20, 21]);
    expect(walk.relationIds).toEqual([1, 2, 3, 4]);
  });

  it('순환·자기 연결이 있어도 끝난다', () => {
    const relations: RelationLink[] = [
      { id: 1, parentLotId: 1, childLotId: 2 },
      { id: 2, parentLotId: 2, childLotId: 1 },
      { id: 3, parentLotId: 2, childLotId: 2 },
    ];
    expect(walkLotRelations(relations, [1], 'forward').lotIds).toEqual([1, 2]);
  });

  it('기본 방향: 코일·슬래브는 역추적, 원료·용선·히트는 정추적', () => {
    expect(defaultTraceDirection('COIL')).toBe('backward');
    expect(defaultTraceDirection('SLAB')).toBe('backward');
    expect(defaultTraceDirection('HEAT')).toBe('forward');
    expect(defaultTraceDirection('RAW_MATERIAL')).toBe('forward');
  });
});
