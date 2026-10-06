-- 역추적: 시작 LOT과 그 모든 조상(투입 LOT)의 id와 시작에서의 최소 거리. lot_relation의 부모·자식 id만 따라간다(LOT 번호를 해석하지 않음)
-- 경로 배열로 순환(A→B→A)을 막는다. 같은 LOT이 여러 경로로 닿아도 한 번만 나온다
-- @param {Int} $1:lotId
WITH RECURSIVE walk(lot_id, depth, path) AS (
  SELECT $1::int, 0, ARRAY[$1::int]
  UNION ALL
  SELECT r.parent_lot_id, w.depth + 1, w.path || r.parent_lot_id
  FROM walk w
  JOIN lot_relation r ON r.child_lot_id = w.lot_id
  WHERE NOT r.parent_lot_id = ANY (w.path)
)
SELECT lot_id, MIN(depth)::int AS depth
FROM walk
GROUP BY lot_id
ORDER BY MIN(depth), lot_id;
