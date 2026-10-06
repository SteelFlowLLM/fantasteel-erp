-- 생산계획별로 이미 만든 히트 LOT 수. MRP는 저장된 히트 수에서 이것을 뺀 남은 히트만 소요로 본다
SELECT pr.production_plan_id, count(*)::int AS heat_lot_count
FROM lot l
JOIN production_result pr ON pr.id = l.production_result_id
WHERE l.lot_type = 'HEAT'
  AND pr.production_plan_id = ANY($1::int[])
GROUP BY pr.production_plan_id;
