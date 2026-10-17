-- 심층 조사 맡기 (이슈 #378): 상태가 그대로이고 아무도 맡지 않았을(표시가 끊겼을) 때만. QUEUED는 RUNNING이 된다. 반환 행이 없으면 남이 먼저 맡았다
-- @param {Int} $1:id
-- @param {String} $2:status
-- @param {String} $3:owner
-- @param {Int} $4:leaseMs
UPDATE ai_research_run
   SET lease_owner = $3,
       lease_expires_at = now() + $4 * interval '1 millisecond',
       status = CASE WHEN status = 'QUEUED' THEN 'RUNNING' ELSE status END,
       updated_at = now()
 WHERE id = $1
   AND status = $2
   AND (lease_expires_at IS NULL OR lease_expires_at < now())
RETURNING id;
