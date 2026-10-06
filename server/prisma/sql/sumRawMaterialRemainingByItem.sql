-- 원료별 원료 LOT 잔량 합계(사용 가능한 LOT만). MRP 순소요의 잔량 차감에 쓴다 (업무 프로세스 4.4)
SELECT l.item_id, sum(l.remaining_ton) AS remaining_ton
FROM lot l
WHERE l.lot_type = 'RAW_MATERIAL'
  AND l.lot_status = 'AVAILABLE'
  AND l.item_id IS NOT NULL
  AND l.remaining_ton > 0
GROUP BY l.item_id;
