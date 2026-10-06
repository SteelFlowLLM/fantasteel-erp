-- 생산계획 행을 잠근다. 같은 계획의 취소·히트 편성 확정·작업 실적 등록이 겹치지 않게 한다
-- @param {Int} $1:productionPlanId
SELECT id, production_plan_status, heat_count, item_id, sales_order_item_id
FROM production_plan
WHERE id = $1
FOR UPDATE;
