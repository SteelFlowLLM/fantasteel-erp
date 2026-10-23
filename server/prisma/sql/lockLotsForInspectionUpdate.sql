-- 측정값 수정 전에 그 LOT(히트면 하위 제품까지)을 id 순서로 잠근다 (#487). 출고 확정이 같은 LOT을 출고(SHIPPED)하고 밀시트를 발행하는 사이
-- 측정값이 바뀌어 '발행 뒤 수정 차단'이 뚫리지 않게 한다. 출고 확정이 먼저 잠갔으면 커밋을 기다린 뒤 발행된 밀시트를 보고 막는다
-- @param $1:lotIds LOT id 배열
SELECT id
FROM lot
WHERE id = ANY($1::int[])
ORDER BY id
FOR UPDATE;
