-- 내 심층 조사 목록 (이슈 #378). 출처 본문(sources jsonb)은 크므로 개수만 센다
-- @param {Int} $1:employeeId
-- @param {Int} $2:limit
-- @param {Int} $3:offset
SELECT r.id,
       r.question,
       r.plan ->> 'title' AS title,
       r.status,
       r.steps_used,
       (r.budget ->> 'maxSteps')::int AS max_steps,
       (SELECT count(*) FROM jsonb_array_elements(r.sources) AS s(source) WHERE s.source -> 'erp' IS NULL)::int AS source_count,
       r.created_at,
       r.updated_at,
       r.finished_at
  FROM ai_research_run r
 WHERE r.employee_id = $1
 ORDER BY r.created_at DESC, r.id DESC
 LIMIT $2 OFFSET $3;
