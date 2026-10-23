-- 규격별 적격(자기 검사 PASS + 상위 히트 PASS)·재고 상태 LOT 수. inventory.on_hand_qty의 기준값이다 ([ERD] 불변조건)
-- @param {Int} $1:itemId
SELECT count(*)::int AS eligible_qty
FROM lot l
JOIN quality_inspection q ON q.lot_id = l.id AND q.inspection_result = 'PASS'
WHERE l.item_id = $1
  AND l.lot_type IN ('SLAB', 'COIL')
  AND l.lot_status = 'AVAILABLE'
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
  );
