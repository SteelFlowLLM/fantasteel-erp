-- 입고 취소: 아직 쓰지 않은 원료 LOT(재고 상태·잔량 = 처음 양·투입·배정 없음)만 잔량 0·입고 취소로 바꾼다 (BP-PUR-02 반대 거래). 반환 행이 없으면 이미 쓴 LOT
-- 원료 FIFO 투입이 같은 LOT을 잠그고 잔량을 줄였으면 잔량 조건에서 빠진다
-- @param {Int} $1:lotId
UPDATE lot l
SET lot_status = 'RECEIPT_CANCELLED', remaining_ton = 0, updated_at = now()
WHERE l.id = $1
  AND l.lot_type = 'RAW_MATERIAL'
  AND l.lot_status = 'AVAILABLE'
  AND l.remaining_ton = l.initial_ton
  AND NOT EXISTS (SELECT 1 FROM lot_relation r WHERE r.parent_lot_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM allocation a WHERE a.lot_id = l.id)
RETURNING l.id;
