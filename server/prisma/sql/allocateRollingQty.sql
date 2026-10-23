-- 열연 배정 확정: 가용(현재고 − 예약 − 열연 배정) 안에서만 열연 배정 매수를 1 늘린다. 반환 행이 없으면 INV-001 (BP-INV-01)
-- 판매 예약 몫은 건드리지 않는다 (14.2 "판매 슬래브 예약을 열연 배정이 침범하지 않는다")
-- @param {Int} $1:itemId
UPDATE inventory
SET rolling_allocated_qty = rolling_allocated_qty + 1, updated_at = now()
WHERE item_id = $1 AND on_hand_qty - reserved_qty - rolling_allocated_qty >= 1
RETURNING id;
