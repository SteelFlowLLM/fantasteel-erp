/**
 * 부서 계층 순환 검사 (REQ-ORG-001). 순수 함수라 DB 없이 테스트한다.
 * parentOf: 부서 id → 상위 부서 id (최상위는 null).
 */
export function wouldCreateCycle(departmentId: number, newParentId: number | null, parentOf: ReadonlyMap<number, number | null>): boolean {
  const visited = new Set<number>();
  let cursor: number | null = newParentId;
  while (cursor !== null) {
    if (cursor === departmentId) return true;
    // 이미 순환이 들어 있는 데이터를 만나도 무한 루프에 빠지지 않는다
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
