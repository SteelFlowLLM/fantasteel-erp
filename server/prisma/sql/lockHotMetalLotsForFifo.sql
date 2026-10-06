-- 용선 LOT을 생산 순(FIFO)으로 잠근다. 제강 투입 차감용 (REQ-LOT-002 "용선 LOT을 생산 순으로 자동 투입")
-- 작업 완료 시각까지 만든 재고 상태 LOT만, 제선 완료 시각 → LOT 번호 순
-- @param {DateTime} $1:producedUntil
SELECT l.id, l.lot_no, l.remaining_ton, pr.completed_at
FROM lot l
JOIN production_result pr ON pr.id = l.production_result_id
WHERE l.lot_type = 'HOT_METAL'
  AND l.lot_status = 'AVAILABLE'
  AND l.remaining_ton > 0
  AND pr.completed_at <= $1
ORDER BY pr.completed_at ASC, l.lot_no ASC
FOR UPDATE OF l;
