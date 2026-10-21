-- Notion 반영 실패 한 번을 남긴다 (이슈 #518). 같은 행이 이어서 실패하면 한 줄에 횟수를 더하고, 다음 시도 시각을 baseMs에서 두 배씩 늘려 maxMs까지 미룬다.
-- 만들어졌는지 알 수 없는 실패(isResultUnknown)는 unknownMs만큼 미룬다: Notion에 생겼는지 사람이 볼 시간을 둔다
-- @param {String} $1:targetType
-- @param {Int} $2:targetId
-- @param {String} $3:lastError
-- @param {Boolean} $4:isResultUnknown
-- @param {Int} $5:baseMs
-- @param {Int} $6:maxMs
-- @param {Int} $7:unknownMs
INSERT INTO notion_sync_failure (target_type, target_id, failure_count, last_error, is_result_unknown, retry_after, first_failed_at, last_failed_at, created_at, updated_at)
VALUES (
  $1::text, $2::int, 1, $3::text, $4::boolean,
  now() + (CASE WHEN $4::boolean THEN $7::int ELSE $5::int END) * interval '1 millisecond',
  now(), now(), now(), now()
)
ON CONFLICT (target_type, target_id) DO UPDATE
   SET failure_count = notion_sync_failure.failure_count + 1,
       last_error = EXCLUDED.last_error,
       is_result_unknown = EXCLUDED.is_result_unknown,
       retry_after = now() + (CASE WHEN EXCLUDED.is_result_unknown THEN $7::int::double precision ELSE LEAST($5::int * power(2, LEAST(notion_sync_failure.failure_count, 20)), $6::int::double precision) END) * interval '1 millisecond',
       last_failed_at = now(),
       updated_at = now()
RETURNING id, failure_count;
