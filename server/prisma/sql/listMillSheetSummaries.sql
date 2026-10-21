-- 밀시트 목록 한 쪽 (이슈 #498). 스냅샷 JSON 전체를 읽어 오지 않고 목록이 쓰는 칸(고객사·매수·중량·히트·규격)만 뽑는다.
-- 모양이 다른 옛 스냅샷은 빠진 값이 빈 값(빈 글자·0·빈 배열)이 되어 목록 전체가 실패하지 않는다. 필터가 null이면 걸지 않는다
-- @param {Int} $1:shipmentRequestId?
-- @param {Int} $2:salesOrderId?
-- @param {Int} $3:limit
-- @param {Int} $4:offset
SELECT m.id,
       m.mill_sheet_no,
       m.shipment_request_id,
       sr.shipment_request_no,
       m.sales_order_id,
       so.sales_order_no,
       m.issued_at,
       m.pdf_path,
       COALESCE(m.snapshot #>> '{customer,customerName}', '') AS customer_name,
       CASE WHEN jsonb_typeof(m.snapshot -> 'totalQty') = 'number' THEN trunc((m.snapshot ->> 'totalQty')::numeric)::int ELSE 0 END AS total_qty,
       COALESCE(m.snapshot ->> 'totalWeightTon', '0.000') AS total_weight_ton,
       jsonb_path_query_array(m.snapshot, '$.heats[*].heatNo') AS heat_nos,
       jsonb_path_query_array(m.snapshot, '$.items[*].itemType') AS item_types,
       jsonb_path_query_array(m.snapshot, '$.items[*].itemCode') AS item_codes
  FROM mill_sheet m
  JOIN shipment_request sr ON sr.id = m.shipment_request_id
  JOIN sales_order so ON so.id = m.sales_order_id
 WHERE ($1::int IS NULL OR m.shipment_request_id = $1::int)
   AND ($2::int IS NULL OR m.sales_order_id = $2::int)
 ORDER BY m.id DESC
 LIMIT $3 OFFSET $4;
