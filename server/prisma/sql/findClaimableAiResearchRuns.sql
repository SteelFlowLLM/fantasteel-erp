-- 심층 조사 일꾼이 맡을 후보 (이슈 #378): PLANNING·QUEUED와 맡은 표시가 끊긴 RUNNING. 시각은 서버마다 다를 수 있어 DB의 now()로 비교한다
-- @param {Int} $1:take
SELECT r.id, r.status
  FROM ai_research_run r
 WHERE r.status IN ('PLANNING', 'QUEUED', 'RUNNING')
   AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
 ORDER BY r.created_at, r.id
 LIMIT $1;
