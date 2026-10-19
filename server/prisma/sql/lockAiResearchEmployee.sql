-- 심층 조사 만들기 전에 사원별로 트랜잭션이 끝날 때까지 잠근다 (이슈 #378). 동시에 만들어도 진행 중 3개 상한을 넘지 않게 차례로 센다
-- @param {Int} $1:employeeId
SELECT 1 AS locked
FROM pg_advisory_xact_lock(hashtext('ai_research_run:' || $1::text));
