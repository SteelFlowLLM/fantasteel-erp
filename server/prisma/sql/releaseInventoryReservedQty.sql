-- 예약 해제만큼 예약 매수를 줄인다. 반환 행이 없으면 reserved_qty와 ACTIVE 예약 합계가 어긋난 것
-- @param {Int} $1:itemId
-- @param {Int} $2:qty
UPDATE inventory
SET reserved_qty = reserved_qty - $2, updated_at = now()
WHERE item_id = $1 AND reserved_qty >= $2
RETURNING id;
