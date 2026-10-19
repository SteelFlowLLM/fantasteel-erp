-- 일정을 Notion(일정 데이터베이스·고른 캘린더)에 모두 반영했다고 적는다 (이슈 #391). updated_at은 건드리지 않는다: 반영한 행의 updated_at을 notion_synced_at에 넣어 그 뒤에 바뀌면 다시 반영하게 한다
-- @param {Int} $1:id
-- @param {DateTime} $2:syncedAt
UPDATE schedule_event
   SET notion_synced_at = $2
 WHERE id = $1
RETURNING id;
