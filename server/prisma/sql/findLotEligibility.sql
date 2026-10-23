-- 배정 확정 전 LOT 재검증: 규격·상태·적격(자기 검사 PASS + 상위 히트 PASS)·확정 배정 여부
-- @param {Int} $1:lotId
SELECT
  l.id,
  l.lot_no,
  l.lot_type,
  l.item_id,
  l.lot_status,
  l.produced_date,
  (
    EXISTS (SELECT 1 FROM quality_inspection q WHERE q.lot_id = l.id AND q.inspection_result = 'PASS')
    AND EXISTS (
      SELECT 1
      FROM lot_relation r
      JOIN lot h ON h.id = r.parent_lot_id AND h.lot_type = 'HEAT'
      JOIN quality_inspection hq ON hq.lot_id = h.id AND hq.inspection_result = 'PASS'
      WHERE r.child_lot_id = l.id
         OR r.child_lot_id IN (
           SELECT r2.parent_lot_id
           FROM lot_relation r2
           JOIN lot s ON s.id = r2.parent_lot_id AND s.lot_type = 'SLAB'
           WHERE r2.child_lot_id = l.id
         )
    )
  ) AS is_eligible,
  (SELECT a.id FROM allocation a WHERE a.lot_id = l.id AND a.allocation_status = 'CONFIRMED' LIMIT 1) AS confirmed_allocation_id
FROM lot l
WHERE l.id = $1;
