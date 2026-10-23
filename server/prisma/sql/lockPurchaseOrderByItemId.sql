-- 입고 확정 전에 발주 행을 잠근다. 같은 발주의 입고들이 미입고량 검사·발주 상태 계산을 동시에 하지 않게 한다 (BP-PUR-02)
-- @param {Int} $1:purchaseOrderItemId
SELECT po.id
FROM purchase_order po
JOIN purchase_order_item poi ON poi.purchase_order_id = po.id
WHERE poi.id = $1
FOR UPDATE OF po;
