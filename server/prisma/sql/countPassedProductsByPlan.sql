-- 생산계획별 합격 제품 매수(계획 규격과 같은 적격 제품). 진행 계획 잔여 목표 매수 계산에 쓴다 (업무 프로세스 4.5)
SELECT pr.production_plan_id, count(*)::int AS passed_qty
FROM lot l
JOIN production_result pr ON pr.id = l.production_result_id
JOIN production_plan p ON p.id = pr.production_plan_id
JOIN quality_inspection q ON q.lot_id = l.id AND q.inspection_result = 'PASS'
WHERE pr.production_plan_id = ANY($1::int[])
  AND l.item_id = p.item_id
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
GROUP BY pr.production_plan_id;
