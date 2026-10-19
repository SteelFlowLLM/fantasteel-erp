-- 정합성 보정 전에 재고 행을 모두 잠근다 (item_id 오름차순, inventory.md 4장 잠금 순서). 보정하는 사이 예약·출고가 예약 매수를 바꾸지 못하게 한다 (REQ-INV-010)
SELECT id, item_id, on_hand_qty, reserved_qty, rolling_allocated_qty
FROM inventory
ORDER BY item_id
FOR UPDATE;
