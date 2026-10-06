-- 검사한 LOT의 판정으로 적격이 달라질 수 있는 제품 LOT: 슬래브·코일이면 그 LOT, 히트면 하위 슬래브와 그 코일
-- 적격 = 자기 검사 PASS + 상위 히트 PASS (슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트)
-- @param {Int} $1:lotId
WITH targets AS (
  SELECT l.id FROM lot l WHERE l.id = $1 AND l.lot_type IN ('SLAB', 'COIL')
  UNION
  SELECT r.child_lot_id FROM lot_relation r
  JOIN lot h ON h.id = r.parent_lot_id AND h.lot_type = 'HEAT'
  WHERE h.id = $1
  UNION
  SELECT r2.child_lot_id FROM lot_relation r
  JOIN lot h ON h.id = r.parent_lot_id AND h.lot_type = 'HEAT'
  JOIN lot_relation r2 ON r2.parent_lot_id = r.child_lot_id
  JOIN lot s ON s.id = r.child_lot_id AND s.lot_type = 'SLAB'
  WHERE h.id = $1
)
SELECT
  l.id,
  l.lot_no,
  l.item_id,
  l.lot_status,
  EXISTS (SELECT 1 FROM quality_inspection q WHERE q.lot_id = l.id AND q.inspection_result = 'PASS') AS is_own_passed,
  EXISTS (
    SELECT 1
    FROM lot_relation r
    JOIN lot h ON h.id = r.parent_lot_id AND h.lot_type = 'HEAT'
    JOIN quality_inspection hq ON hq.lot_id = h.id AND hq.inspection_result = 'PASS'
    WHERE r.child_lot_id = l.id
       OR r.child_lot_id IN (
         SELECT r3.parent_lot_id
         FROM lot_relation r3
         JOIN lot s ON s.id = r3.parent_lot_id AND s.lot_type = 'SLAB'
         WHERE r3.child_lot_id = l.id
       )
  ) AS is_heat_passed
FROM lot l
JOIN targets t ON t.id = l.id
WHERE l.lot_type IN ('SLAB', 'COIL')
ORDER BY l.item_id, l.id;
