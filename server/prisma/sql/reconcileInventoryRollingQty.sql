-- 열연 배정 매수를 확정(CONFIRMED) 열연 배정 수로 맞춘다 (REQ-INV-010, #478). 읽은 뒤 바뀌었거나 맞추면 가용이 0 미만이 되면(inventory_available_qty_check) 반환 행이 없다
-- @param {Int} $1:itemId
-- @param {Int} $2:beforeQty
-- @param {Int} $3:confirmedQty
UPDATE inventory
SET rolling_allocated_qty = $3, updated_at = now()
WHERE item_id = $1 AND rolling_allocated_qty = $2 AND on_hand_qty - reserved_qty - $3 >= 0
RETURNING id;
