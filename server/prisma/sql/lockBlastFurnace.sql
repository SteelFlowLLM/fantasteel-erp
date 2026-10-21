-- 고로 하나의 작업 시작을 트랜잭션이 끝날 때까지 잠근다. 제선은 계획에 묶이지 않아 계획 잠금이 없으므로, 같은 고로에 작업 중 실적이 두 건 생기지 않게 한다
-- @param {String} $1:blastFurnaceCode
SELECT 1 AS locked
FROM pg_advisory_xact_lock(hashtext('blast_furnace:' || $1));
