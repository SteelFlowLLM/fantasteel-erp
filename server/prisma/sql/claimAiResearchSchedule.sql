-- 심층 조사 반복 차지 (이슈 #521): 켜져 있고 다음 차례가 본 값($2) 그대로이며 이미 지났을 때만 다음 차례($3)로 넘긴다.
-- 서버 여러 대가 같은 차례를 동시에 집으면 먼저 바꾼 쪽만 행을 돌려받는다(뒤 UPDATE는 앞 트랜잭션이 끝난 뒤 바뀐 next_run_at을 보고 0건). 반환 행이 없으면 실행하지 않는다
-- @param {Int} $1:id
-- @param {DateTime} $2:expected
-- @param {DateTime} $3:next
UPDATE ai_research_schedule
   SET next_run_at = $3,
       last_run_at = now(),
       updated_at = now()
 WHERE id = $1
   AND enabled
   AND next_run_at = $2
   AND next_run_at <= now()
RETURNING id, run_id, employee_id, last_run_id;
