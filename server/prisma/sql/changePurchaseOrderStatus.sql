-- 발주 상태가 그대로(fromStatus)일 때만 바꾼다. 발주 취소·잔량 마감·입고 확정·입고 취소가 겹쳐도 한쪽만 반영한다 (BP-PUR-02). 반환 행이 없으면 그사이 바뀐 것
-- @param {Int} $1:purchaseOrderId
-- @param {String} $2:fromStatus
-- @param {String} $3:toStatus
UPDATE purchase_order
SET purchase_order_status = $3, updated_at = now()
WHERE id = $1 AND purchase_order_status = $2
RETURNING id;
