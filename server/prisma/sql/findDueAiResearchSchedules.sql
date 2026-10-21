-- 차례가 된 심층 조사 반복 (이슈 #521): 켜져 있고 다음 차례 시각이 지났다. 서버마다 시계가 다를 수 있어 DB의 now()로 비교한다
-- @param {Int} $1:take
SELECT s.id,
       s.frequency,
       s.weekdays,
       s.run_time,
       s.next_run_at
  FROM ai_research_schedule s
 WHERE s.enabled
   AND s.next_run_at <= now()
 ORDER BY s.next_run_at, s.id
 LIMIT $1;
