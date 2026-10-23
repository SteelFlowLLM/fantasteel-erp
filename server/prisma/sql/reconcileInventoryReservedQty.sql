-- 예약 매수를 ACTIVE 예약 합계로 맞춘다 (REQ-INV-010). 읽은 뒤 예약 매수가 바뀌었거나, 맞추면 가용이 0 미만이 되면(inventory_available_qty_check) 반환 행이 없다
-- @param {Int} $1:itemId
-- @param {Int} $2:beforeQty
-- @param {Int} $3:activeQty
UPDATE inventory
SET reserved_qty = $3, updated_at = now()
WHERE item_id = $1 AND reserved_qty = $2 AND on_hand_qty - $3 - rolling_allocated_qty >= 0
RETURNING id;
