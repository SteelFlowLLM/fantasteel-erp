-- 출하요청 등록 전에 수주 품목을 id 순서로 잠근다. 같은 품목을 동시에 출하요청해도 출하 가능 매수를 한 번만 쓰게 한다
-- @param $1:salesOrderItemIds 수주 품목 id 배열
SELECT soi.id,
       soi.sales_order_id AS "salesOrderId",
       so.customer_id AS "customerId",
       soi.sales_order_item_status AS "salesOrderItemStatus"
FROM sales_order_item soi
JOIN sales_order so ON so.id = soi.sales_order_id
WHERE soi.id = ANY($1::int[])
ORDER BY soi.id
FOR UPDATE OF soi;
