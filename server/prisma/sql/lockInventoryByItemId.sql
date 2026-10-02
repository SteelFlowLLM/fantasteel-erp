-- 예약 전에 규격의 재고 행을 잠근다. 동시 수주가 같은 가용 매수를 두 번 예약하지 않게 한다 (REQ-INV-009)
-- @param {Int} $1:itemId
SELECT id, item_id, on_hand_qty, reserved_qty, rolling_allocated_qty
FROM inventory
WHERE item_id = $1
FOR UPDATE;
