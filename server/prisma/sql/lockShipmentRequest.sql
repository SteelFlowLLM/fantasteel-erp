-- 출하요청을 잠근다. 배정 확정·해제·취소가 같은 출하요청의 미배정 매수와 상태를 동시에 바꾸지 않게 한다
-- @param {Int} $1:shipmentRequestId
SELECT id, shipment_request_no, shipment_request_status
FROM shipment_request
WHERE id = $1
FOR UPDATE;
