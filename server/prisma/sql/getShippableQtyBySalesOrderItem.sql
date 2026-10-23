-- 수주 품목별 ACTIVE 예약 매수와 진행 중 출하요청 매수 (출하 가능 매수 = 앞 − 뒤, API-132)
-- 잠금(lockSalesOrderItemsForShipment) 뒤 별도 문장으로 불러야 먼저 끝난 출하요청까지 합계에 들어간다
-- @param $1:salesOrderItemIds 수주 품목 id 배열
-- @param {String} $2:activeReservationStatus RESERVATION_STATUS.ACTIVE
-- @param $3:pendingShipmentRequestStatuses 진행 중 SHIPMENT_REQUEST_STATUS 배열 (REQUESTED·ALLOCATED)
SELECT soi.id AS "salesOrderItemId",
       COALESCE((
         SELECT SUM(r.reserved_qty)
         FROM reservation r
         WHERE r.sales_order_item_id = soi.id AND r.reservation_status = $2
       ), 0)::int AS "activeReservedQty",
       COALESCE((
         SELECT SUM(sri.request_qty)
         FROM shipment_request_item sri
         JOIN shipment_request sr ON sr.id = sri.shipment_request_id
         WHERE sri.sales_order_item_id = soi.id AND sr.shipment_request_status = ANY($3::varchar[])
       ), 0)::int AS "pendingRequestQty"
FROM sales_order_item soi
WHERE soi.id = ANY($1::int[])
ORDER BY soi.id;
