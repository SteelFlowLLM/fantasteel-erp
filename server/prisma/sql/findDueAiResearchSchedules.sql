-- 차례가 된 심층 조사 반복 (이슈 #521): 켜져 있고 다음 차례 시각이 지났다. 서버마다 시계가 다를 수 있어 DB의 now()로 비교한다.
-- employee_id는 차지하기 전에 사원별 잠금을 먼저 잡으려고 읽는다(반복 바꾸기와 같은 순서로 잠가 서로 기다리다 막히지 않게)
-- @param {Int} $1:take
SELECT s.id,
       s.employee_id,
       s.frequency,
       s.weekdays,
       s.run_time,
       s.next_run_at
  FROM ai_research_schedule s
 WHERE s.enabled
   AND s.next_run_at <= now()
 ORDER BY s.next_run_at, s.id
 LIMIT $1;
