-- 슬래브·코일 여러 개의 상위 히트(조상 가운데 가장 가까운 히트)와 그 히트의 검사 판정. LOT 목록이 줄마다 상세를 따로 부르지 않게 한 번에 읽는다
-- 거리가 같으면 id가 작은 히트. 경로 배열로 순환(A→B→A)을 막는다 (traceLotBackward와 같은 규칙)
-- @param $1:lotIds LOT id 배열
WITH RECURSIVE walk(start_id, lot_id, depth, path) AS (
  SELECT l.id, l.id, 0, ARRAY[l.id]
  FROM lot l
  WHERE l.id = ANY($1::int[])
  UNION ALL
  SELECT w.start_id, r.parent_lot_id, w.depth + 1, w.path || r.parent_lot_id
  FROM walk w
  JOIN lot_relation r ON r.child_lot_id = w.lot_id
  WHERE NOT r.parent_lot_id = ANY (w.path)
)
SELECT DISTINCT ON (w.start_id)
  w.start_id AS lot_id,
  h.id AS heat_id,
  h.lot_no AS heat_lot_no,
  hq.inspection_result AS heat_inspection_result
FROM walk w
JOIN lot h ON h.id = w.lot_id AND h.lot_type = 'HEAT'
LEFT JOIN quality_inspection hq ON hq.lot_id = h.id
WHERE w.depth > 0
ORDER BY w.start_id, w.depth, h.id;
