-- 재생산 계획을 만들기 전에 수주 품목을 잠근다. 같은 품목의 재생산을 두 번 만들지 않게 한다 (REQ-PRD-006)
-- @param {Int} $1:salesOrderItemId
SELECT id, sales_order_id, item_id, sales_order_item_status
FROM sales_order_item
WHERE id = $1
FOR UPDATE;
