-- 배정 후보 LOT: 규격이 같은 적격 제품(자기 검사 PASS + 상위 히트 PASS) 중 재고 상태이고 확정 배정이 없는 것, FIFO 순서
-- 상위 히트: 슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트
-- @param {Int} $1:itemId
SELECT l.id, l.lot_no, l.produced_date
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
  )
  AND NOT EXISTS (
    SELECT 1 FROM allocation a WHERE a.lot_id = l.id AND a.allocation_status = 'CONFIRMED'
  )
ORDER BY l.produced_date ASC NULLS LAST, l.lot_no ASC;
