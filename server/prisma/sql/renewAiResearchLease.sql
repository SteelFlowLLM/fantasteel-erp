-- 심층 조사 맡은 표시 늘리기 (이슈 #378). 내가 맡은 계획·조사 중 행만. 반환 행이 없으면 취소됐거나 남이 맡았다
-- @param {Int} $1:id
-- @param {String} $2:owner
-- @param {Int} $3:leaseMs
UPDATE ai_research_run
   SET lease_expires_at = now() + $3 * interval '1 millisecond'
 WHERE id = $1
   AND lease_owner = $2
   AND status IN ('PLANNING', 'RUNNING')
RETURNING id;
