-- 원료 LOT을 입고일 순(FIFO)으로 잠근다. 제선(철광석·석탄·석회석)·제강(합금철) 투입 차감용 (REQ-LOT-002·004)
-- 작업 완료일까지 입고된 재고 상태 LOT만, 입고일 → LOT 번호 순
-- @param {Int} $1:itemId
-- @param {DateTime} $2:receivedUntil
SELECT l.id, l.lot_no, l.remaining_ton, g.received_date
FROM lot l
JOIN goods_receipt g ON g.id = l.goods_receipt_id
WHERE l.item_id = $1
  AND l.lot_type = 'RAW_MATERIAL'
  AND l.lot_status = 'AVAILABLE'
  AND l.remaining_ton > 0
  AND g.received_date <= $2::date
ORDER BY g.received_date ASC, l.lot_no ASC
FOR UPDATE OF l;
