-- 규격별 미배정 합격 제품 LOT 수: 적격(자기 검사 PASS + 상위 히트 PASS) + 재고 상태 + 확정 배정 없음 (findAllocatableLots와 같은 조건)
-- 상위 히트: 슬래브는 부모 히트, 코일은 부모 슬래브의 부모 히트
SELECT l.item_id, COUNT(*)::int AS lot_count
FROM lot l
JOIN quality_inspection q ON q.lot_id = l.id AND q.inspection_result = 'PASS'
WHERE l.lot_type IN ('SLAB', 'COIL')
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
GROUP BY l.item_id;
