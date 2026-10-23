-- 가용 매수(on_hand − reserved − rolling) 안에서 예약 매수를 늘린다. 반환 행이 없으면 가용 부족
-- @param {Int} $1:itemId
-- @param {Int} $2:qty
UPDATE inventory
SET reserved_qty = reserved_qty + $2, updated_at = now()
WHERE item_id = $1 AND on_hand_qty - reserved_qty - rolling_allocated_qty >= $2
RETURNING id;
