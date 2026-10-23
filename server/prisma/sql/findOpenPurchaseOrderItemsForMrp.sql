-- 미입고량이 남은 확정 발주 품목(입고예정 = 발주량 − 입고 합계)과 근거 구매요청의 생산계획. MRP 순소요의 입고예정 차감에 쓴다
-- 아직 입고를 기다리는 발주(확정·부분 입고)만 센다. 잔량 마감·발주 취소한 발주의 남은 양은 들어오지 않는다. 입고 합계는 입고 취소(음수 입고)까지 더한 값
SELECT poi.id AS purchase_order_item_id,
       poi.item_id,
       poi.expected_receipt_date,
       pr.production_plan_id,
       poi.ordered_ton - coalesce(sum(gr.received_ton), 0) AS scheduled_receipt_ton
FROM purchase_order_item poi
JOIN purchase_order po ON po.id = poi.purchase_order_id
JOIN purchase_requisition pr ON pr.id = poi.purchase_requisition_id
LEFT JOIN goods_receipt gr ON gr.purchase_order_item_id = poi.id
WHERE po.purchase_order_status IN ('CONFIRMED', 'PARTIALLY_RECEIVED')
GROUP BY poi.id, poi.item_id, poi.expected_receipt_date, pr.production_plan_id, poi.ordered_ton
HAVING poi.ordered_ton - coalesce(sum(gr.received_ton), 0) > 0;
